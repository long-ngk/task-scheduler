import { z } from 'zod';
import { TASK_TYPES, TaskTypeValue } from '../models/task.model.js';

// --- Interfaces ---

export interface ValidationResult {
  valid: boolean;
  errors?: ValidationError[];
}

export interface ValidationError {
  field: string;
  reason: string;
  expected?: string;
}

// --- Constants ---

const MAX_PAYLOAD_SIZE_BYTES = 1_048_576; // 1MB
const MAX_FILE_PATH_LENGTH = 1024;
const MAX_FILE_PATHS_COUNT = 100;
const MAX_SUBJECT_LENGTH = 255;
const MAX_BODY_LENGTH = 65_536; // 64KB
const MAX_RECIPIENTS_COUNT = 50;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const MIN_TIMEOUT = 1;
const MAX_TIMEOUT = 3600;
const MIN_RETRIES = 0;
const MAX_RETRIES = 10;

// RFC 5322 simplified email regex
const RFC5322_EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

// --- Zod Schemas ---

const fileReadPayloadSchema = z.object({
  filePath: z
    .string()
    .min(1, 'filePath must not be empty')
    .max(MAX_FILE_PATH_LENGTH, `filePath must not exceed ${MAX_FILE_PATH_LENGTH} characters`)
    .refine((val) => !val.includes('..'), {
      message: 'filePath must not contain path traversal sequences (..)',
    }),
});

const fileImportPayloadSchema = z.object({
  filePaths: z
    .array(
      z
        .string()
        .min(1, 'each filePath must not be empty')
        .max(MAX_FILE_PATH_LENGTH, `each filePath must not exceed ${MAX_FILE_PATH_LENGTH} characters`),
    )
    .min(1, 'filePaths must not be empty')
    .max(MAX_FILE_PATHS_COUNT, `filePaths must not exceed ${MAX_FILE_PATHS_COUNT} items`),
});

const templateFieldSchema = z.object({
  type: z.enum(['string', 'number', 'boolean', 'array', 'object']),
  required: z.boolean().optional(),
  default: z.unknown().optional(),
});

const formFillPayloadSchema = z.object({
  template: z
    .record(z.string(), templateFieldSchema)
    .refine((val) => Object.keys(val).length > 0, {
      message: 'template must not be empty',
    }),
  data: z.record(z.string(), z.unknown()),
});

const emailPayloadSchema = z.object({
  subject: z
    .string()
    .min(1, 'subject must not be empty')
    .max(MAX_SUBJECT_LENGTH, `subject must not exceed ${MAX_SUBJECT_LENGTH} characters`),
  body: z
    .string()
    .min(1, 'body must not be empty')
    .max(MAX_BODY_LENGTH, `body must not exceed ${MAX_BODY_LENGTH} characters`),
  recipients: z
    .array(
      z.string().refine((val) => RFC5322_EMAIL_REGEX.test(val), {
        message: 'each recipient must be a valid RFC 5322 email address',
      }),
    )
    .min(1, 'recipients must not be empty')
    .max(MAX_RECIPIENTS_COUNT, `recipients must not exceed ${MAX_RECIPIENTS_COUNT} items`),
});

// --- Helper Functions ---

function zodErrorsToValidationErrors(error: z.ZodError, prefix?: string): ValidationError[] {
  return error.issues.map((issue) => {
    const pathParts = issue.path.map(String);
    const field = prefix ? [prefix, ...pathParts].join('.') : pathParts.join('.') || 'unknown';
    return {
      field,
      reason: issue.message,
      expected: getExpectedFromIssue(issue),
    };
  });
}

function getExpectedFromIssue(issue: z.ZodIssue): string | undefined {
  switch (issue.code) {
    case 'invalid_type':
      return `type ${issue.expected}`;
    case 'too_small':
      if (issue.origin === 'string') return `non-empty string`;
      if (issue.origin === 'array') return `non-empty array`;
      if (issue.origin === 'number') return `minimum ${issue.minimum}`;
      return undefined;
    case 'too_big':
      if (issue.origin === 'string') return `max ${issue.maximum} characters`;
      if (issue.origin === 'array') return `max ${issue.maximum} items`;
      if (issue.origin === 'number') return `maximum ${issue.maximum}`;
      return undefined;
    case 'invalid_value':
      return `one of: ${issue.values.join(', ')}`;
    default:
      return undefined;
  }
}

