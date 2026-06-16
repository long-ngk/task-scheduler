import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';

// Mock the config module
vi.mock('../../src/config/index.js', () => ({
  getConfig: () => ({
    mongodb: { uri: 'mongodb://localhost:27017', dbName: 'test_db' },
    redis: { host: 'localhost', port: 6379 },
  }),
}));

// Mock mongoose
vi.mock('mongoose', () => {
  const connection = {
    readyState: 1,
    db: {
      admin: () => ({
        ping: vi.fn().mockResolvedValue({ ok: 1 }),
      }),
    },
  };
  return {
    default: {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      connection,
    },
    __esModule: true,
  };
});

// Mock ioredis
vi.mock('ioredis', () => {
  class MockRedis {
    connect = vi.fn().mockResolvedValue(undefined);
    ping = vi.fn().mockResolvedValue('PONG');
    quit = vi.fn().mockResolvedValue('OK');
  }
  return { default: MockRedis };
});

describe('Database Connection Utility', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('connectMongoDB', () => {
    it('should call mongoose.connect with correct config', async () => {
      const { connectMongoDB } = await import('../../src/config/database.js');
      await connectMongoDB();
      expect(mongoose.connect).toHaveBeenCalledWith('mongodb://localhost:27017', {
        dbName: 'test_db',
      });
    });
  });

  describe('connectRedis', () => {
    it('should create Redis client and connect', async () => {
      const { connectRedis, getRedisClient } = await import('../../src/config/database.js');
      await connectRedis();
      const client = getRedisClient();
      expect(client).not.toBeNull();
      expect(client!.connect).toHaveBeenCalled();
    });
  });

  describe('getRedisClient', () => {
    it('should return null before connecting', async () => {
      const { getRedisClient } = await import('../../src/config/database.js');
      expect(getRedisClient()).toBeNull();
    });

    it('should return client after connecting', async () => {
      const { connectRedis, getRedisClient } = await import('../../src/config/database.js');
      await connectRedis();
      expect(getRedisClient()).not.toBeNull();
    });
  });

  describe('checkMongoDBHealth', () => {
    it('should return true when MongoDB is connected and responds to ping', async () => {
      const { checkMongoDBHealth } = await import('../../src/config/database.js');
      const result = await checkMongoDBHealth();
      expect(result).toBe(true);
    });

    it('should return false when MongoDB readyState is not 1', async () => {
      (mongoose.connection as any).readyState = 0;
      const { checkMongoDBHealth } = await import('../../src/config/database.js');
      const result = await checkMongoDBHealth();
      expect(result).toBe(false);
      (mongoose.connection as any).readyState = 1;
    });
  });

  describe('checkRedisHealth', () => {
    it('should return false when Redis client is not connected', async () => {
      const { checkRedisHealth } = await import('../../src/config/database.js');
      const result = await checkRedisHealth();
      expect(result).toBe(false);
    });

    it('should return true when Redis responds to ping', async () => {
      const { connectRedis, checkRedisHealth } = await import('../../src/config/database.js');
      await connectRedis();
      const result = await checkRedisHealth();
      expect(result).toBe(true);
    });
  });

  describe('disconnectAll', () => {
    it('should disconnect MongoDB and Redis', async () => {
      const { connectRedis, disconnectAll, getRedisClient } = await import(
        '../../src/config/database.js'
      );
      await connectRedis();
      const client = getRedisClient();
      await disconnectAll();
      expect(mongoose.disconnect).toHaveBeenCalled();
      expect(client!.quit).toHaveBeenCalled();
      expect(getRedisClient()).toBeNull();
    });

    it('should work even if Redis was never connected', async () => {
      const { disconnectAll } = await import('../../src/config/database.js');
      await expect(disconnectAll()).resolves.not.toThrow();
      expect(mongoose.disconnect).toHaveBeenCalled();
    });
  });
});
