import { IdempotencyKeyModel } from '../models/idempotencyKey.model.js';
import { TaskModel, ITaskDocument } from '../models/task.model.js';
import { logger } from '../utils/logger.js';

// --- Interfaces ---

export interface IdempotencyResult {
  isDuplicate: boolean;
  existingTask?: ITaskDocument;
}

// --- Public Functions ---

/**
 * Check if an idempotency key already exists.
 * If found, returns the associated task document.
 */
export async function check(idempotencyKey: string): Promise<IdempotencyResult> {
  logger.debug('Checking idempotency key', { idempotencyKey });

  const existing = await IdempotencyKeyModel.findOne({ key: idempotencyKey }).exec();

  if (!existing) {
    logger.debug('Idempotency key not found', { idempotencyKey });
    return { isDuplicate: false };
  }

  logger.info('Idempotency key found, fetching existing task', {
    idempotencyKey,
    taskId: existing.taskId,
  });

  const existingTask = await TaskModel.findById(existing.taskId).exec();

  if (!existingTask) {
    logger.warn('Idempotency key exists but associated task not found', {
      idempotencyKey,
      taskId: existing.taskId,
    });
    return { isDuplicate: false };
  }

  return { isDuplicate: true, existingTask };
}

/**
 * Register a new idempotency key with the associated task ID.
 * Handles concurrent duplicate key requests gracefully using MongoDB unique index.
 */
export async function register(idempotencyKey: string, taskId: string): Promise<void> {
  logger.debug('Registering idempotency key', { idempotencyKey, taskId });

  try {
    await IdempotencyKeyModel.create({ key: idempotencyKey, taskId });
    logger.info('Idempotency key registered successfully', { idempotencyKey, taskId });
  } catch (error: unknown) {
    // Handle MongoDB duplicate key error (E11000)
    if (isDuplicateKeyError(error)) {
      logger.warn('Idempotency key already exists (concurrent request)', {
        idempotencyKey,
        taskId,
      });
      return;
    }
    throw error;
  }
}

// --- Helper Functions ---

function isDuplicateKeyError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    return (error as { code: number }).code === 11000;
  }
  return false;
}
