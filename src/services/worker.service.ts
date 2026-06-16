/**
 * BullMQ Worker Service
 *
 * Consumes jobs from "task-queue", dispatches to the appropriate executor,
 * applies per-task timeout, handles retry with exponential backoff, records
 * execution history, and manages task status transitions.
 *
 * Requirements: 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 14.1, 14.2, 14.3, 14.4
 */

import { Worker, Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { getConfig } from '../config/index.js';
import { TaskModel, ITaskDocument, TaskStatus, ExecutionStatus } from '../models/task.model.js';
import { enqueue, QUEUE_NAME } from './queue.service.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Executor interface & registry
// ---------------------------------------------------------------------------

export interface TaskExecutionResult {
  success: boolean;
  result?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type ExecutorFn = (task: ITaskDocument) => Promise<TaskExecutionResult>;

/** Map from task type string to executor function */
const executorRegistry = new Map<string, ExecutorFn>();

/**
 * Register executors for one or more task types.
 * Call this before starting the worker to wire in real executors.
 *
 * Example:
 *   setExecutors({ file_read: fileReadExecutor, email: emailExecutor });
 */
export function setExecutors(map: Record<string, ExecutorFn>): void {
  for (const [type, fn] of Object.entries(map)) {
    executorRegistry.set(type, fn);
  }
}

/**
 * Stub dispatcher — calls the registered executor for the task type, or throws
 * a placeholder error if no executor has been registered yet.
 */
async function dispatch(task: ITaskDocument): Promise<TaskExecutionResult> {
  const executor = executorRegistry.get(task.type);
  if (!executor) {
    throw new Error(`Executor not implemented for type: ${task.type}`);
  }
  return executor(task);
}

// ---------------------------------------------------------------------------
// Timeout helper
// ---------------------------------------------------------------------------

/**
 * Wrap a promise with a timeout.  If the promise does not resolve within
 * `timeoutMs` milliseconds, rejects with an EXECUTION_TIMEOUT error object.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject({
        isTimeout: true,
        code: 'EXECUTION_TIMEOUT',
        message: `Task execution exceeded timeout of ${timeoutMs}ms`,
      });
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Backoff calculation
// ---------------------------------------------------------------------------

/**
 * Calculate exponential backoff delay in milliseconds.
 *
 * delay = min(baseDelay * 2^(retryCount - 1), maxDelay)
 *
 * Requirement 14.4
 */
export function calculateBackoffMs(
  retryCount: number,
  baseDelaySeconds: number,
  maxDelaySeconds: number,
): number {
  const delaySeconds = Math.min(
    baseDelaySeconds * Math.pow(2, retryCount - 1),
    maxDelaySeconds,
  );
  return Math.round(delaySeconds * 1000);
}

// ---------------------------------------------------------------------------
// Job processor
// ---------------------------------------------------------------------------

async function processJob(job: Job): Promise<void> {
  const { taskId } = job.data as { taskId: string };

  const config = getConfig();
  const correlationId = randomUUID();
  const startedAt = new Date();

  // ── Load task ────────────────────────────────────────────────────────────
  const task = await TaskModel.findById(taskId);
  if (!task) {
    logger.warn('Worker: job received for unknown task, skipping', { taskId, correlationId });
    return;
  }

  // Per-task timeout: use task.timeout if set, else fall back to config default
  const timeoutSeconds = task.timeout ?? config.task.defaultTimeoutSeconds;
  const timeoutMs = timeoutSeconds * 1000;

  logger.info('Worker: processing task', {
    taskId,
    type: task.type,
    correlationId,
    retryCount: task.retryCount,
    maxRetries: task.maxRetries,
    timeoutSeconds,
  });

  // ── Execute with timeout ─────────────────────────────────────────────────
  let executionResult: TaskExecutionResult;
  let isTimeout = false;

  try {
    executionResult = await withTimeout(dispatch(task), timeoutMs);
  } catch (err: unknown) {
    const errObj = err as Record<string, unknown>;
    if (errObj && errObj['isTimeout'] === true) {
      isTimeout = true;
      executionResult = {
        success: false,
        error: {
          code: String(errObj['code'] ?? 'EXECUTION_TIMEOUT'),
          message: String(errObj['message'] ?? 'Task execution timed out'),
        },
      };
    } else {
      // Unexpected thrown error from executor
      const message =
        err instanceof Error ? err.message : String(err);
      executionResult = {
        success: false,
        error: {
          code: 'EXECUTION_ERROR',
          message,
        },
      };
    }
  }

  const completedAt = new Date();

  // ── Determine execution record status ────────────────────────────────────
  const execStatus = executionResult.success
    ? ExecutionStatus.SUCCESS
    : isTimeout
      ? ExecutionStatus.TIMEOUT
      : ExecutionStatus.FAILED;

  // ── Build execution history entry ────────────────────────────────────────
  const historyEntry = {
    startedAt,
    completedAt,
    status: execStatus,
    ...(executionResult.error ? { error: executionResult.error } : {}),
    correlationId,
  };

  // ── Success path ─────────────────────────────────────────────────────────
  if (executionResult.success) {
    await TaskModel.findByIdAndUpdate(taskId, {
      $set: {
        status: TaskStatus.SUCCESS,
        ...(executionResult.result ? { result: executionResult.result } : {}),
      },
      $push: { executionHistory: historyEntry },
    });

    logger.info('Worker: task completed successfully', { taskId, correlationId });
    return;
  }

  // ── Failure path ─────────────────────────────────────────────────────────
  const maxRetries = task.maxRetries ?? config.task.defaultMaxRetries;
  const currentRetryCount = task.retryCount ?? 0;
  const retriesRemaining = currentRetryCount < maxRetries;

  if (retriesRemaining) {
    // Increment retry count
    const newRetryCount = currentRetryCount + 1;

    // Calculate backoff delay
    const backoffMs = calculateBackoffMs(
      newRetryCount,
      config.task.retryBaseDelaySeconds,
      config.task.retryMaxDelaySeconds,
    );

    // Update task to retrying status
    const updatedTask = await TaskModel.findByIdAndUpdate(
      taskId,
      {
        $set: {
          status: TaskStatus.RETRYING,
          retryCount: newRetryCount,
        },
        $push: { executionHistory: historyEntry },
      },
      { new: true },
    );

    if (!updatedTask) {
      logger.warn('Worker: task not found during retry update', { taskId, correlationId });
      return;
    }

    // Re-enqueue with exponential backoff delay
    await enqueue(updatedTask, backoffMs);

    logger.info('Worker: task scheduled for retry', {
      taskId,
      correlationId,
      retryCount: newRetryCount,
      maxRetries,
      backoffMs,
      isTimeout,
    });
  } else {
    // Max retries reached — mark as failed
    await TaskModel.findByIdAndUpdate(taskId, {
      $set: { status: TaskStatus.FAILED },
      $push: { executionHistory: historyEntry },
    });

    logger.warn('Worker: task failed after max retries', {
      taskId,
      correlationId,
      retryCount: currentRetryCount,
      maxRetries,
      error: executionResult.error,
      isTimeout,
    });
  }
}

// ---------------------------------------------------------------------------
// Worker lifecycle
// ---------------------------------------------------------------------------

let worker: Worker | null = null;

/**
 * Start the BullMQ worker.
 * Uses its own Redis connection (not the shared ioredis client) as required by
 * BullMQ's internal connection management.
 */
export function startWorker(): void {
  if (worker) {
    logger.warn('Worker: already started, ignoring startWorker() call');
    return;
  }

  const config = getConfig();

  worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      await processJob(job);
    },
    {
      connection: {
        host: config.redis.host,
        port: config.redis.port,
        ...(config.redis.password ? { password: config.redis.password } : {}),
      },
      // BullMQ's own retry mechanism is disabled — we manage retries manually
      // to maintain full control over status transitions and execution history.
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('Worker: BullMQ job failed (unhandled)', {
      jobId: job?.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  worker.on('error', (err) => {
    logger.error('Worker: BullMQ worker error', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  logger.info('Worker: started', { queue: QUEUE_NAME });
}

/**
 * Stop the BullMQ worker gracefully.
 * Waits for any in-progress jobs to complete before closing.
 */
export async function stopWorker(): Promise<void> {
  if (!worker) {
    return;
  }

  await worker.close();
  worker = null;

  logger.info('Worker: stopped');
}
