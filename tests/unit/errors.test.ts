import { describe, it, expect } from 'vitest';
import {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  PayloadTooLargeError,
  ServiceUnavailableError,
  formatErrorResponse,
} from '../../src/utils/errors';

describe('Error Classes', () => {
  describe('AppError', () => {
    it('should create an error with statusCode, errorCode, and details', () => {
      const error = new AppError('Something went wrong', 500, 'INTERNAL_ERROR', { key: 'value' });

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AppError);
      expect(error.message).toBe('Something went wrong');
      expect(error.statusCode).toBe(500);
      expect(error.errorCode).toBe('INTERNAL_ERROR');
      expect(error.details).toEqual({ key: 'value' });
      expect(error.name).toBe('AppError');
    });

    it('should default details to empty object', () => {
      const error = new AppError('Error', 400, 'SOME_ERROR');
      expect(error.details).toEqual({});
    });
  });

  describe('ValidationError', () => {
    it('should have statusCode 400 and default errorCode VALIDATION_ERROR', () => {
      const error = new ValidationError('Invalid input');

      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(ValidationError);
      expect(error.statusCode).toBe(400);
      expect(error.errorCode).toBe('VALIDATION_ERROR');
      expect(error.message).toBe('Invalid input');
      expect(error.details).toEqual({});
    });

    it('should accept custom errorCode and details', () => {
      const details = [{ field: 'cronExpr', reason: 'Invalid format' }];
      const error = new ValidationError('Invalid cron', details, 'INVALID_CRON');

      expect(error.statusCode).toBe(400);
      expect(error.errorCode).toBe('INVALID_CRON');
      expect(error.details).toEqual(details);
    });
  });

  describe('NotFoundError', () => {
    it('should have statusCode 404 and default errorCode TASK_NOT_FOUND', () => {
      const error = new NotFoundError('Task not found');

      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(NotFoundError);
      expect(error.statusCode).toBe(404);
      expect(error.errorCode).toBe('TASK_NOT_FOUND');
      expect(error.message).toBe('Task not found');
    });
  });

  describe('ConflictError', () => {
    it('should have statusCode 409 and default errorCode INVALID_TASK_STATUS', () => {
      const error = new ConflictError('Cannot cancel a running task');

      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(ConflictError);
      expect(error.statusCode).toBe(409);
      expect(error.errorCode).toBe('INVALID_TASK_STATUS');
      expect(error.message).toBe('Cannot cancel a running task');
    });
  });

  describe('PayloadTooLargeError', () => {
    it('should have statusCode 413 and default errorCode PAYLOAD_TOO_LARGE', () => {
      const error = new PayloadTooLargeError('Payload exceeds 1MB limit');

      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(PayloadTooLargeError);
      expect(error.statusCode).toBe(413);
      expect(error.errorCode).toBe('PAYLOAD_TOO_LARGE');
      expect(error.message).toBe('Payload exceeds 1MB limit');
    });
  });

  describe('ServiceUnavailableError', () => {
    it('should have statusCode 503 and default errorCode SERVICE_UNAVAILABLE', () => {
      const error = new ServiceUnavailableError('Queue is unavailable');

      expect(error).toBeInstanceOf(AppError);
      expect(error).toBeInstanceOf(ServiceUnavailableError);
      expect(error.statusCode).toBe(503);
      expect(error.errorCode).toBe('SERVICE_UNAVAILABLE');
      expect(error.message).toBe('Queue is unavailable');
    });

    it('should accept custom errorCode', () => {
      const error = new ServiceUnavailableError('Queue down', {}, 'QUEUE_UNAVAILABLE');
      expect(error.errorCode).toBe('QUEUE_UNAVAILABLE');
    });
  });
});