/**
 * Validates a cron expression (5 or 6 fields).
 * Fields: minute hour day-of-month month day-of-week [seconds]
 */
export function validateCronExpression(expr: string): boolean {
  if (typeof expr !== 'string') return false;
  const fields = expr.trim().split(/\s+/);
  if (fields.length < 5 || fields.length > 6) return false;

  const ranges = [
    { min: 0, max: 59 }, // minute (or seconds if 6 fields)
    { min: 0, max: 23 }, // hour (or minute if 6 fields)
    { min: 1, max: 31 }, // day of month (or hour if 6 fields)
    { min: 1, max: 12 }, // month (or day of month if 6 fields)
    { min: 0, max: 7 },  // day of week (or month if 6 fields)
  ];

  // For 6 fields: second minute hour day-of-month month day-of-week
  const fieldRanges =
    fields.length === 6
      ? [
          { min: 0, max: 59 }, // second
          { min: 0, max: 59 }, // minute
          { min: 0, max: 23 }, // hour
          { min: 1, max: 31 }, // day of month
          { min: 1, max: 12 }, // month
          { min: 0, max: 7 },  // day of week
        ]
      : ranges;

  for (let i = 0; i < fields.length; i++) {
    if (!isValidCronField(fields[i], fieldRanges[i].min, fieldRanges[i].max)) {
      return false;
    }
  }

  return true;
}

function isValidCronField(field: string, min: number, max: number): boolean {
  // Handle wildcard
  if (field === '*') return true;

  // Handle lists (e.g., "1,2,3")
  const parts = field.split(',');
  for (const part of parts) {
    if (!isValidCronPart(part, min, max)) return false;
  }
  return true;
}

function isValidCronPart(part: string, min: number, max: number): boolean {
  // Handle step values (e.g., "*/5", "1-10/2")
  const stepParts = part.split('/');
  if (stepParts.length > 2) return false;

  if (stepParts.length === 2) {
    const step = parseInt(stepParts[1], 10);
    if (isNaN(step) || step < 1) return false;
    return isValidCronRange(stepParts[0], min, max);
  }

  return isValidCronRange(part, min, max);
}

function isValidCronRange(part: string, min: number, max: number): boolean {
  if (part === '*') return true;

  // Handle ranges (e.g., "1-5")
  const rangeParts = part.split('-');
  if (rangeParts.length > 2) return false;

  if (rangeParts.length === 2) {
    const start = parseInt(rangeParts[0], 10);
    const end = parseInt(rangeParts[1], 10);
    if (isNaN(start) || isNaN(end)) return false;
    return start >= min && end <= max && start <= end;
  }

  // Single value
  const val = parseInt(part, 10);
  if (isNaN(val)) return false;
  return val >= min && val <= max;
}

// --- Payload Validation by Type ---

function validatePayloadForType(
  type: TaskTypeValue,
  payload: unknown,
): ValidationResult {
  switch (type) {
    case 'file_read':
      return validateFileReadPayload(payload);
    case 'file_import':
      return validateFileImportPayload(payload);
    case 'form_fill':
      return validateFormFillPayload(payload);
    case 'email':
      return validateEmailPayload(payload);
    default:
      return { valid: false, errors: [{ field: 'type', reason: 'Unsupported task type', expected: `one of: ${TASK_TYPES.join(', ')}` }] };
  }
}

// --- Public Validation Functions ---

export function validateFileReadPayload(payload: unknown): ValidationResult {
  const result = fileReadPayloadSchema.safeParse(payload);
  if (result.success) return { valid: true };
  return { valid: false, errors: zodErrorsToValidationErrors(result.error, 'payload') };
}

export function validateFileImportPayload(payload: unknown): ValidationResult {
  const result = fileImportPayloadSchema.safeParse(payload);
  if (result.success) return { valid: true };
  return { valid: false, errors: zodErrorsToValidationErrors(result.error, 'payload') };
}

