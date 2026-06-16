/**
 * Form Fill Task Executor
 *
 * Executes form fill tasks by validating input data against a template
 * and producing a filled output preserving the template structure.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

import { ITaskDocument } from '../models/task.model.js';

// --- Interfaces ---

export interface TemplateField {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  default?: unknown;
}

export interface FormFillPayload {
  template: Record<string, TemplateField>;
  data: Record<string, unknown>;
}

export interface TaskError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ExecutionResult {
  success: boolean;
  result?: Record<string, unknown>;
  error?: TaskError;
  startedAt: string;
  completedAt: string;
}

// --- Type Checking Utility ---

const VALID_TYPES: ReadonlySet<string> = new Set([
  'string',
  'number',
  'boolean',
  'array',
  'object',
]);

/**
 * Checks if a value matches the expected template field type.
 */
function matchesType(value: unknown, expectedType: string): boolean {
  if (!VALID_TYPES.has(expectedType)) {
    return false;
  }

  switch (expectedType) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number';
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return (
        typeof value === 'object' && value !== null && !Array.isArray(value)
      );
    default:
      return false;
  }
}

/**
 * Returns the runtime type name for a given value, distinguishing arrays from objects.
 */
function getActualType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// --- Executor ---

/**
 * Executes a form fill task.
 *
 * 1. Extracts template and data from task payload.
 * 2. Validates all required fields are present in data.
 * 3. Validates data value types match the template field definitions.
 * 4. Fills the template with data values, using null for optional missing fields.
 * 5. Returns the filled output preserving the template structure.
 */
export async function executeFormFill(
  task: ITaskDocument
): Promise<ExecutionResult> {
  const startedAt = new Date().toISOString();

  try {
    const payload = task.payload as unknown as FormFillPayload;
    const { template, data } = payload;

    // Step 1: Validate required fields are present in data
    const missingFields: string[] = [];
    for (const [fieldName, fieldDef] of Object.entries(template)) {
      if (fieldDef.required === true) {
        if (!(fieldName in data) || data[fieldName] === undefined) {
          missingFields.push(fieldName);
        }
      }
    }

    if (missingFields.length > 0) {
      return {
        success: false,
        error: {
          code: 'MISSING_REQUIRED_FIELD',
          message: `Required fields are missing: ${missingFields.join(', ')}`,
          details: { missingFields },
        },
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    // Step 2: Validate data types match template field definitions
    const typeMismatches: Array<{
      field: string;
      expected: string;
      actual: string;
    }> = [];

    for (const [fieldName, fieldDef] of Object.entries(template)) {
      if (fieldName in data && data[fieldName] !== undefined) {
        const value = data[fieldName];
        if (!matchesType(value, fieldDef.type)) {
          typeMismatches.push({
            field: fieldName,
            expected: fieldDef.type,
            actual: getActualType(value),
          });
        }
      }
    }

    if (typeMismatches.length > 0) {
      return {
        success: false,
        error: {
          code: 'DATA_TYPE_MISMATCH',
          message: `Data type mismatches found: ${typeMismatches.map((m) => `${m.field} (expected ${m.expected}, got ${m.actual})`).join(', ')}`,
          details: { mismatches: typeMismatches },
        },
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    // Step 3: Fill template with data, preserving template structure
    const filledOutput: Record<string, unknown> = {};

    for (const fieldName of Object.keys(template)) {
      if (fieldName in data && data[fieldName] !== undefined) {
        filledOutput[fieldName] = data[fieldName];
      } else {
        // Optional field not provided — set to null (Requirement 6.6)
        filledOutput[fieldName] = null;
      }
    }

    return {
      success: true,
      result: filledOutput,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message:
          error instanceof Error
            ? error.message
            : 'An unexpected error occurred during form fill execution',
      },
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}
