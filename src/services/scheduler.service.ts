/**
 * Scheduler Engine — orchestrates task dispatch for both one-time and recurring tasks.
 *
 * One-time tasks  : a polling loop runs every `pollIntervalMs` milliseconds and
 *                   picks up tasks whose `scheduleAt` falls within the current
 *                   5-second tolerance window.
 *
 * Recurring tasks : each task's `cronExpr` is registered with node-cron; when the
 *                   expression fires the engine queries MongoDB for the matching task
 *                   and enqueues it.
 *
 * Duplicate-execution prevention: the transition from `pending` → `running` is
 * performed via an atomic `findOneAndUpdate({ status: 'pending' })` so that a task
 * already in `running` state is never picked up again (Requirement 3.7).
 *
 * Requirements: 3.1, 3.2, 3.7
 */

import { schedule, validate, ScheduledTask } from 'node-cron';
import { getConfig } from '../config/index.js';
import { TaskModel, ITaskDocument, TaskStatus } from '../models/task.model.js';
import { enqueue } from './queue.service.js';
import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface SchedulerEngine {
  registerTask(task: ITaskDocument): Promise<void>;
  unregisterTask(taskId: string): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getRunningTasks(): string[];
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** node-cron jobs keyed by task _id string */
const cronJobs = new Map<string, ScheduledTask>();

/** Timer handle for the one-time-task polling loop */
let pollTimer: ReturnType<typeof setInterval> | null = null;

/** Track task IDs currently being transitioned to avoid in-process duplicates */
const inFlightTaskIds = new Set<string>();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Attempt to atomically transition a task from `pending` → `running` and
 * enqueue it.  Returns `true` if the task was successfully claimed.
 *
 * The `findOneAndUpdate` with `{ status: 'pending' }` in the filter ensures
 * that only one caller can claim any given task, even under concurrent polls
 * (Requirement 3.7).
 */
async function claimAndEnqueue(taskId: string): Promise<boolean> {
  // Fast in-process guard to avoid redundant DB round-trips
  if (inFlightTaskIds.has(taskId)) {
    return false;
  }
  inFlightTaskIds.add(taskId);

  try {
    const claimed = await TaskModel.findOneAndUpdate(
      { _id: taskId, status: TaskStatus.PENDING },
      { $set: { status: TaskStatus.RUNNING } },
      { new: true },
    );

    if (!claimed) {
      // Task was already running, cancelled, or otherwise no longer pending
      return false;
    }

    await enqueue(claimed);

    logger.info('Scheduler: task claimed and enqueued', {
      taskId,
      type: claimed.type,
    });

    return true;
  } catch (error) {
    logger.error('Scheduler: error claiming task', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  } finally {
    inFlightTaskIds.delete(taskId);
  }
}

/**
 * Poll MongoDB for one-time tasks whose `scheduleAt` falls within the
 * tolerance window [now - tolerance, now + tolerance].
 *
 * Requirement 3.1
 */
async function pollOneTimeTasks(): Promise<void> {
  const config = getConfig();
  const now = new Date();
  const toleranceMs = config.scheduler.maxToleranceMs;

  const windowStart = new Date(now.getTime() - toleranceMs);
  const windowEnd = new Date(now.getTime() + toleranceMs);

  let candidates: ITaskDocument[];

  try {
    candidates = await TaskModel.find({
      status: TaskStatus.PENDING,
      scheduleAt: { $gte: windowStart, $lte: windowEnd },
      cronExpr: { $exists: false },
    }).lean<ITaskDocument[]>();
  } catch (error) {
    logger.error('Scheduler: poll query failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (candidates.length === 0) return;

  logger.debug('Scheduler: one-time poll found candidates', {
    count: candidates.length,
    window: { start: windowStart.toISOString(), end: windowEnd.toISOString() },
  });

  await Promise.all(
    candidates.map((task) => claimAndEnqueue(task._id.toString())),
  );
}

/**
 * Register a node-cron job for a recurring task.
 * When the cron fires, query for the task by _id (still pending) and claim it.
 *
 * Requirement 3.2
 */
function registerCronJob(task: ITaskDocument): void {
  const taskId = task._id.toString();

  // Guard: don't register twice
  if (cronJobs.has(taskId)) {
    return;
  }

  const expression = task.cronExpr as string;

  if (!validate(expression)) {
    logger.warn('Scheduler: skipping task with invalid cronExpr', {
      taskId,
      cronExpr: expression,
    });
    return;
  }

  const job = schedule(
    expression,
    async () => {
      logger.debug('Scheduler: cron fired', { taskId, cronExpr: expression });

      // For cron tasks we re-query to make sure the task is still pending.
      // (The task may have been paused / cancelled since registration.)
      const current = await TaskModel.findOne({
        _id: taskId,
        status: TaskStatus.PENDING,
        cronExpr: expression,
      }).lean<ITaskDocument | null>();

      if (!current) {
        logger.debug('Scheduler: cron task no longer pending, skipping', { taskId });
        return;
      }

      await claimAndEnqueue(taskId);
    },
  );

  cronJobs.set(taskId, job);

  logger.info('Scheduler: cron job registered', { taskId, cronExpr: expression });
}

// ---------------------------------------------------------------------------
// Exported SchedulerEngine implementation
// ---------------------------------------------------------------------------

/**
 * Register a task with the scheduler.
 *
 * - If the task has a `cronExpr`, a node-cron job is created.
 * - If the task has a `scheduleAt`, nothing is done here — the polling loop
 *   will pick it up automatically.
 */
export async function registerTask(task: ITaskDocument): Promise<void> {
  if (task.cronExpr) {
    registerCronJob(task);
  }
  // One-time tasks are handled by the poll loop; no explicit registration needed.
}

/**
 * Unregister a task from the scheduler.
 * Stops and removes the node-cron job if one exists for the given taskId.
 */
export async function unregisterTask(taskId: string): Promise<void> {
  const job = cronJobs.get(taskId);

  if (job) {
    job.stop();
    cronJobs.delete(taskId);
    logger.info('Scheduler: cron job unregistered', { taskId });
  }
}

/**
 * Start the scheduler engine.
 *
 * 1. Starts the polling interval for one-time tasks.
 * 2. Loads all existing pending cron tasks from MongoDB and registers them.
 */
export async function start(): Promise<void> {
  if (pollTimer !== null) {
    logger.warn('Scheduler: already started, ignoring start() call');
    return;
  }

  const config = getConfig();
  const intervalMs = config.scheduler.pollIntervalMs;

  // Start one-time task poll loop
  pollTimer = setInterval(() => {
    pollOneTimeTasks().catch((err) => {
      logger.error('Scheduler: unhandled error in poll loop', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }, intervalMs);

  logger.info('Scheduler: poll loop started', { intervalMs });

  // Register all existing pending cron tasks
  try {
    const pendingCronTasks = await TaskModel.find({
      status: TaskStatus.PENDING,
      cronExpr: { $exists: true, $nin: [null, ''] },
    }).lean<ITaskDocument[]>();

    for (const task of pendingCronTasks) {
      registerCronJob(task);
    }

    logger.info('Scheduler: registered existing cron tasks', {
      count: pendingCronTasks.length,
    });
  } catch (error) {
    logger.error('Scheduler: failed to load existing cron tasks on start', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Stop the scheduler engine.
 * Clears the polling interval and stops all registered node-cron jobs.
 */
export async function stop(): Promise<void> {
  // Stop polling loop
  if (pollTimer !== null) {
    clearInterval(pollTimer);
    pollTimer = null;
    logger.info('Scheduler: poll loop stopped');
  }

  // Stop all cron jobs
  for (const [taskId, job] of cronJobs.entries()) {
    job.stop();
    logger.debug('Scheduler: cron job stopped on shutdown', { taskId });
  }
  cronJobs.clear();

  logger.info('Scheduler: all cron jobs stopped');
}

/**
 * Return the list of task IDs currently being transitioned (in-flight).
 * Primarily for observability and testing.
 */
export function getRunningTasks(): string[] {
  return Array.from(inFlightTaskIds);
}
