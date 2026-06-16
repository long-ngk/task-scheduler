/**
 * Application entry point.
 *
 * Bootstraps the server: connects to databases, registers executors,
 * starts the BullMQ worker, scheduler engine, and Express HTTP server.
 * Handles graceful shutdown on SIGTERM/SIGINT.
 *
 * Requirements: 11.1, 11.2
 */

import http from 'node:http';
import app from './app.js';
import { getConfig } from './config/index.js';
import { connectMongoDB, connectRedis, disconnectAll } from './config/database.js';
import { setExecutors, startWorker, stopWorker } from './services/worker.service.js';
import * as scheduler from './services/scheduler.service.js';
import { logger } from './utils/logger.js';
import { setSchedulerService, setQueueService, setIdempotencyService } from './services/task.service.js';
import * as idempotencyService from './services/idempotency.service.js';
import * as queueService from './services/queue.service.js';

// Executors
import { executeFileRead } from './executors/fileRead.executor.js';
import { executeFileImport } from './executors/fileImport.executor.js';
import { executeFormFill } from './executors/formFill.executor.js';
import { EmailExecutor } from './executors/email.executor.js';

async function main(): Promise<void> {
  const config = getConfig();

  // 1. Connect to MongoDB
  logger.info('Connecting to MongoDB...');
  await connectMongoDB();
  logger.info('MongoDB connected');

  // 2. Connect to Redis
  logger.info('Connecting to Redis...');
  await connectRedis();
  logger.info('Redis connected');

  // 3. Wire service dependencies for task.service
  setSchedulerService(scheduler);
  setQueueService(queueService);
  setIdempotencyService(idempotencyService);
  logger.info('Service dependencies wired');

  // 4. Register executors
  const emailExecutor = new EmailExecutor();
  setExecutors({
    file_read: executeFileRead as never,
    file_import: executeFileImport,
    form_fill: executeFormFill,
    email: (task) => emailExecutor.execute(task),
  });
  logger.info('Executors registered');

  // 5. Start BullMQ worker
  startWorker();
  logger.info('BullMQ worker started');

  // 6. Start scheduler engine
  await scheduler.start();
  logger.info('Scheduler engine started');

  // 7. Start HTTP server
  const server = http.createServer(app);
  server.listen(config.port, () => {
    logger.info(`HTTP server listening on port ${config.port}`);
  });

  // 8. Graceful shutdown handler
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down gracefully...`);

    try {
      await scheduler.stop();
      logger.info('Scheduler engine stopped');

      await stopWorker();
      logger.info('BullMQ worker stopped');

      await disconnectAll();
      logger.info('Database connections closed');

      server.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
      });
    } catch (error) {
      logger.error('Error during shutdown', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error('Failed to start application', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
