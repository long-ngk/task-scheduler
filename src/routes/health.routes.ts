/**
 * Health and readiness routes - Express router for system health check endpoints.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4
 */

import { Router, Request, Response } from 'express';
import { checkMongoDBHealth, checkRedisHealth } from '../config/database.js';

const router = Router();

/**
 * GET /health
 * Returns basic health status with timestamp and uptime.
 * Response time ≤ 500ms.
 *
 * Requirement 11.1
 */
router.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'up',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

/**
 * GET /ready
 * Checks MongoDB and Redis connections with 5s timeout each.
 * Returns 200 if all dependencies connected, 503 if any disconnected.
 *
 * Requirements: 11.2, 11.3, 11.4
 */
router.get('/ready', async (_req: Request, res: Response) => {
  const [mongoHealthy, redisHealthy] = await Promise.all([
    checkMongoDBHealth(),
    checkRedisHealth(),
  ]);

  const dependencies = {
    mongodb: mongoHealthy ? 'connected' : 'disconnected',
    redis: redisHealthy ? 'connected' : 'disconnected',
  };

  const allHealthy = mongoHealthy && redisHealthy;

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'ready' : 'not_ready',
    dependencies,
  });
});

export default router;
