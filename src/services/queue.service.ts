/**
 * Queue service using BullMQ and Redis.
 * Provides task enqueueing and availability checking.
 *
 * Requirements: 2.1, 2.4
 */

import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { getRedisClient } from '../config/database.js';
import { getConfig } from '../config/index.js';
import { ITaskDocument } from '../models/task.model.js';
import { logger } from '../utils/logger.js';

export const QUEUE_NAME = 'task-queue';

let queue: Queue | null = null;

/**
 * Get or lazily initialise the BullMQ Queue instance.
 *
 * BullMQ bundles its own copy of ioredis whose types are not compatible with
 * the project-level ioredis instance.  To avoid the type mismatch we always
 * create a BullMQ-owned connection using plain connection options derived from
 * AppConfig.  The shared ioredis client (from database.ts) is only used for
 * the lightweight ping in isAvailable().
 */
function getQueue(): Queue {
  if (queue) {
    return queue;
  }

  const config = getConfig();

  queue = new Queue(QUEUE_NAME, {
    connection: {
      host: config.redis.host,
      port: config.redis.port,
      ...(config.redis.password ? { password: config.redis.password } : {}),
    },
  });

  return queue;
}

/**
 * Add a task to the BullMQ queue.
 *
 * The job ID is set to the task's MongoDB _id string so that BullMQ can
 * deduplicate jobs for the same task if enqueue is called more than once.
 *
 * @param task   - The task document to enqueue.
 * @param delay  - Optional delay in milliseconds before the job becomes active.
 */
export async function enqueue(task: ITaskDocument, delay?: number): Promise<void> {
  const q = getQueue();
  const taskId = task._id.toString();

  await q.add(
    taskId,
    { taskId },
    {
      jobId: taskId,
      ...(delay !== undefined && delay > 0 ? { delay } : {}),
    },
  );

  logger.info('Task enqueued', { taskId, delay: delay ?? 0 });
}

/**
 * Check whether the BullMQ queue (and its underlying Redis connection) is
 * healthy enough to accept new jobs.
 *
 * Prefers pinging via the shared ioredis client (from database.ts).
 * If that client is not yet initialised, creates a temporary ioredis
 * connection using AppConfig and closes it immediately after the check.
 *
 * Returns true on a successful PONG, false on any error.
 */
export async function isAvailable(): Promise<boolean> {
  try {
    // Prefer the shared client – avoids opening an extra connection
    const sharedClient = getRedisClient();
    if (sharedClient) {
      const pong = await sharedClient.ping();
      return pong === 'PONG';
    }

    // No shared client yet – create a temporary one just for the ping
    const config = getConfig();
    const tempClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      ...(config.redis.password ? { password: config.redis.password } : {}),
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });

    try {
      await tempClient.connect();
      const pong = await tempClient.ping();
      return pong === 'PONG';
    } finally {
      await tempClient.quit();
    }
  } catch (error) {
    logger.warn('Queue availability check failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return false;
  }
}

/**
 * Close the BullMQ queue connection gracefully.
 * Should be called during application shutdown.
 */
export async function closeQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
}
