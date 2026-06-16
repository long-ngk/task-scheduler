import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import { EventEmitter } from 'events';
import { requestLoggerMiddleware } from '../../src/middlewares/requestLogger.middleware';
import { asyncLocalStorage, LogEntry } from '../../src/utils/logger';

describe('Request Logger Middleware', () => {
  let writtenOutput: string[];

  beforeEach(() => {
    writtenOutput = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writtenOutput.push(chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function getLastLogEntry(): LogEntry & { context?: Record<string, unknown> } {
    const lastLine = writtenOutput[writtenOutput.length - 1];
    return JSON.parse(lastLine.trim());
  }

  function createMockReq(overrides: Partial<Request> = {}): Request {
    return {
      method: 'GET',
      path: '/api/schedules',
      ...overrides,
    } as Request;
  }

  function createMockRes(): Response & EventEmitter {
    const res = new EventEmitter() as Response & EventEmitter;
    res.statusCode = 200;
    return res;
  }

  it('should call next immediately', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    requestLoggerMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('should log request details on response finish', () => {
    const req = createMockReq({ method: 'POST', path: '/api/schedules' });
    const res = createMockRes();
    res.statusCode = 201;
    const next = vi.fn();

    requestLoggerMiddleware(req, res, next);
    res.emit('finish');

    const entry = getLastLogEntry();
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('HTTP Request');
    expect(entry.context).toBeDefined();
    expect(entry.context!.method).toBe('POST');
    expect(entry.context!.path).toBe('/api/schedules');
    expect(entry.context!.statusCode).toBe(201);
  });

  it('should include responseTime in milliseconds', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    requestLoggerMiddleware(req, res, next);
    res.emit('finish');

    const entry = getLastLogEntry();
    expect(entry.context!.responseTime).toBeTypeOf('number');
    expect(entry.context!.responseTime).toBeGreaterThanOrEqual(0);
  });

  it('should include timestamp in ISO 8601 format', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    requestLoggerMiddleware(req, res, next);
    res.emit('finish');

    const entry = getLastLogEntry();
    const timestamp = entry.context!.timestamp as string;
    expect(timestamp).toBeDefined();
    const date = new Date(timestamp);
    expect(date.toISOString()).toBe(timestamp);
  });

  it('should capture the correct statusCode', () => {
    const req = createMockReq();
    const res = createMockRes();
    res.statusCode = 404;
    const next = vi.fn();

    requestLoggerMiddleware(req, res, next);
    res.emit('finish');

    const entry = getLastLogEntry();
    expect(entry.context!.statusCode).toBe(404);
  });

  it('should include correlationId from AsyncLocalStorage', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    asyncLocalStorage.run({ correlationId: 'test-req-logger-id' }, () => {
      requestLoggerMiddleware(req, res, next);
      res.emit('finish');

      const entry = getLastLogEntry();
      expect(entry.correlationId).toBe('test-req-logger-id');
    });
  });

  it('should use "no-correlation-id" when no AsyncLocalStorage context', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    requestLoggerMiddleware(req, res, next);
    res.emit('finish');

    const entry = getLastLogEntry();
    expect(entry.correlationId).toBe('no-correlation-id');
  });

  it('should not log until response finishes', () => {
    const req = createMockReq();
    const res = createMockRes();
    const next = vi.fn();

    requestLoggerMiddleware(req, res, next);

    expect(writtenOutput).toHaveLength(0);
  });

  it('should log different methods and paths correctly', () => {
    const req = createMockReq({ method: 'PATCH', path: '/api/schedules/123/cancel' });
    const res = createMockRes();
    res.statusCode = 200;
    const next = vi.fn();

    requestLoggerMiddleware(req, res, next);
    res.emit('finish');

    const entry = getLastLogEntry();
    expect(entry.context!.method).toBe('PATCH');
    expect(entry.context!.path).toBe('/api/schedules/123/cancel');
    expect(entry.context!.statusCode).toBe(200);
  });
});
