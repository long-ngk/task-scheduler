/**
 * Database connection utility for MongoDB and Redis.
 * Provides connection management and health check methods
 * for the readiness endpoint.
 */

import mongoose from 'mongoose';
import Redis from 'ioredis';
import { getConfig } from '../config/index.js';

let redisClient: Redis | null = null;

const HEALTH_CHECK_TIMEOUT_MS = 5000;

/**
 * Connect to MongoDB using Mongoose.
 */
export async function connectMongoDB(): Promise<void> {
  const { mongodb } = getConfig();
  await mongoose.connect(mongodb.uri, { dbName: mongodb.dbName });
}

/**
 * Create and connect a Redis client using ioredis.
 */
export async function connectRedis(): Promise<void> {
  const { redis } = getConfig();

  redisClient = new Redis({
    host: redis.host,
    port: redis.port,
    ...(redis.password ? { password: redis.password } : {}),
    lazyConnect: true,
    maxRetriesPerRequest: 3,
  });

  await redisClient.connect();
}

/**
 * Get the Redis client instance.
 * Returns null if Redis has not been connected yet.
 */
export function getRedisClient(): Redis | null {
  return redisClient;
}

/**
 * Check MongoDB connection health with a 5-second timeout.
 * Returns true if connected, false otherwise.
 */
export async function checkMongoDBHealth(): Promise<boolean> {
  try {
    const result = await Promise.race([
      (async () => {
        if (mongoose.connection.readyState !== 1) {
          return false;
        }
        await mongoose.connection.db!.admin().ping();
        return true;
      })(),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), HEALTH_CHECK_TIMEOUT_MS)
      ),
    ]);
    return result;
  } catch {
    return false;
  }
}

/**
 * Check Redis connection health with a 5-second timeout.
 * Returns true if connected, false otherwise.
 */
export async function checkRedisHealth(): Promise<boolean> {
  try {
    if (!redisClient) {
      return false;
    }

    const result = await Promise.race([
      (async () => {
        const pong = await redisClient!.ping();
        return pong === 'PONG';
      })(),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), HEALTH_CHECK_TIMEOUT_MS)
      ),
    ]);
    return result;
  } catch {
    return false;
  }
}

/**
 * Gracefully disconnect both MongoDB and Redis.
 */
export async function disconnectAll(): Promise<void> {
  await Promise.allSettled([
    mongoose.disconnect(),
    redisClient ? redisClient.quit() : Promise.resolve(),
  ]);
  redisClient = null;
}
