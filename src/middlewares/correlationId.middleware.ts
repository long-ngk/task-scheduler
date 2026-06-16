import { randomUUID } from 'node:crypto';
import { Request, Response, NextFunction } from 'express';
import { asyncLocalStorage } from '../utils/logger';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuidV4(value: string): boolean {
  return UUID_V4_REGEX.test(value);
}

export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const headerValue = req.headers['x-correlation-id'];
  const rawId = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  const correlationId =
    rawId && isValidUuidV4(rawId) ? rawId : randomUUID();

  res.setHeader('X-Correlation-ID', correlationId);

  asyncLocalStorage.run({ correlationId }, () => {
    next();
  });
}
