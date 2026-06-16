import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { errorHandler, methodNotAllowed } from '../../src/middlewares/errorHandler.middleware';
import {
  AppError,
  ValidationError,
  NotFoundError,
  PayloadTooLargeError,
  ServiceUnavailableError,
} from '../../src/utils/errors';
import { asyncLocalStorage } from '../../src/utils/logger';

// Mock the logger to avoid noisy output in tests
vi.mock('../../src/utils/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/utils/logger')>();
  return {
    ...actual,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'GET',
    path: '/api/tasks',
    ...overrides,
  } as unknown as Request;
}

function createMockResponse(): Response & { _status: number; _json: unknown } {
  const res = {
    _status: 0,
    _json: null as unknown,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: unknown) {
      res._json = body;
      return res;
    },
    getHeader(_name: string) {
      return undefined;
    },
  };
  return res as unknown as Response & { _status: number; _json: unknown };
}

const noopNext: NextFunction = () => {};

describe('errorHandler middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('correlationId resolution', () => {
    it('should use correlationId from asyncLocalStorage', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new ValidationError('Invalid input');

      asyncLocalStorage.run({ correlationId: 'store-correlation-id' }, () => {
        errorHandler(error, req, res as unknown as Response, noopNext);
      });

      const body = res._json as { correlationId: string };
      expect(body.correlationId).toBe('store-correlation-id');
    });

    it('should fallback to X-Correlation-ID response header', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      res.getHeader = (name: string) => {
        if (name === 'X-Correlation-ID') return 'header-correlation-id';
        return undefined;
      };
      const error = new ValidationError('Invalid input');

      // Run outside asyncLocalStorage so store is undefined
      errorHandler(error, req, res as unknown as Response, noopNext);

      const body = res._json as { correlationId: string };
      expect(body.correlationId).toBe('header-correlation-id');
    });

    it('should fallback to "unknown" when no correlationId is available', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new ValidationError('Invalid input');

      errorHandler(error, req, res as unknown as Response, noopNext);

      const body = res._json as { correlationId: string };
      expect(body.correlationId).toBe('unknown');
    });
  });

  describe('AppError handling', () => {
    it('should return correct status code for ValidationError (400)', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new ValidationError('Invalid field', [{ field: 'name', reason: 'required' }]);

      errorHandler(error, req, res as unknown as Response, noopNext);

      expect(res._status).toBe(400);
      const body = res._json as { errorCode: string; message: string; details: unknown };
      expect(body.errorCode).toBe('VALIDATION_ERROR');
      expect(body.message).toBe('Invalid field');
      expect(body.details).toEqual([{ field: 'name', reason: 'required' }]);
    });

    it('should return correct status code for NotFoundError (404)', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new NotFoundError('Task not found');

      errorHandler(error, req, res as unknown as Response, noopNext);

      expect(res._status).toBe(404);
      const body = res._json as { errorCode: string; message: string };
      expect(body.errorCode).toBe('TASK_NOT_FOUND');
      expect(body.message).toBe('Task not found');
    });

    it('should return correct status code for PayloadTooLargeError (413)', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new PayloadTooLargeError('Payload exceeds 1MB limit');

      errorHandler(error, req, res as unknown as Response, noopNext);

      expect(res._status).toBe(413);
      const body = res._json as { errorCode: string; message: string };
      expect(body.errorCode).toBe('PAYLOAD_TOO_LARGE');
      expect(body.message).toBe('Payload exceeds 1MB limit');
    });

    it('should return correct status code for ServiceUnavailableError (503)', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new ServiceUnavailableError('Queue is down');

      errorHandler(error, req, res as unknown as Response, noopNext);

      expect(res._status).toBe(503);
      const body = res._json as { errorCode: string; details: unknown };
      expect(body.errorCode).toBe('SERVICE_UNAVAILABLE');
      // 503 is >= 500, so details should be sanitized
      expect(body.details).toEqual({});
    });
  });

  describe('payload too large conversion (Req 13.4)', () => {
    it('should convert Express entity.too.large error to PayloadTooLargeError', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const bodyParserError = Object.assign(new Error('request entity too large'), {
        type: 'entity.too.large',
        status: 413,
      });

      errorHandler(bodyParserError, req, res as unknown as Response, noopNext);

      expect(res._status).toBe(413);
      const body = res._json as { errorCode: string; message: string };
      expect(body.errorCode).toBe('PAYLOAD_TOO_LARGE');
      expect(body.message).toBe('Request body exceeds the 1MB size limit');
    });
  });

  describe('500 error sanitization (Req 13.2)', () => {
    it('should not expose stack traces in 500 errors', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new Error('TypeError at processTask (/src/services/task.ts:42)');

      errorHandler(error, req, res as unknown as Response, noopNext);

      expect(res._status).toBe(500);
      const body = res._json as { errorCode: string; message: string; details: unknown };
      expect(body.errorCode).toBe('INTERNAL_ERROR');
      expect(body.message).toBe('An internal error occurred');
      expect(body.details).toEqual({});
    });

    it('should not expose file paths in 500 errors', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new AppError(
        'Cannot load C:\\Users\\dev\\project\\config.ts',
        500,
        'INTERNAL_ERROR',
        { file: 'config.ts' }
      );

      errorHandler(error, req, res as unknown as Response, noopNext);

      expect(res._status).toBe(500);
      const body = res._json as { message: string; details: unknown };
      expect(body.message).toBe('An internal error occurred');
      expect(body.details).toEqual({});
    });

    it('should hide internal details for generic Error', () => {
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new Error('Connection refused');

      errorHandler(error, req, res as unknown as Response, noopNext);

      expect(res._status).toBe(500);
      const body = res._json as { errorCode: string; message: string; details: unknown };
      expect(body.errorCode).toBe('INTERNAL_ERROR');
      expect(body.message).toBe('An internal error occurred');
      expect(body.details).toEqual({});
    });
  });

  describe('logging', () => {
    it('should log the error using the logger', async () => {
      const { logger } = await import('../../src/utils/logger');
      const req = createMockRequest();
      const res = createMockResponse();
      const error = new ValidationError('Bad input');

      errorHandler(error, req, res as unknown as Response, noopNext);

      expect(logger.error).toHaveBeenCalledWith('Request error', expect.objectContaining({
        statusCode: 400,
        errorCode: 'VALIDATION_ERROR',
        message: 'Bad input',
      }));
    });
  });
});

