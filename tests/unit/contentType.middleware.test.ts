import { describe, it, expect, vi } from 'vitest';
import { contentTypeMiddleware } from '../../src/middlewares/contentType.middleware';
import { AppError } from '../../src/utils/errors';
import type { Request, Response, NextFunction } from 'express';

function createMockReq(method: string, contentType?: string): Partial<Request> {
  const headers: Record<string, string> = {};
  if (contentType !== undefined) {
    headers['content-type'] = contentType;
  }
  return { method, headers };
}

function createMockRes(): Partial<Response> {
  return {};
}

describe('contentTypeMiddleware', () => {
  describe('POST requests', () => {
    it('should call next() without error when Content-Type is application/json', () => {
      const req = createMockReq('POST', 'application/json');
      const res = createMockRes();
      const next = vi.fn();

      contentTypeMiddleware(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });

    it('should call next() without error when Content-Type includes charset', () => {
      const req = createMockReq('POST', 'application/json; charset=utf-8');
      const res = createMockRes();
      const next = vi.fn();

      contentTypeMiddleware(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });

    it('should pass AppError with 415 when Content-Type is text/plain', () => {
      const req = createMockReq('POST', 'text/plain');
      const res = createMockRes();
      const next = vi.fn();

      contentTypeMiddleware(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0][0];
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(415);
      expect(error.errorCode).toBe('UNSUPPORTED_MEDIA_TYPE');
      expect(error.message).toBe('Content-Type must be application/json');
    });

    it('should pass AppError with 415 when Content-Type is missing', () => {
      const req = createMockReq('POST');
      const res = createMockRes();
      const next = vi.fn();

      contentTypeMiddleware(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0][0];
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(415);
      expect(error.errorCode).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('should pass AppError with 415 when Content-Type is multipart/form-data', () => {
      const req = createMockReq('POST', 'multipart/form-data');
      const res = createMockRes();
      const next = vi.fn();

      contentTypeMiddleware(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0][0];
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(415);
    });
  });

  describe('PATCH requests', () => {
    it('should call next() without error when Content-Type is application/json', () => {
      const req = createMockReq('PATCH', 'application/json');
      const res = createMockRes();
      const next = vi.fn();

      contentTypeMiddleware(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });

    it('should pass AppError with 415 when Content-Type is not JSON', () => {
      const req = createMockReq('PATCH', 'application/xml');
      const res = createMockRes();
      const next = vi.fn();

      contentTypeMiddleware(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
      const error = next.mock.calls[0][0];
      expect(error).toBeInstanceOf(AppError);
      expect(error.statusCode).toBe(415);
      expect(error.errorCode).toBe('UNSUPPORTED_MEDIA_TYPE');
    });
  });

  describe('GET requests', () => {
    it('should call next() without error regardless of Content-Type', () => {
      const req = createMockReq('GET', 'text/html');
      const res = createMockRes();
      const next = vi.fn();

      contentTypeMiddleware(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });

    it('should call next() without error when Content-Type is missing', () => {
      const req = createMockReq('GET');
      const res = createMockRes();
      const next = vi.fn();

      contentTypeMiddleware(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('DELETE requests', () => {
    it('should call next() without error regardless of Content-Type', () => {
      const req = createMockReq('DELETE', 'text/plain');
      const res = createMockRes();
      const next = vi.fn();

      contentTypeMiddleware(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('PUT requests', () => {
    it('should call next() without error (PUT not in checked methods)', () => {
      const req = createMockReq('PUT', 'text/plain');
      const res = createMockRes();
      const next = vi.fn();

      contentTypeMiddleware(req as Request, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith();
    });
  });
});
