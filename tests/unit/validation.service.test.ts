import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateCreateTask,
  validatePushTask,
  validateFileReadPayload,
  validateFileImportPayload,
  validateFormFillPayload,
  validateEmailPayload,
  validateCronExpression,
  validationService,
} from '../../src/services/validation.service.js';

describe('ValidationService', () => {
  describe('validateCronExpression', () => {
    it('should accept valid 5-field cron expression', () => {
      expect(validateCronExpression('0 * * * *')).toBe(true);
      expect(validateCronExpression('*/5 * * * *')).toBe(true);
      expect(validateCronExpression('0 0 1 1 0')).toBe(true);
      expect(validateCronExpression('0 0 * * 1-5')).toBe(true);
    });

    it('should accept valid 6-field cron expression', () => {
      expect(validateCronExpression('0 0 * * * *')).toBe(true);
      expect(validateCronExpression('*/10 */5 * * * *')).toBe(true);
    });

    it('should reject invalid cron expressions', () => {
      expect(validateCronExpression('')).toBe(false);
      expect(validateCronExpression('* * *')).toBe(false);  // too few fields
      expect(validateCronExpression('* * * * * * *')).toBe(false);  // too many fields
      expect(validateCronExpression('60 * * * *')).toBe(false);  // minute out of range
      expect(validateCronExpression('* 24 * * *')).toBe(false);  // hour out of range
      expect(validateCronExpression('* * 32 * *')).toBe(false);  // day of month out of range
      expect(validateCronExpression('* * * 13 *')).toBe(false);  // month out of range
      expect(validateCronExpression('* * * * 8')).toBe(false);  // day of week out of range
      expect(validateCronExpression('abc * * * *')).toBe(false);  // non-numeric
    });
  });

  describe('validateFileReadPayload', () => {
    it('should accept valid file read payload', () => {
      const result = validateFileReadPayload({ filePath: '/home/user/file.txt' });
      expect(result.valid).toBe(true);
    });

    it('should reject empty filePath', () => {
      const result = validateFileReadPayload({ filePath: '' });
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors![0].field).toBe('payload.filePath');
    });

    it('should reject filePath with path traversal', () => {
      const result = validateFileReadPayload({ filePath: '/home/../etc/passwd' });
      expect(result.valid).toBe(false);
      expect(result.errors![0].reason).toContain('path traversal');
    });

    it('should reject filePath exceeding 1024 chars', () => {
      const result = validateFileReadPayload({ filePath: 'a'.repeat(1025) });
      expect(result.valid).toBe(false);
      expect(result.errors![0].field).toBe('payload.filePath');
    });

    it('should reject missing filePath', () => {
      const result = validateFileReadPayload({});
      expect(result.valid).toBe(false);
    });
  });

  describe('validateFileImportPayload', () => {
    it('should accept valid file import payload', () => {
      const result = validateFileImportPayload({ filePaths: ['/home/user/data.csv'] });
      expect(result.valid).toBe(true);
    });

    it('should reject empty filePaths array', () => {
      const result = validateFileImportPayload({ filePaths: [] });
      expect(result.valid).toBe(false);
      expect(result.errors![0].field).toContain('payload');
    });

    it('should reject filePaths array exceeding 100 items', () => {
      const paths = Array.from({ length: 101 }, (_, i) => `/file${i}.csv`);
      const result = validateFileImportPayload({ filePaths: paths });
      expect(result.valid).toBe(false);
    });

    it('should reject individual filePath exceeding 1024 chars', () => {
      const result = validateFileImportPayload({ filePaths: ['a'.repeat(1025)] });
      expect(result.valid).toBe(false);
    });

    it('should reject missing filePaths', () => {
      const result = validateFileImportPayload({});
      expect(result.valid).toBe(false);
    });
  });

  describe('validateFormFillPayload', () => {
    it('should accept valid form fill payload', () => {
      const result = validateFormFillPayload({
        template: { name: { type: 'string', required: true } },
        data: { name: 'John' },
      });
      expect(result.valid).toBe(true);
    });

    it('should reject empty template', () => {
      const result = validateFormFillPayload({ template: {}, data: {} });
      expect(result.valid).toBe(false);
      expect(result.errors![0].reason).toContain('template must not be empty');
    });

    it('should reject missing template', () => {
      const result = validateFormFillPayload({ data: {} });
      expect(result.valid).toBe(false);
    });

    it('should reject missing data', () => {
      const result = validateFormFillPayload({
        template: { name: { type: 'string' } },
      });
      expect(result.valid).toBe(false);
    });
  });

  describe('validateEmailPayload', () => {
    it('should accept valid email payload', () => {
      const result = validateEmailPayload({
        subject: 'Test',
        body: 'Hello world',
        recipients: ['user@example.com'],
      });
      expect(result.valid).toBe(true);
    });

    it('should reject empty subject', () => {
      const result = validateEmailPayload({
        subject: '',
        body: 'Hello',
        recipients: ['user@example.com'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field.includes('subject'))).toBe(true);
    });

    it('should reject subject exceeding 255 chars', () => {
      const result = validateEmailPayload({
        subject: 'a'.repeat(256),
        body: 'Hello',
        recipients: ['user@example.com'],
      });
      expect(result.valid).toBe(false);
    });

    it('should reject body exceeding 64KB', () => {
      const result = validateEmailPayload({
        subject: 'Test',
        body: 'x'.repeat(65537),
        recipients: ['user@example.com'],
      });
      expect(result.valid).toBe(false);
    });

    it('should reject empty recipients', () => {
      const result = validateEmailPayload({
        subject: 'Test',
        body: 'Hello',
        recipients: [],
      });
      expect(result.valid).toBe(false);
    });

    it('should reject recipients exceeding 50 items', () => {
      const recipients = Array.from({ length: 51 }, (_, i) => `user${i}@example.com`);
      const result = validateEmailPayload({
        subject: 'Test',
        body: 'Hello',
        recipients,
      });
      expect(result.valid).toBe(false);
    });

    it('should reject invalid email format', () => {
      const result = validateEmailPayload({
        subject: 'Test',
        body: 'Hello',
        recipients: ['not-an-email'],
      });
      expect(result.valid).toBe(false);
      expect(result.errors![0].reason).toContain('RFC 5322');
    });
  });

  describe('validateCreateTask', () => {
    let futureDate: string;

    beforeEach(() => {
      futureDate = new Date(Date.now() + 60000).toISOString();
    });

    it('should accept valid create task with scheduleAt', () => {
      const result = validateCreateTask({
        type: 'file_read',
        payload: { filePath: '/home/user/file.txt' },
        scheduleAt: futureDate,
      });
      expect(result.valid).toBe(true);
    });

    it('should accept valid create task with cronExpr', () => {
      const result = validateCreateTask({
        type: 'email',
        payload: {
          subject: 'Report',
          body: 'Monthly report',
          recipients: ['admin@example.com'],
        },
        cronExpr: '0 0 * * *',
      });
      expect(result.valid).toBe(true);
    });

    it('should reject missing type', () => {
      const result = validateCreateTask({
        payload: { filePath: '/file.txt' },
        scheduleAt: futureDate,
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'type')).toBe(true);
    });

    it('should reject unsupported type', () => {
      const result = validateCreateTask({
        type: 'unknown_type',
        payload: {},
        scheduleAt: futureDate,
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'type' && e.reason.includes('Unsupported'))).toBe(true);
    });

    it('should reject missing both scheduleAt and cronExpr', () => {
      const result = validateCreateTask({
        type: 'file_read',
        payload: { filePath: '/file.txt' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'scheduleAt/cronExpr')).toBe(true);
    });

    it('should reject providing both scheduleAt and cronExpr', () => {
      const result = validateCreateTask({
        type: 'file_read',
        payload: { filePath: '/file.txt' },
        scheduleAt: futureDate,
        cronExpr: '0 * * * *',
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'scheduleAt/cronExpr')).toBe(true);
    });

    it('should reject scheduleAt in the past', () => {
      const result = validateCreateTask({
        type: 'file_read',
        payload: { filePath: '/file.txt' },
        scheduleAt: '2020-01-01T00:00:00Z',
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'scheduleAt' && e.reason.includes('future'))).toBe(true);
    });

    it('should reject invalid cronExpr format', () => {
      const result = validateCreateTask({
        type: 'file_read',
        payload: { filePath: '/file.txt' },
        cronExpr: 'invalid',
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'cronExpr')).toBe(true);
    });

    it('should reject timeout out of range', () => {
      const result = validateCreateTask({
        type: 'file_read',
        payload: { filePath: '/file.txt' },
        scheduleAt: futureDate,
        timeout: 0,
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'timeout')).toBe(true);

      const result2 = validateCreateTask({
        type: 'file_read',
        payload: { filePath: '/file.txt' },
        scheduleAt: futureDate,
        timeout: 3601,
      });
      expect(result2.valid).toBe(false);
    });

    it('should reject maxRetries out of range', () => {
      const result = validateCreateTask({
        type: 'file_read',
        payload: { filePath: '/file.txt' },
        scheduleAt: futureDate,
        maxRetries: -1,
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'maxRetries')).toBe(true);

      const result2 = validateCreateTask({
        type: 'file_read',
        payload: { filePath: '/file.txt' },
        scheduleAt: futureDate,
        maxRetries: 11,
      });
      expect(result2.valid).toBe(false);
    });

    it('should reject payload > 1MB', () => {
      const result = validateCreateTask({
        type: 'file_read',
        payload: { filePath: 'x'.repeat(1_100_000) },
        scheduleAt: futureDate,
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.reason.includes('1MB'))).toBe(true);
    });

    it('should reject null payload', () => {
      const result = validateCreateTask(null);
      expect(result.valid).toBe(false);
    });

    it('should validate payload per task type', () => {
      const result = validateCreateTask({
        type: 'email',
        payload: { subject: '', body: '', recipients: [] },
        scheduleAt: futureDate,
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field.startsWith('payload'))).toBe(true);
    });
  });

  describe('validatePushTask', () => {
    it('should accept valid push task', () => {
      const result = validatePushTask({
        type: 'file_read',
        payload: { filePath: '/home/user/file.txt' },
        idempotencyKey: 'unique-key-123',
      });
      expect(result.valid).toBe(true);
    });

    it('should reject missing idempotencyKey', () => {
      const result = validatePushTask({
        type: 'file_read',
        payload: { filePath: '/file.txt' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'idempotencyKey')).toBe(true);
    });

    it('should reject empty idempotencyKey', () => {
      const result = validatePushTask({
        type: 'file_read',
        payload: { filePath: '/file.txt' },
        idempotencyKey: '',
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'idempotencyKey')).toBe(true);
    });

    it('should reject idempotencyKey exceeding 256 chars', () => {
      const result = validatePushTask({
        type: 'file_read',
        payload: { filePath: '/file.txt' },
        idempotencyKey: 'a'.repeat(257),
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'idempotencyKey')).toBe(true);
    });

    it('should reject missing type', () => {
      const result = validatePushTask({
        payload: { filePath: '/file.txt' },
        idempotencyKey: 'key-1',
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'type')).toBe(true);
    });

    it('should reject unsupported type', () => {
      const result = validatePushTask({
        type: 'unknown',
        payload: {},
        idempotencyKey: 'key-1',
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'type')).toBe(true);
    });

    it('should reject missing payload', () => {
      const result = validatePushTask({
        type: 'file_read',
        idempotencyKey: 'key-1',
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'payload')).toBe(true);
    });

    it('should validate payload per task type', () => {
      const result = validatePushTask({
        type: 'email',
        payload: { subject: '', body: '', recipients: [] },
        idempotencyKey: 'key-1',
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field.startsWith('payload'))).toBe(true);
    });

    it('should reject timeout out of range', () => {
      const result = validatePushTask({
        type: 'file_read',
        payload: { filePath: '/file.txt' },
        idempotencyKey: 'key-1',
        timeout: 0,
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'timeout')).toBe(true);
    });

    it('should reject maxRetries out of range', () => {
      const result = validatePushTask({
        type: 'file_read',
        payload: { filePath: '/file.txt' },
        idempotencyKey: 'key-1',
        maxRetries: 11,
      });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'maxRetries')).toBe(true);
    });
  });

  describe('validatePaginationParams', () => {
    it('should accept valid pagination params', () => {
      const result = validationService.validatePaginationParams(1, 20);
      expect(result.valid).toBe(true);
    });

    it('should reject page < 1', () => {
      const result = validationService.validatePaginationParams(0, 20);
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'page')).toBe(true);
    });

    it('should reject pageSize > 100', () => {
      const result = validationService.validatePaginationParams(1, 101);
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.field === 'pageSize')).toBe(true);
    });

    it('should reject pageSize < 1', () => {
      const result = validationService.validatePaginationParams(1, 0);
      expect(result.valid).toBe(false);
    });
  });

  describe('validationService object exports', () => {
    it('should export all required functions', () => {
      expect(validationService.validateCreateTask).toBeDefined();
      expect(validationService.validatePushTask).toBeDefined();
      expect(validationService.validateFileReadPayload).toBeDefined();
      expect(validationService.validateFileImportPayload).toBeDefined();
      expect(validationService.validateFormFillPayload).toBeDefined();
      expect(validationService.validateEmailPayload).toBeDefined();
      expect(validationService.validateCronExpression).toBeDefined();
      expect(validationService.validatePaginationParams).toBeDefined();
    });
  });
});
