/**
 * Express application setup.
 *
 * Registers middlewares, mounts routes, and sets up process-level error handlers.
 *
 * Requirements: 1.8, 13.3, 13.6
 */

import express from 'express';
import swaggerUi from 'swagger-ui-express';
import { getConfig } from './config/index.js';
import { swaggerSpec } from './config/swagger.js';
import { correlationIdMiddleware } from './middlewares/correlationId.middleware.js';
import { contentTypeMiddleware } from './middlewares/contentType.middleware.js';
import { requestLoggerMiddleware } from './middlewares/requestLogger.middleware.js';
import { errorHandler } from './middlewares/errorHandler.middleware.js';
import healthRoutes from './routes/health.routes.js';
import scheduleRoutes from './routes/schedule.routes.js';
import { logger } from './utils/logger.js';

const app = express();

// --- Middlewares (order matters) ---

// 1. Body parser with 1MB limit from config
const config = getConfig();
app.use(express.json({ limit: config.queue.maxPayloadSizeBytes }));

// 2. Correlation ID middleware
app.use(correlationIdMiddleware);

// 3. Content-Type validation middleware
app.use(contentTypeMiddleware);

// 4. Request logger middleware
app.use(requestLoggerMiddleware);

// --- API Documentation (Swagger UI) ---
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api-docs.json', (_req, res) => {
  res.json(swaggerSpec);
});

// --- Routes ---

// Health routes at root level (GET /health, GET /ready)
app.use(healthRoutes);

// Schedule routes at /api/schedules
app.use('/api/schedules', scheduleRoutes);

// --- Error handler (must be last) ---
app.use(errorHandler);

// --- Process-level error handlers (Requirement 13.3) ---

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception', {
    error: error.message,
    stack: error.stack,
  });
});

process.on('unhandledRejection', (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  logger.error('Unhandled rejection', {
    reason: message,
    stack,
  });
});

export default app;
