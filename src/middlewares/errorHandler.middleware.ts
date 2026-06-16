/**
 * Error handler middleware for the Schedule Task Application.
 *
 * Catches all errors and formats them into the standard ErrorResponse structure.
 * - Sanitizes 500 errors (no stack traces, file paths, or variable/function names)
 * - Includes correlationId from request context
 * - Handles payload too large (413) for body > 1MB
 * - Handles unsupported HTTP methods (405)
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */

import type { Request, Response, NextFunction } from 'express';
import {
  AppError,
  PayloadTooLargeError,
  formatErrorResponse,
} from '../utils/errors.js';
import { asyncLocalStorage, logger } from '../utils/logger.js';

/**
 * Express error-handling middleware.
 * Must have 4 parameters so Express recognizes it as an error handler.
 */
export function errorHandler(
  err: Error & { type?: string; status?: number },
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Resolve correlationId: asyncLocalStorage > response header > fallback
  const store = asyncLocalStorage.getStore();
  const correlationId =
    store?.correlationId ??
    (res.getHeader('X-Correlation-ID') as string | undefined) ??
    'unknown';

  // Convert Express body-parser "entity.too.large" errors to PayloadTooLargeError
  let error: Error | AppError = err;
  if (err.type === 'entity.too.large') {
    error = new PayloadTooLargeError('Request body exceeds the 1MB size limit');
  }

  // Format the error response
  const { statusCode, body } = formatErrorResponse(error, correlationId);

  // Log the error
  logger.error('Request error', {
    statusCode,
    errorCode: body.errorCode,
    message: err.message,
    correlationId,
  });

  // Send the response
  res.status(statusCode).json(body);
}

/**
 * Middleware to handle unsupported HTTP methods (405 Method Not Allowed).
 * Should be mounted after all route definitions for a given path.
 *
 * Requirement 13.6
 */
export function methodNotAllowed(
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const store = asyncLocalStorage.getStore();
  const correlationId =
    store?.correlationId ??
    (res.getHeader('X-Correlation-ID') as string | undefined) ??
    'unknown';

  const error = new AppError(
    `Method ${req.method} is not allowed on ${req.path}`,
    405,
    'METHOD_NOT_ALLOWED'
  );

  const { statusCode, body } = formatErrorResponse(error, correlationId);

  logger.warn('Method not allowed', {
    method: req.method,
    path: req.path,
    correlationId,
  });

  res.status(statusCode).json(body);
}
