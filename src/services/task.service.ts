import { TaskModel, ITaskDocument, TaskStatus, TaskStatusType, TaskTypeValue, TASK_STATUSES, TASK_TYPES } from '../models/task.model.js';
import { validateCreateTask, validatePushTask, validatePaginationParams } from './validation.service.js';
import { ValidationError, NotFoundError, ConflictError, ServiceUnavailableError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getConfig } from '../config/index.js';

// --- Stub interfaces for services being implemented in parallel ---

export interface SchedulerService {
  registerTask(task: ITaskDocument): Promise<void>;
  unregisterTask(taskId: string): Promise<void>;
}

export interface QueueService {
  enqueue(task: ITaskDocument, delay?: number): Promise<void>;
  isAvailable(): Promise<boolean>;
}

export interface IdempotencyService {
  check(key: string): Promise<{ isDuplicate: boolean; existingTask?: ITaskDocument }>;
  register(key: string, taskId: string): Promise<void>;
}

// --- Service dependencies (to be injected) ---

let schedulerService: SchedulerService | null = null;
let queueService: QueueService | null = null;
let idempotencyService: IdempotencyService | null = null;

export function setSchedulerService(service: SchedulerService): void {
  schedulerService = service;
}

export function setQueueService(service: QueueService): void {
  queueService = service;
}

export function setIdempotencyService(service: IdempotencyService): void {
  idempotencyService = service;
}

// --- Interfaces ---