describe('formatErrorResponse', () => {
  const correlationId = '550e8400-e29b-41d4-a716-446655440000';

  describe('with AppError', () => {
    it('should format a ValidationError correctly', () => {
      const details = [{ field: 'type', reason: 'Missing required field' }];
      const error = new ValidationError('Validation failed', details);

      const result = formatErrorResponse(error, correlationId);

      expect(result.statusCode).toBe(400);
      expect(result.body).toEqual({
        errorCode: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details,
        correlationId,
      });
    });

    it('should format a NotFoundError correctly', () => {
      const error = new NotFoundError('Task not found');

      const result = formatErrorResponse(error, correlationId);

      expect(result.statusCode).toBe(404);
      expect(result.body.errorCode).toBe('TASK_NOT_FOUND');
      expect(result.body.message).toBe('Task not found');
      expect(result.body.correlationId).toBe(correlationId);
    });

    it('should format a ConflictError correctly', () => {
      const error = new ConflictError('Invalid state transition');

      const result = formatErrorResponse(error, correlationId);

      expect(result.statusCode).toBe(409);
      expect(result.body.errorCode).toBe('INVALID_TASK_STATUS');
    });
  });

  describe('errorCode sanitization', () => {
    it('should truncate errorCode to 50 characters', () => {
      const longCode = 'A'.repeat(60) + '_ERROR';
      const error = new AppError('Error', 400, longCode);

      const result = formatErrorResponse(error, correlationId);

      expect(result.body.errorCode.length).toBeLessThanOrEqual(50);
    });

    it('should accept valid UPPER_SNAKE_CASE codes', () => {
      const error = new AppError('Error', 400, 'MY_CUSTOM_ERROR_CODE');

      const result = formatErrorResponse(error, correlationId);

      expect(result.body.errorCode).toBe('MY_CUSTOM_ERROR_CODE');
    });

    it('should convert camelCase to UPPER_SNAKE_CASE', () => {
      const error = new AppError('Error', 400, 'myCustomError');

      const result = formatErrorResponse(error, correlationId);

      expect(result.body.errorCode).toBe('MY_CUSTOM_ERROR');
    });

    it('should fall back to INTERNAL_ERROR for empty/invalid codes', () => {
      const error = new AppError('Error', 400, '');

      const result = formatErrorResponse(error, correlationId);

      expect(result.body.errorCode).toBe('INTERNAL_ERROR');
    });
  });

  describe('message sanitization', () => {
    it('should truncate message to 500 characters', () => {
      const longMessage = 'A'.repeat(600);
      const error = new ValidationError(longMessage);

      const result = formatErrorResponse(error, correlationId);

      expect(result.body.message.length).toBeLessThanOrEqual(500);
      expect(result.body.message.endsWith('...')).toBe(true);
    });

    it('should not truncate messages within 500 characters', () => {
      const message = 'Short message';
      const error = new ValidationError(message);

      const result = formatErrorResponse(error, correlationId);

      expect(result.body.message).toBe(message);
    });
  });

  describe('details sanitization', () => {
    it('should pass through arrays', () => {
      const details = [{ field: 'name', reason: 'required' }];
      const error = new ValidationError('Invalid', details);

      const result = formatErrorResponse(error, correlationId);

      expect(result.body.details).toEqual(details);
    });

    it('should pass through objects', () => {
      const details = { field: 'name', reason: 'required' };
      const error = new ValidationError('Invalid', details);

      const result = formatErrorResponse(error, correlationId);

      expect(result.body.details).toEqual(details);
    });

    it('should convert null details to empty object', () => {
      const error = new ValidationError('Invalid', null);

      const result = formatErrorResponse(error, correlationId);

      expect(result.body.details).toEqual({});
    });

    it('should convert primitive details to empty object', () => {
      const error = new ValidationError('Invalid', 'some string' as unknown);

      const result = formatErrorResponse(error, correlationId);

      expect(result.body.details).toEqual({});
    });
  });

  describe('500 error sanitization (Req 13.2)', () => {
    it('should sanitize messages containing stack traces', () => {
      const error = new AppError(
        'Error at processTask (/src/services/task.ts:42)',
        500,
        'INTERNAL_ERROR'
      );

      const result = formatErrorResponse(error, correlationId);

      expect(result.body.message).toBe('An internal error occurred');
      expect(result.body.details).toEqual({});
    });

    it('should sanitize messages containing file paths', () => {
      const error = new AppError(
        'Cannot read file C:\\Users\\dev\\project\\src\\index.ts',
        500,
        'INTERNAL_ERROR'
      );

      const result = formatErrorResponse(error, correlationId);

      expect(result.body.message).toBe('An internal error occurred');
    });

    it('should sanitize messages containing node_modules references', () => {
      const error = new AppError(
        'Module not found in node_modules/express',
        500,
        'INTERNAL_ERROR'
      );

      const result = formatErrorResponse(error, correlationId);

      expect(result.body.message).toBe('An internal error occurred');
    });

    it('should hide details for 500 errors', () => {
      const error = new AppError(
        'Database connection failed',
        500,
        'INTERNAL_ERROR',
        { host: 'localhost', port: 27017 }
      );

      const result = formatErrorResponse(error, correlationId);

      expect(result.body.details).toEqual({});
    });

    it('should hide details for 503 errors', () => {
      const error = new ServiceUnavailableError('Redis unavailable', {
        host: 'redis-server',
      });

      const result = formatErrorResponse(error, correlationId);

      expect(result.body.details).toEqual({});
    });
  });

  describe('non-AppError handling', () => {
    it('should produce INTERNAL_ERROR for generic Error', () => {
      const error = new Error('Something unexpected happened');

      const result = formatErrorResponse(error, correlationId);

      expect(result.statusCode).toBe(500);
      expect(result.body.errorCode).toBe('INTERNAL_ERROR');
      expect(result.body.message).toBe('An internal error occurred');
      expect(result.body.details).toEqual({});
      expect(result.body.correlationId).toBe(correlationId);
    });

    it('should produce INTERNAL_ERROR for TypeError', () => {
      const error = new TypeError('Cannot read property x of undefined');

      const result = formatErrorResponse(error, correlationId);

      expect(result.statusCode).toBe(500);
      expect(result.body.errorCode).toBe('INTERNAL_ERROR');
      expect(result.body.message).toBe('An internal error occurred');
      expect(result.body.details).toEqual({});
    });

    it('should not expose stack traces from generic errors', () => {
      const error = new Error('fail');
      error.stack = 'Error: fail\n    at Object.<anonymous> (/app/src/index.ts:10:5)';

      const result = formatErrorResponse(error, correlationId);

      expect(result.body.message).not.toContain('/app/src');
      expect(result.body.message).not.toContain('index.ts');
      expect(result.body.message).not.toContain('Object.<anonymous>');
    });
  });

  describe('correlationId inclusion (Req 13.5)', () => {
    it('should always include correlationId in the response', () => {
      const id = 'abc-123-def-456';
      const error = new ValidationError('Test');

      const result = formatErrorResponse(error, id);

      expect(result.body.correlationId).toBe(id);
    });
  });
});
