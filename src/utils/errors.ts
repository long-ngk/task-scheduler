/**
 * Error classes and error response utilities for the Schedule Task Application.
 *
 * Provides:
 * - AppError base class with statusCode, errorCode, details
 * - Specific error subclasses: ValidationError, NotFoundError, ConflictError,
 *   PayloadTooLargeError, ServiceUnavailableError
 * - ErrorResponse formatter with UPPER_SNAKE_CASE errorCode (max 50 chars),
 *   message (max 500 chars), details (object/array), and correlationId
 *
 * Requirements: 13.1, 13.2, 13.4, 13.5
 */

// --- Error Response Interface ---

export interface ErrorResponse {
  errorCode: string; // UPPER_SNAKE_CASE, max 50 chars
  message: string; // max 500 chars
  details: unknown; // object or array
  correlationId: string;
}

// --- Base Error Class ---

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;
  public readonly details: unknown;

  constructor(
    message: string,
    statusCode: number,
    errorCode: string,
    details: unknown = {}
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// --- Specific Error Classes ---

export class ValidationError extends AppError {
  constructor(
    message: string,
    details: unknown = {},
    errorCode: string = 'VALIDATION_ERROR'
  ) {
    super(message, 400, errorCode, details);
  }
}

export class NotFoundError extends AppError {
  constructor(
    message: string,
    details: unknown = {},
    errorCode: string = 'TASK_NOT_FOUND'
  ) {
    super(message, 404, errorCode, details);
  }
}

export class ConflictError extends AppError {
  constructor(
    message: string,
    details: unknown = {},
    errorCode: string = 'INVALID_TASK_STATUS'
  ) {
    super(message, 409, errorCode, details);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(
    message: string,
    details: unknown = {},
    errorCode: string = 'PAYLOAD_TOO_LARGE'
  ) {
    super(message, 413, errorCode, details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(
    message: string,
    details: unknown = {},
    errorCode: string = 'SERVICE_UNAVAILABLE'
  ) {
    super(message, 503, errorCode, details);
  }
}

// --- Error Response Formatter ---

const MAX_ERROR_CODE_LENGTH = 50;
const MAX_MESSAGE_LENGTH = 500;
const UPPER_SNAKE_CASE_REGEX = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

/**
 * Sanitizes an error code to ensure it is UPPER_SNAKE_CASE and within max length.
 * If the code is invalid, falls back to 'INTERNAL_ERROR'.
 */
function sanitizeErrorCode(code: string): string {
  const trimmed = code.trim().slice(0, MAX_ERROR_CODE_LENGTH);

  if (UPPER_SNAKE_CASE_REGEX.test(trimmed)) {
    return trimmed;
  }

  // Attempt to convert to UPPER_SNAKE_CASE
  const converted = trimmed
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toUpperCase()
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, MAX_ERROR_CODE_LENGTH);

  if (converted.length > 0 && UPPER_SNAKE_CASE_REGEX.test(converted)) {
    return converted;
  }

  return 'INTERNAL_ERROR';
}

/**
 * Truncates a message to the maximum allowed length.
 */
function sanitizeMessage(message: string): string {
  if (message.length <= MAX_MESSAGE_LENGTH) {
    return message;
  }
  return message.slice(0, MAX_MESSAGE_LENGTH - 3) + '...';
}

/**
 * Ensures details is an object or array. Falls back to empty object.
 */
function sanitizeDetails(details: unknown): unknown {
  if (details === null || details === undefined) {
    return {};
  }
  if (Array.isArray(details)) {
    return details;
  }
  if (typeof details === 'object') {
    return details;
  }
  return {};
}

/**
 * Sanitizes an error message for 500 responses to ensure no internal information
 * (stack traces, file paths, variable/function names) is exposed.
 *
 * Requirement 13.2: 500 errors must NOT expose stack traces, file paths, or variable/function names.
 */
function sanitizeInternalMessage(message: string): string {
  // Check for patterns that indicate internal information leakage
  const internalPatterns = [
    /\bat\s+\w+\s*\(/i, // stack trace pattern: "at functionName("
    /[A-Za-z]:\\[^\s]+/i, // Windows file paths
    /\/[a-z_][a-z0-9_]*(?:\/[a-z_][a-z0-9_]*)+/i, // Unix file paths
    /\.(ts|js|mjs|cjs)(\s|:|$)/i, // File extensions in context
    /node_modules/i, // node_modules reference
    /Error:\s/i, // Raw error message prefix
    /\bstack\b.*\bat\b/i, // stack trace indicator
  ];

  for (const pattern of internalPatterns) {
    if (pattern.test(message)) {
      return 'An internal error occurred';
    }
  }

  return message;
}

/**
 * Formats an error into a standardized ErrorResponse.
 *
 * For AppError instances, uses the error's properties directly.
 * For generic errors (non-AppError), produces INTERNAL_ERROR with sanitized message.
 *
 * @param error - The error to format
 * @param correlationId - The correlation ID for the request
 * @returns Standardized ErrorResponse object
 */
export function formatErrorResponse(
  error: Error | AppError,
  correlationId: string
): { statusCode: number; body: ErrorResponse } {
  if (error instanceof AppError) {
    const isInternalError = error.statusCode >= 500;
    const message = isInternalError
      ? sanitizeInternalMessage(error.message)
      : error.message;

    return {
      statusCode: error.statusCode,
      body: {
        errorCode: sanitizeErrorCode(error.errorCode),
        message: sanitizeMessage(message),
        details: isInternalError ? {} : sanitizeDetails(error.details),
        correlationId,
      },
    };
  }

  // For non-AppError exceptions: produce INTERNAL_ERROR with sanitized message
  // Requirement 13.2: No stack traces, file paths, or variable/function names
  return {
    statusCode: 500,
    body: {
      errorCode: 'INTERNAL_ERROR',
      message: 'An internal error occurred',
      details: {},
      correlationId,
    },
  };
}