describe('methodNotAllowed middleware (Req 13.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 405 with METHOD_NOT_ALLOWED error code', () => {
    const req = createMockRequest({ method: 'PATCH', path: '/api/tasks' });
    const res = createMockResponse();

    methodNotAllowed(req, res as unknown as Response, noopNext);

    expect(res._status).toBe(405);
    const body = res._json as { errorCode: string; message: string; correlationId: string };
    expect(body.errorCode).toBe('METHOD_NOT_ALLOWED');
    expect(body.message).toContain('PATCH');
    expect(body.message).toContain('/api/tasks');
  });

  it('should include correlationId from asyncLocalStorage', () => {
    const req = createMockRequest({ method: 'DELETE', path: '/api/tasks' });
    const res = createMockResponse();

    asyncLocalStorage.run({ correlationId: 'method-corr-id' }, () => {
      methodNotAllowed(req, res as unknown as Response, noopNext);
    });

    const body = res._json as { correlationId: string };
    expect(body.correlationId).toBe('method-corr-id');
  });

  it('should fallback correlationId to "unknown" when not available', () => {
    const req = createMockRequest({ method: 'PUT', path: '/api/unknown' });
    const res = createMockResponse();

    methodNotAllowed(req, res as unknown as Response, noopNext);

    const body = res._json as { correlationId: string };
    expect(body.correlationId).toBe('unknown');
  });
});