export function validateFormFillPayload(payload: unknown): ValidationResult {
  const result = formFillPayloadSchema.safeParse(payload);
  if (result.success) return { valid: true };
  return { valid: false, errors: zodErrorsToValidationErrors(result.error, 'payload') };
}

export function validateEmailPayload(payload: unknown): ValidationResult {
  const result = emailPayloadSchema.safeParse(payload);
  if (result.success) return { valid: true };
  return { valid: false, errors: zodErrorsToValidationErrors(result.error, 'payload') };
}

export function validatePaginationParams(page: number, pageSize: number): ValidationResult {
  const errors: ValidationError[] = [];

  if (!Number.isInteger(page) || page < 1) {
    errors.push({ field: 'page', reason: 'page must be a positive integer', expected: 'integer >= 1' });
  }

  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    errors.push({ field: 'pageSize', reason: 'pageSize must be an integer between 1 and 100', expected: 'integer 1-100' });
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validateCreateTask(payload: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof payload !== 'object' || payload === null) {
    return { valid: false, errors: [{ field: 'body', reason: 'Request body must be a non-null object' }] };
  }

  // Check payload size (approximate via JSON serialization)
  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length > MAX_PAYLOAD_SIZE_BYTES) {
    return {
      valid: false,
      errors: [{ field: 'body', reason: 'Payload exceeds maximum size of 1MB', expected: 'payload <= 1MB' }],
    };
  }

  const body = payload as Record<string, unknown>;

  // Validate type
  if (!body.type) {
    errors.push({ field: 'type', reason: 'type is required', expected: `one of: ${TASK_TYPES.join(', ')}` });
  } else if (!TASK_TYPES.includes(body.type as TaskTypeValue)) {
    errors.push({ field: 'type', reason: 'Unsupported task type', expected: `one of: ${TASK_TYPES.join(', ')}` });
  }

  // Validate exactly one of scheduleAt/cronExpr
  const hasScheduleAt = body.scheduleAt !== undefined && body.scheduleAt !== null;
  const hasCronExpr = body.cronExpr !== undefined && body.cronExpr !== null;

  if (!hasScheduleAt && !hasCronExpr) {
    errors.push({
      field: 'scheduleAt/cronExpr',
      reason: 'Exactly one of scheduleAt or cronExpr is required',
      expected: 'one of scheduleAt or cronExpr',
    });
  } else if (hasScheduleAt && hasCronExpr) {
    errors.push({
      field: 'scheduleAt/cronExpr',
      reason: 'Cannot provide both scheduleAt and cronExpr',
      expected: 'exactly one of scheduleAt or cronExpr',
    });
  } else if (hasScheduleAt) {
    // Validate scheduleAt is a valid ISO 8601 date in the future
    const date = new Date(body.scheduleAt as string);
    if (isNaN(date.getTime())) {
      errors.push({ field: 'scheduleAt', reason: 'scheduleAt must be a valid ISO 8601 date string' });
    } else if (date.getTime() <= Date.now()) {
      errors.push({ field: 'scheduleAt', reason: 'scheduleAt must be in the future', expected: 'ISO 8601 date in the future' });
    }
  } else if (hasCronExpr) {
    // Validate cron expression
    if (typeof body.cronExpr !== 'string' || !validateCronExpression(body.cronExpr)) {
      errors.push({
        field: 'cronExpr',
        reason: 'Invalid cron expression format',
        expected: '5 or 6 field cron expression',
      });
    }
  }

  // Validate timeout if provided
  if (body.timeout !== undefined) {
    if (typeof body.timeout !== 'number' || body.timeout < MIN_TIMEOUT || body.timeout > MAX_TIMEOUT) {
      errors.push({
        field: 'timeout',
        reason: `timeout must be a number between ${MIN_TIMEOUT} and ${MAX_TIMEOUT}`,
        expected: `number in range [${MIN_TIMEOUT}, ${MAX_TIMEOUT}]`,
      });
    }
  }

  // Validate maxRetries if provided
  if (body.maxRetries !== undefined) {
    if (typeof body.maxRetries !== 'number' || body.maxRetries < MIN_RETRIES || body.maxRetries > MAX_RETRIES) {
      errors.push({
        field: 'maxRetries',
        reason: `maxRetries must be a number between ${MIN_RETRIES} and ${MAX_RETRIES}`,
        expected: `number in range [${MIN_RETRIES}, ${MAX_RETRIES}]`,
      });
    }
  }

  // If type is valid, validate payload
  if (body.type && TASK_TYPES.includes(body.type as TaskTypeValue)) {
    if (body.payload === undefined || body.payload === null) {
      errors.push({ field: 'payload', reason: 'payload is required' });
    } else {
      const payloadResult = validatePayloadForType(body.type as TaskTypeValue, body.payload);
      if (!payloadResult.valid && payloadResult.errors) {
        errors.push(...payloadResult.errors);
      }
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

export function validatePushTask(payload: unknown): ValidationResult {
  const errors: ValidationError[] = [];

  if (typeof payload !== 'object' || payload === null) {
    return { valid: false, errors: [{ field: 'body', reason: 'Request body must be a non-null object' }] };
  }

  // Check payload size
  const payloadStr = JSON.stringify(payload);
  if (payloadStr.length > MAX_PAYLOAD_SIZE_BYTES) {
    return {
      valid: false,
      errors: [{ field: 'body', reason: 'Payload exceeds maximum size of 1MB', expected: 'payload <= 1MB' }],
    };
  }

  const body = payload as Record<string, unknown>;

  // Validate type
  if (!body.type) {
    errors.push({ field: 'type', reason: 'type is required', expected: `one of: ${TASK_TYPES.join(', ')}` });
  } else if (!TASK_TYPES.includes(body.type as TaskTypeValue)) {
    errors.push({ field: 'type', reason: 'Unsupported task type', expected: `one of: ${TASK_TYPES.join(', ')}` });
  }

  // Validate idempotencyKey (required for push)
  if (!body.idempotencyKey) {
    errors.push({
      field: 'idempotencyKey',
      reason: 'idempotencyKey is required for push tasks',
      expected: 'string of 1-256 characters',
    });
  } else if (typeof body.idempotencyKey !== 'string') {
    errors.push({
      field: 'idempotencyKey',
      reason: 'idempotencyKey must be a string',
      expected: 'string of 1-256 characters',
    });
  } else if (body.idempotencyKey.length < 1 || body.idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    errors.push({
      field: 'idempotencyKey',
      reason: `idempotencyKey must be between 1 and ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
      expected: `string of 1-${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
    });
  }

  // Validate timeout if provided
  if (body.timeout !== undefined) {
    if (typeof body.timeout !== 'number' || body.timeout < MIN_TIMEOUT || body.timeout > MAX_TIMEOUT) {
      errors.push({
        field: 'timeout',
        reason: `timeout must be a number between ${MIN_TIMEOUT} and ${MAX_TIMEOUT}`,
        expected: `number in range [${MIN_TIMEOUT}, ${MAX_TIMEOUT}]`,
      });
    }
  }

  // Validate maxRetries if provided
  if (body.maxRetries !== undefined) {
    if (typeof body.maxRetries !== 'number' || body.maxRetries < MIN_RETRIES || body.maxRetries > MAX_RETRIES) {
      errors.push({
        field: 'maxRetries',
        reason: `maxRetries must be a number between ${MIN_RETRIES} and ${MAX_RETRIES}`,
        expected: `number in range [${MIN_RETRIES}, ${MAX_RETRIES}]`,
      });
    }
  }

  // If type is valid, validate payload
  if (body.type && TASK_TYPES.includes(body.type as TaskTypeValue)) {
    if (body.payload === undefined || body.payload === null) {
      errors.push({ field: 'payload', reason: 'payload is required' });
    } else {
      const payloadResult = validatePayloadForType(body.type as TaskTypeValue, body.payload);
      if (!payloadResult.valid && payloadResult.errors) {
        errors.push(...payloadResult.errors);
      }
    }
  }

  return errors.length > 0 ? { valid: false, errors } : { valid: true };
}

// --- Default Export (ValidationService object) ---

export const validationService = {
  validateCreateTask,
  validatePushTask,
  validateFileReadPayload,
  validateFileImportPayload,
  validateFormFillPayload,
  validateEmailPayload,
  validateCronExpression,
  validatePaginationParams,
};
