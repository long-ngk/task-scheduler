import { describe, it, expect, vi, beforeEach } from 'vitest';
import { check, register, IdempotencyResult } from '../../src/services/idempotency.service.js';

// Mock the models
vi.mock('../../src/models/idempotencyKey.model.js', () => ({
  IdempotencyKeyModel: {
    findOne: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('../../src/models/task.model.js', () => ({
  TaskModel: {
    findById: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { IdempotencyKeyModel } from '../../src/models/idempotencyKey.model.js';
import { TaskModel } from '../../src/models/task.model.js';

describe('IdempotencyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('check', () => {
    it('should return isDuplicate: false when key does not exist', async () => {
      vi.mocked(IdempotencyKeyModel.findOne).mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      } as never);

      const result: IdempotencyResult = await check('non-existent-key');

      expect(result.isDuplicate).toBe(false);
      expect(result.existingTask).toBeUndefined();
      expect(IdempotencyKeyModel.findOne).toHaveBeenCalledWith({ key: 'non-existent-key' });
    });

    it('should return isDuplicate: true with existing task when key exists', async () => {
      const mockTask = { _id: 'task-123', type: 'email', status: 'pending' };

      vi.mocked(IdempotencyKeyModel.findOne).mockReturnValue({
        exec: vi.fn().mockResolvedValue({ key: 'my-key', taskId: 'task-123' }),
      } as never);

      vi.mocked(TaskModel.findById).mockReturnValue({
        exec: vi.fn().mockResolvedValue(mockTask),
      } as never);

      const result: IdempotencyResult = await check('my-key');

      expect(result.isDuplicate).toBe(true);
      expect(result.existingTask).toEqual(mockTask);
      expect(TaskModel.findById).toHaveBeenCalledWith('task-123');
    });

    it('should return isDuplicate: false when key exists but task is not found', async () => {
      vi.mocked(IdempotencyKeyModel.findOne).mockReturnValue({
        exec: vi.fn().mockResolvedValue({ key: 'orphan-key', taskId: 'deleted-task' }),
      } as never);

      vi.mocked(TaskModel.findById).mockReturnValue({
        exec: vi.fn().mockResolvedValue(null),
      } as never);

      const result: IdempotencyResult = await check('orphan-key');

      expect(result.isDuplicate).toBe(false);
      expect(result.existingTask).toBeUndefined();
    });
  });

  describe('register', () => {
    it('should create a new idempotency key record', async () => {
      vi.mocked(IdempotencyKeyModel.create).mockResolvedValue({} as never);

      await register('new-key', 'task-456');

      expect(IdempotencyKeyModel.create).toHaveBeenCalledWith({
        key: 'new-key',
        taskId: 'task-456',
      });
    });

    it('should handle duplicate key error gracefully (code 11000)', async () => {
      const duplicateError = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
      vi.mocked(IdempotencyKeyModel.create).mockRejectedValue(duplicateError);

      // Should not throw
      await expect(register('duplicate-key', 'task-789')).resolves.toBeUndefined();
    });

    it('should rethrow non-duplicate errors', async () => {
      const otherError = new Error('Connection timeout');
      vi.mocked(IdempotencyKeyModel.create).mockRejectedValue(otherError);

      await expect(register('key', 'task-1')).rejects.toThrow('Connection timeout');
    });
  });
});
