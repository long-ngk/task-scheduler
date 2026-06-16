import { describe, it, expect } from 'vitest';
import {
  TaskStatus,
  TaskType,
  ExecutionStatus,
  TASK_STATUSES,
  TASK_TYPES,
  TaskModel,
} from '../../src/models/task.model.js';

describe('Task Model', () => {
  describe('Enums and Constants', () => {
    it('should define all task statuses', () => {
      expect(TASK_STATUSES).toEqual([
        'pending',
        'running',
        'success',
        'failed',
        'retrying',
        'cancelled',
        'paused',
      ]);
    });

    it('should define all task types', () => {
      expect(TASK_TYPES).toEqual(['file_read', 'file_import', 'form_fill', 'email']);
    });

    it('should define execution statuses', () => {
      expect(ExecutionStatus.SUCCESS).toBe('success');
      expect(ExecutionStatus.FAILED).toBe('failed');
      expect(ExecutionStatus.TIMEOUT).toBe('timeout');
    });

    it('should define TaskStatus enum values', () => {
      expect(TaskStatus.PENDING).toBe('pending');
      expect(TaskStatus.RUNNING).toBe('running');
      expect(TaskStatus.SUCCESS).toBe('success');
      expect(TaskStatus.FAILED).toBe('failed');
      expect(TaskStatus.RETRYING).toBe('retrying');
      expect(TaskStatus.CANCELLED).toBe('cancelled');
      expect(TaskStatus.PAUSED).toBe('paused');
    });

    it('should define TaskType enum values', () => {
      expect(TaskType.FILE_READ).toBe('file_read');
      expect(TaskType.FILE_IMPORT).toBe('file_import');
      expect(TaskType.FORM_FILL).toBe('form_fill');
      expect(TaskType.EMAIL).toBe('email');
    });
  });

  describe('Schema Definition', () => {
    it('should have the correct schema paths', () => {
      const schemaPaths = Object.keys(TaskModel.schema.paths);
      expect(schemaPaths).toContain('type');
      expect(schemaPaths).toContain('status');
      expect(schemaPaths).toContain('payload');
      expect(schemaPaths).toContain('scheduleAt');
      expect(schemaPaths).toContain('cronExpr');
      expect(schemaPaths).toContain('idempotencyKey');
      expect(schemaPaths).toContain('timeout');
      expect(schemaPaths).toContain('maxRetries');
      expect(schemaPaths).toContain('retryCount');
      expect(schemaPaths).toContain('result');
      expect(schemaPaths).toContain('executionHistory');
      expect(schemaPaths).toContain('createdAt');
      expect(schemaPaths).toContain('updatedAt');
    });

    it('should have correct default values', () => {
      const statusPath = TaskModel.schema.path('status');
      const timeoutPath = TaskModel.schema.path('timeout');
      const maxRetriesPath = TaskModel.schema.path('maxRetries');
      const retryCountPath = TaskModel.schema.path('retryCount');

      expect((statusPath as any).defaultValue).toBe('pending');
      expect((timeoutPath as any).defaultValue).toBe(30);
      expect((maxRetriesPath as any).defaultValue).toBe(3);
      expect((retryCountPath as any).defaultValue).toBe(0);
    });

    it('should have required fields', () => {
      const typePath = TaskModel.schema.path('type');
      const statusPath = TaskModel.schema.path('status');
      const payloadPath = TaskModel.schema.path('payload');
      const timeoutPath = TaskModel.schema.path('timeout');
      const maxRetriesPath = TaskModel.schema.path('maxRetries');
      const retryCountPath = TaskModel.schema.path('retryCount');

      expect((typePath as any).isRequired).toBe(true);
      expect((statusPath as any).isRequired).toBe(true);
      expect((payloadPath as any).isRequired).toBe(true);
      expect((timeoutPath as any).isRequired).toBe(true);
      expect((maxRetriesPath as any).isRequired).toBe(true);
      expect((retryCountPath as any).isRequired).toBe(true);
    });

    it('should have timestamps enabled', () => {
      const options = TaskModel.schema.options;
      expect(options.timestamps).toBe(true);
    });
  });

  describe('Indexes', () => {
    it('should define the correct compound indexes', () => {
      const indexes = TaskModel.schema.indexes();
      const indexFields = indexes.map(([fields]) => fields);

      expect(indexFields).toContainEqual({ status: 1, scheduleAt: 1 });
      expect(indexFields).toContainEqual({ status: 1, type: 1 });
      expect(indexFields).toContainEqual({ createdAt: -1 });
      expect(indexFields).toContainEqual({ cronExpr: 1, status: 1 });
    });
  });

  describe('Schema Validation Rules', () => {
    it('should restrict type to valid enum values', () => {
      const typePath = TaskModel.schema.path('type') as any;
      expect(typePath.enumValues).toEqual(['file_read', 'file_import', 'form_fill', 'email']);
    });

    it('should restrict status to valid enum values', () => {
      const statusPath = TaskModel.schema.path('status') as any;
      expect(statusPath.enumValues).toEqual([
        'pending',
        'running',
        'success',
        'failed',
        'retrying',
        'cancelled',
        'paused',
      ]);
    });

    it('should have min/max validators for timeout', () => {
      const timeoutPath = TaskModel.schema.path('timeout') as any;
      const validators = timeoutPath.validators;
      const minValidator = validators.find((v: any) => v.type === 'min');
      const maxValidator = validators.find((v: any) => v.type === 'max');
      expect(minValidator.min).toBe(1);
      expect(maxValidator.max).toBe(3600);
    });

    it('should have min/max validators for maxRetries', () => {
      const maxRetriesPath = TaskModel.schema.path('maxRetries') as any;
      const validators = maxRetriesPath.validators;
      const minValidator = validators.find((v: any) => v.type === 'min');
      const maxValidator = validators.find((v: any) => v.type === 'max');
      expect(minValidator.min).toBe(0);
      expect(maxValidator.max).toBe(10);
    });
  });
});
