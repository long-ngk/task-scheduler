import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import {
  correlationIdMiddleware,
  isValidUuidV4,
} from '../../src/middlewares/correlationId.middleware';
import { asyncLocalStorage } from '../../src/utils/logger';

function createMockReq(headers: Record<string, string | undefined> = {}): Request {
  return {
    headers: { ...headers },
  } as unknown as Request;
}

function createMockRes(): Response {
  const res = {
    setHeader: vi.fn(),
  } as unknown as Response;
  return res;
}

describe('correlationIdMiddleware', () => {
  let mockNext: NextFunction;

  beforeEach(() => {
    mockNext = vi.fn();
  });

  describe('isValidUuidV4', () => {
    it('should return true for a valid UUID v4', () => {
      expect(isValidUuidV4('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('should return true for a valid UUID v4 with lowercase hex', () => {
      expect(isValidUuidV4('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d')).toBe(true);
    });

    it('should return true for a valid UUID v4 with uppercase hex', () => {
      expect(isValidUuidV4('A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D')).toBe(true);
    });

    it('should return false for a non-v4 UUID (wrong version digit)', () => {
      expect(isValidUuidV4('550e8400-e29b-31d4-a716-446655440000')).toBe(false);
    });

    it('should return false for an invalid variant digit', () => {
      expect(isValidUuidV4('550e8400-e29b-41d4-f716-446655440000')).toBe(false);
    });

    it('should return false for a string that is too short', () => {
      expect(isValidUuidV4('550e8400-e29b-41d4-a716')).toBe(false);
    });

    it('should return false for an empty string', () => {
      expect(isValidUuidV4('')).toBe(false);
    });

    it('should return false for a random string', () => {
      expect(isValidUuidV4('not-a-uuid-at-all')).toBe(false);
    });

    it('should return false for a UUID with extra characters', () => {
      expect(isValidUuidV4('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false);
    });
  });

  describe('middleware behavior', () => {
    it('should use the provided valid X-Correlation-ID header', () => {
      const validId = '550e8400-e29b-41d4-a716-446655440000';
      const req = createMockReq({ 'x-correlation-id': validId });
      const res = createMockRes();

      correlationIdMiddleware(req, res, mockNext);

      expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', validId);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should generate a new UUID when X-Correlation-ID header is missing', () => {
      const req = createMockReq({});
      const res = createMockRes();

      correlationIdMiddleware(req, res, mockNext);

      expect(res.setHeader).toHaveBeenCalledWith(
        'X-Correlation-ID',
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        ),
      );
      expect(mockNext).toHaveBeenCalled();
    });

    it('should generate a new UUID when X-Correlation-ID header is invalid', () => {
      const req = createMockReq({ 'x-correlation-id': 'invalid-uuid' });
      const res = createMockRes();

      correlationIdMiddleware(req, res, mockNext);

      const setHeaderCall = (res.setHeader as ReturnType<typeof vi.fn>).mock.calls[0];
      const generatedId = setHeaderCall[1] as string;

      expect(generatedId).not.toBe('invalid-uuid');
      expect(isValidUuidV4(generatedId)).toBe(true);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should generate a new UUID when X-Correlation-ID is a non-v4 UUID', () => {
      const nonV4Uuid = '550e8400-e29b-31d4-a716-446655440000'; // version 3
      const req = createMockReq({ 'x-correlation-id': nonV4Uuid });
      const res = createMockRes();

      correlationIdMiddleware(req, res, mockNext);

      const setHeaderCall = (res.setHeader as ReturnType<typeof vi.fn>).mock.calls[0];
      const generatedId = setHeaderCall[1] as string;

      expect(generatedId).not.toBe(nonV4Uuid);
      expect(isValidUuidV4(generatedId)).toBe(true);
    });

    it('should always set the response header', () => {
      const req = createMockReq({});
      const res = createMockRes();

      correlationIdMiddleware(req, res, mockNext);

      expect(res.setHeader).toHaveBeenCalledTimes(1);
      expect(res.setHeader).toHaveBeenCalledWith('X-Correlation-ID', expect.any(String));
    });

    it('should store correlationId in AsyncLocalStorage', () => {
      const validId = '550e8400-e29b-41d4-a716-446655440000';
      const req = createMockReq({ 'x-correlation-id': validId });
      const res = createMockRes();

      let capturedCorrelationId: string | undefined;
      const next = vi.fn(() => {
        const store = asyncLocalStorage.getStore();
        capturedCorrelationId = store?.correlationId;
      });

      correlationIdMiddleware(req, res, next);

      expect(capturedCorrelationId).toBe(validId);
    });

    it('should store generated correlationId in AsyncLocalStorage when header is missing', () => {
      const req = createMockReq({});
      const res = createMockRes();

      let capturedCorrelationId: string | undefined;
      const next = vi.fn(() => {
        const store = asyncLocalStorage.getStore();
        capturedCorrelationId = store?.correlationId;
      });

      correlationIdMiddleware(req, res, next);

      expect(capturedCorrelationId).toBeDefined();
      expect(isValidUuidV4(capturedCorrelationId!)).toBe(true);
    });

    it('should use the same correlationId for response header and AsyncLocalStorage', () => {
      const req = createMockReq({});
      const res = createMockRes();

      let capturedCorrelationId: string | undefined;
      const next = vi.fn(() => {
        const store = asyncLocalStorage.getStore();
        capturedCorrelationId = store?.correlationId;
      });

      correlationIdMiddleware(req, res, next);

      const setHeaderCall = (res.setHeader as ReturnType<typeof vi.fn>).mock.calls[0];
      const responseHeaderId = setHeaderCall[1] as string;

      expect(capturedCorrelationId).toBe(responseHeaderId);
    });

    it('should call next() exactly once', () => {
      const req = createMockReq({});
      const res = createMockRes();

      correlationIdMiddleware(req, res, mockNext);

      expect(mockNext).toHaveBeenCalledTimes(1);
    });
  });
});
