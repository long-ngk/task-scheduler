import { describe, it, expect } from 'vitest';
import { executeFormFill, FormFillPayload } from '../../src/executors/formFill.executor.js';
import { ITaskDocument } from '../../src/models/task.model.js';

/**
 * Unit tests for the FormFill executor.
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */

function createMockTask(payload: FormFillPayload): ITaskDocument {
  return {
    _id: 'test-task-id',
    type: 'form_fill',
    status: 'running',
    payload: payload as unknown as Record<string, unknown>,
    timeout: 30,
    maxRetries: 3,
    retryCount: 0,
    executionHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ITaskDocument;
}

describe('FormFill Executor', () => {
  describe('Successful execution', () => {
    it('should fill template with data preserving template structure (Req 6.1, 6.2)', async () => {
      const task = createMockTask({
        template: {
          name: { type: 'string', required: true },
          age: { type: 'number', required: true },
          active: { type: 'boolean' },
        },
        data: {
          name: 'John Doe',
          age: 30,
          active: true,
        },
      });

      const result = await executeFormFill(task);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        name: 'John Doe',
        age: 30,
        active: true,
      });
      expect(result.startedAt).toBeDefined();
      expect(result.completedAt).toBeDefined();
    });

    it('should output keys matching exactly the template keys', async () => {
      const task = createMockTask({
        template: {
          firstName: { type: 'string', required: true },
          lastName: { type: 'string', required: true },
          email: { type: 'string' },
        },
        data: {
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@example.com',
          extraField: 'should be ignored',
        },
      });

      const result = await executeFormFill(task);

      expect(result.success).toBe(true);
      expect(Object.keys(result.result!)).toEqual(['firstName', 'lastName', 'email']);
      expect(result.result).toEqual({
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane@example.com',
      });
    });

    it('should handle array type values', async () => {
      const task = createMockTask({
        template: {
          tags: { type: 'array', required: true },
        },
        data: {
          tags: ['tag1', 'tag2', 'tag3'],
        },
      });

      const result = await executeFormFill(task);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({ tags: ['tag1', 'tag2', 'tag3'] });
    });

    it('should handle object type values', async () => {
      const task = createMockTask({
        template: {
          address: { type: 'object', required: true },
        },
        data: {
          address: { street: '123 Main St', city: 'Springfield' },
        },
      });

      const result = await executeFormFill(task);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        address: { street: '123 Main St', city: 'Springfield' },
      });
    });
  });

  describe('Optional fields - null default (Req 6.6)', () => {
    it('should set null for optional fields not provided in data', async () => {
      const task = createMockTask({
        template: {
          name: { type: 'string', required: true },
          nickname: { type: 'string', required: false },
          bio: { type: 'string' },
        },
        data: {
          name: 'Alice',
        },
      });

      const result = await executeFormFill(task);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        name: 'Alice',
        nickname: null,
        bio: null,
      });
    });

    it('should set null for fields with required undefined (defaults to not required)', async () => {
      const task = createMockTask({
        template: {
          title: { type: 'string', required: true },
          subtitle: { type: 'string' },
        },
        data: {
          title: 'Hello World',
        },
      });

      const result = await executeFormFill(task);

      expect(result.success).toBe(true);
      expect(result.result).toEqual({
        title: 'Hello World',
        subtitle: null,
      });
    });
  });

  describe('MISSING_REQUIRED_FIELD error (Req 6.3)', () => {
    it('should fail with MISSING_REQUIRED_FIELD when required fields are missing', async () => {
      const task = createMockTask({
        template: {
          name: { type: 'string', required: true },
          email: { type: 'string', required: true },
          age: { type: 'number' },
        },
        data: {
          age: 25,
        },
      });

      const result = await executeFormFill(task);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('MISSING_REQUIRED_FIELD');
      expect(result.error!.details).toEqual({
        missingFields: ['name', 'email'],
      });
    });

    it('should fail when a single required field is missing', async () => {
      const task = createMockTask({
        template: {
          name: { type: 'string', required: true },
          age: { type: 'number', required: true },
        },
        data: {
          name: 'Bob',
        },
      });

      const result = await executeFormFill(task);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('MISSING_REQUIRED_FIELD');
      expect(result.error!.details).toEqual({
        missingFields: ['age'],
      });
    });

    it('should treat undefined values as missing for required fields', async () => {
      const task = createMockTask({
        template: {
          name: { type: 'string', required: true },
        },
        data: {
          name: undefined,
        },
      });

      const result = await executeFormFill(task);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('MISSING_REQUIRED_FIELD');
      expect(result.error!.details).toEqual({
        missingFields: ['name'],
      });
    });
  });

  describe('DATA_TYPE_MISMATCH error (Req 6.5)', () => {
    it('should fail with DATA_TYPE_MISMATCH when data types do not match', async () => {
      const task = createMockTask({
        template: {
          name: { type: 'string', required: true },
          age: { type: 'number', required: true },
        },
        data: {
          name: 'Alice',
          age: 'not a number',
        },
      });

      const result = await executeFormFill(task);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('DATA_TYPE_MISMATCH');
      expect(result.error!.details).toEqual({
        mismatches: [
          { field: 'age', expected: 'number', actual: 'string' },
        ],
      });
    });

    it('should detect multiple type mismatches', async () => {
      const task = createMockTask({
        template: {
          name: { type: 'string', required: true },
          active: { type: 'boolean', required: true },
          scores: { type: 'array', required: true },
        },
        data: {
          name: 123,
          active: 'yes',
          scores: 'not an array',
        },
      });

      const result = await executeFormFill(task);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('DATA_TYPE_MISMATCH');
      expect(result.error!.details).toEqual({
        mismatches: [
          { field: 'name', expected: 'string', actual: 'number' },
          { field: 'active', expected: 'boolean', actual: 'string' },
          { field: 'scores', expected: 'array', actual: 'string' },
        ],
      });
    });

    it('should distinguish array from object', async () => {
      const task = createMockTask({
        template: {
          config: { type: 'object', required: true },
        },
        data: {
          config: [1, 2, 3],
        },
      });

      const result = await executeFormFill(task);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('DATA_TYPE_MISMATCH');
      expect(result.error!.details).toEqual({
        mismatches: [
          { field: 'config', expected: 'object', actual: 'array' },
        ],
      });
    });

    it('should distinguish object from array', async () => {
      const task = createMockTask({
        template: {
          items: { type: 'array', required: true },
        },
        data: {
          items: { key: 'value' },
        },
      });

      const result = await executeFormFill(task);

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('DATA_TYPE_MISMATCH');
      expect(result.error!.details).toEqual({
        mismatches: [
          { field: 'items', expected: 'array', actual: 'object' },
        ],
      });
    });
  });

  describe('Validation ordering', () => {
    it('should check required fields before type mismatches', async () => {
      const task = createMockTask({
        template: {
          name: { type: 'string', required: true },
          age: { type: 'number', required: true },
        },
        data: {
          age: 'not a number', // type mismatch, but name is missing first
        },
      });

      const result = await executeFormFill(task);

      // Required field check comes first
      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('MISSING_REQUIRED_FIELD');
    });
  });

  describe('ISO 8601 timestamps', () => {
    it('should return valid ISO 8601 startedAt and completedAt', async () => {
      const task = createMockTask({
        template: {
          field: { type: 'string', required: true },
        },
        data: {
          field: 'value',
        },
      });

      const result = await executeFormFill(task);

      expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(new Date(result.startedAt).getTime()).not.toBeNaN();
      expect(new Date(result.completedAt).getTime()).not.toBeNaN();
    });
  });
});