export interface CreateTaskPayload {
  type: TaskTypeValue;
  payload: Record<string, unknown>;
  scheduleAt?: string;
  cronExpr?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface PushTaskPayload {
  type: TaskTypeValue;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  timeout?: number;
  maxRetries?: number;
}

export interface ListTasksParams {
  page?: number;
  pageSize?: number;
  status?: string;
  type?: string;
}

export interface PaginatedResult {
  data: ITaskDocument[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface PushTaskResult {
  task: ITaskDocument;
  isDuplicate: boolean;
}

// --- Service functions ---

/**
 * Create a scheduled task.
 * Validates payload, saves task with status pending, registers with scheduler.
 *
 * Requirements: 1.1, 1.2
 */
export async function createTask(payload: unknown): Promise<ITaskDocument> {
  const validationResult = validateCreateTask(payload);

  if (!validationResult.valid) {
    throw new ValidationError('Request validation failed', validationResult.errors);
  }

  const body = payload as CreateTaskPayload;
  const config = getConfig();

  const task = new TaskModel({
    type: body.type,
    status: TaskStatus.PENDING,
    payload: body.payload,
    scheduleAt: body.scheduleAt ? new Date(body.scheduleAt) : undefined,
    cronExpr: body.cronExpr,
    timeout: body.timeout ?? config.task.defaultTimeoutSeconds,
    maxRetries: body.maxRetries ?? config.task.defaultMaxRetries,
    retryCount: 0,
    executionHistory: [],
  });

  const savedTask = await task.save();

  logger.info('Task created', { taskId: savedTask._id.toString(), type: savedTask.type, status: savedTask.status });

  // Register with scheduler if available
  if (schedulerService) {
    try {
      await schedulerService.registerTask(savedTask);
    } catch (error) {
      logger.warn('Failed to register task with scheduler', {
        taskId: savedTask._id.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return savedTask;
}

/**
 * Push a task from an external system.
 * Validates payload, checks idempotency, enqueues to BullMQ.
 *
 * Requirements: 2.1, 2.3, 2.5
 */
export async function pushTask(payload: unknown): Promise<PushTaskResult> {
  const validationResult = validatePushTask(payload);

  if (!validationResult.valid) {
    throw new ValidationError('Request validation failed', validationResult.errors);
  }

  const body = payload as PushTaskPayload;

  // Check idempotency
  if (idempotencyService) {
    const idempotencyResult = await idempotencyService.check(body.idempotencyKey);

    if (idempotencyResult.isDuplicate && idempotencyResult.existingTask) {
      logger.info('Duplicate task detected via idempotency key', {
        idempotencyKey: body.idempotencyKey,
        existingTaskId: idempotencyResult.existingTask._id.toString(),
      });
      return { task: idempotencyResult.existingTask, isDuplicate: true };
    }
  }

  // Check queue availability
  if (queueService) {
    const isAvailable = await queueService.isAvailable();
    if (!isAvailable) {
      throw new ServiceUnavailableError(
        'Queue service is temporarily unavailable. Cannot accept new tasks.',
        {},
        'QUEUE_UNAVAILABLE',
      );
    }
  }

  const config = getConfig();

  const task = new TaskModel({
    type: body.type,
    status: TaskStatus.PENDING,
    payload: body.payload,
    idempotencyKey: body.idempotencyKey,
    timeout: body.timeout ?? config.task.defaultTimeoutSeconds,
    maxRetries: body.maxRetries ?? config.task.defaultMaxRetries,
    retryCount: 0,
    executionHistory: [],
  });

  const savedTask = await task.save();

  // Register idempotency key
  if (idempotencyService) {
    try {
      await idempotencyService.register(body.idempotencyKey, savedTask._id.toString());
    } catch (error) {
      logger.warn('Failed to register idempotency key', {
        idempotencyKey: body.idempotencyKey,
        taskId: savedTask._id.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Enqueue to BullMQ
  if (queueService) {
    try {
      await queueService.enqueue(savedTask);
    } catch (error) {
      logger.warn('Failed to enqueue task', {
        taskId: savedTask._id.toString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  logger.info('Task pushed', { taskId: savedTask._id.toString(), type: savedTask.type, idempotencyKey: body.idempotencyKey });

  return { task: savedTask, isDuplicate: false };
}

/**
 * Get a task by ID with execution history.
 *
 * Requirements: 8.3, 8.4
 */
export async function getTaskById(id: string): Promise<ITaskDocument> {
  let task: ITaskDocument | null;

  try {
    task = await TaskModel.findById(id);
  } catch {
    throw new NotFoundError(`Task with id '${id}' not found`, { taskId: id });
  }

  if (!task) {
    throw new NotFoundError(`Task with id '${id}' not found`, { taskId: id });
  }

  return task;
}

/**
 * List tasks with pagination and filters.
 * Supports status and type filters. Page default 1, pageSize default 20 max 100.
 * Ordered by createdAt descending.
 *
 * Requirements: 8.1, 8.2, 8.5, 8.6
 */
export async function listTasks(params: ListTasksParams): Promise<PaginatedResult> {
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 20;

  // Validate pagination params
  const paginationValidation = validatePaginationParams(page, pageSize);
  if (!paginationValidation.valid) {
    throw new ValidationError('Invalid pagination parameters', paginationValidation.errors);
  }

  // Validate filter values
  if (params.status !== undefined && params.status !== '') {
    if (!TASK_STATUSES.includes(params.status as TaskStatusType)) {
      throw new ValidationError('Invalid status filter value', [
        { field: 'status', reason: `status must be one of: ${TASK_STATUSES.join(', ')}`, expected: `one of: ${TASK_STATUSES.join(', ')}` },
      ]);
    }
  }

  if (params.type !== undefined && params.type !== '') {
    if (!TASK_TYPES.includes(params.type as TaskTypeValue)) {
      throw new ValidationError('Invalid type filter value', [
        { field: 'type', reason: `type must be one of: ${TASK_TYPES.join(', ')}`, expected: `one of: ${TASK_TYPES.join(', ')}` },
      ]);
    }
  }

  // Build query filter
  const filter: Record<string, unknown> = {};

  if (params.status !== undefined && params.status !== '') {
    filter.status = params.status;
  }

  if (params.type !== undefined && params.type !== '') {
    filter.type = params.type;
  }

  const skip = (page - 1) * pageSize;

  const [data, total] = await Promise.all([
    TaskModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .exec(),
    TaskModel.countDocuments(filter).exec(),
  ]);

  const totalPages = Math.ceil(total / pageSize);

  return {
    data,
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
    },
  };
}

/**
 * Cancel a task. Valid transitions: pending → cancelled, paused → cancelled.
 *
 * Requirements: 10.1, 10.2, 10.6
 */
export async function cancelTask(id: string): Promise<ITaskDocument> {
  const task = await getTaskById(id);

  const allowedStatuses: TaskStatusType[] = [TaskStatus.PENDING, TaskStatus.PAUSED];

  if (!allowedStatuses.includes(task.status)) {
    throw new ConflictError(
      `Cannot cancel task in '${task.status}' status. Task can only be cancelled when in 'pending' or 'paused' status.`,
      { taskId: id, currentStatus: task.status, allowedStatuses },
    );
  }

  task.status = TaskStatus.CANCELLED;
  const updatedTask = await task.save();

  // Unregister from scheduler if available
  if (schedulerService) {
    try {
      await schedulerService.unregisterTask(id);
    } catch (error) {
      logger.warn('Failed to unregister task from scheduler', {
        taskId: id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  logger.info('Task cancelled', { taskId: id, previousStatus: task.status });

  return updatedTask;
}

/**
 * Pause a task. Valid transition: pending → paused.
 *
 * Requirements: 10.3, 10.5, 10.6
 */
export async function pauseTask(id: string): Promise<ITaskDocument> {
  const task = await getTaskById(id);

  if (task.status !== TaskStatus.PENDING) {
    throw new ConflictError(
      `Cannot pause task in '${task.status}' status. Task can only be paused when in 'pending' status.`,
      { taskId: id, currentStatus: task.status, allowedStatuses: [TaskStatus.PENDING] },
    );
  }

  task.status = TaskStatus.PAUSED;
  const updatedTask = await task.save();

  // Unregister from scheduler if available
  if (schedulerService) {
    try {
      await schedulerService.unregisterTask(id);
    } catch (error) {
      logger.warn('Failed to unregister task from scheduler on pause', {
        taskId: id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  logger.info('Task paused', { taskId: id });

  return updatedTask;
}

/**
 * Resume a paused task. Valid transition: paused → pending.
 *
 * Requirements: 10.4, 10.5, 10.6
 */
export async function resumeTask(id: string): Promise<ITaskDocument> {
  const task = await getTaskById(id);

  if (task.status !== TaskStatus.PAUSED) {
    throw new ConflictError(
      `Cannot resume task in '${task.status}' status. Task can only be resumed when in 'paused' status.`,
      { taskId: id, currentStatus: task.status, allowedStatuses: [TaskStatus.PAUSED] },
    );
  }

  task.status = TaskStatus.PENDING;
  const updatedTask = await task.save();

  // Re-register with scheduler if available
  if (schedulerService) {
    try {
      await schedulerService.registerTask(updatedTask);
    } catch (error) {
      logger.warn('Failed to re-register task with scheduler on resume', {
        taskId: id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  logger.info('Task resumed', { taskId: id });

  return updatedTask;
}
