/**
 * Content-Type validation middleware.
 *
 * Rejects POST and PATCH requests that do not have an application/json Content-Type
 * with a 415 Unsupported Media Type error.
 *
 * Requirements: 13.6
 */

import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors.js';

const METHODS_WITH_BODY = new Set(['POST', 'PATCH']);

/**
 * Middleware that validates Content-Type header on requests with a body.
 * Only POST and PATCH requests are checked. If the Content-Type does not
 * start with "application/json", an AppError with status 415 is passed to next().
 */
export function contentTypeMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  if (!METHODS_WITH_BODY.has(req.method.toUpperCase())) {
    next();
    return;
  }

  const contentType = req.headers['content-type'] || '';

  if (!contentType.startsWith('application/json')) {
    const error = new AppError(
      'Content-Type must be application/json',
      415,
      'UNSUPPORTED_MEDIA_TYPE'
    );
    next(error);
    return;
  }

  next();
}
