import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies before importing app
vi.mock('../../src/config/index.js', () => ({
  getConfig: () => ({
    queue: { maxPayloadSizeBytes: 1048576 },
  }),
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  asyncLocalStorage: {
    getStore: () => undefined,
    run: (_store: unknown, fn: () => void) => fn(),
  },
}));

vi.mock('../../src/config/database.js', () => ({
  checkMongoDBHealth: vi.fn().mockResolvedValue(true),
  checkRedisHealth: vi.fn().mockResolvedValue(true),
}));

describe('app.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should export a default express app', async () => {
    const { default: app } = await import('../../src/app.js');
    expect(app).toBeDefined();
    expect(typeof app.use).toBe('function');
    expect(typeof app.listen).toBe('function');
  });

  it('should be a valid Express application with routing capabilities', async () => {
    const { default: app } = await import('../../src/app.js');
    // Express 5 app should have get/post/use methods
    expect(typeof app.get).toBe('function');
    expect(typeof app.post).toBe('function');
    expect(typeof app.use).toBe('function');
  });

  it('should have process handlers registered for uncaughtException', async () => {
    await import('../../src/app.js');
    const listeners = process.listeners('uncaughtException');
    expect(listeners.length).toBeGreaterThan(0);
  });

  it('should have process handlers registered for unhandledRejection', async () => {
    await import('../../src/app.js');
    const listeners = process.listeners('unhandledRejection');
    expect(listeners.length).toBeGreaterThan(0);
  });
});
