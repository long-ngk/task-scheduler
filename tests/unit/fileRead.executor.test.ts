/**
 * Unit tests for the File Read Executor.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { executeFileRead } from '../../src/executors/fileRead.executor.js';
import { resetConfig } from '../../src/config/index.js';

// Create a temp directory for test files
let testDir: string;

beforeAll(() => {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fileread-test-'));

  // Set up env to allow our test directory
  process.env.FILESYSTEM_ALLOWED_BASE_PATHS = testDir;
});

afterAll(() => {
  fs.rmSync(testDir, { recursive: true, force: true });
  delete process.env.FILESYSTEM_ALLOWED_BASE_PATHS;
  resetConfig();
});

beforeEach(() => {
  resetConfig();
});

describe('fileRead.executor', () => {
  describe('successful file read', () => {
    it('should read a file and return metadata', async () => {
      const filePath = path.join(testDir, 'test.txt');
      fs.writeFileSync(filePath, 'line1\nline2\nline3');

      const result = await executeFileRead({ payload: { filePath } });

      expect(result.success).toBe(true);
      expect(result.result).toBeDefined();
      expect(result.result!.filename).toBe('test.txt');
      expect(result.result!.size).toBe(fs.statSync(filePath).size);
      expect(result.result!.lineCount).toBe(3);
      expect(result.result!.encoding).toBe('utf-8');
      expect(result.result!.readTime).toBeDefined();
      expect(result.startedAt).toBeDefined();
      expect(result.completedAt).toBeDefined();
    });

    it('should return lineCount 0 for empty file', async () => {
      const filePath = path.join(testDir, 'empty.txt');
      fs.writeFileSync(filePath, '');

      const result = await executeFileRead({ payload: { filePath } });

      expect(result.success).toBe(true);
      expect(result.result!.lineCount).toBe(0);
      expect(result.result!.size).toBe(0);
    });

    it('should return lineCount 1 for single line without newline', async () => {
      const filePath = path.join(testDir, 'single-line.txt');
      fs.writeFileSync(filePath, 'hello');

      const result = await executeFileRead({ payload: { filePath } });

      expect(result.success).toBe(true);
      expect(result.result!.lineCount).toBe(1);
    });

    it('should return ISO 8601 timestamps', async () => {
      const filePath = path.join(testDir, 'timestamps.txt');
      fs.writeFileSync(filePath, 'data');

      const result = await executeFileRead({ payload: { filePath } });

      expect(result.success).toBe(true);
      // Validate ISO 8601 format
      expect(() => new Date(result.startedAt)).not.toThrow();
      expect(new Date(result.startedAt).toISOString()).toBe(result.startedAt);
      expect(() => new Date(result.completedAt)).not.toThrow();
      expect(new Date(result.completedAt).toISOString()).toBe(result.completedAt);
    });
  });

  describe('FILE_PATH_INVALID - path traversal', () => {
    it('should reject paths with .. segments', async () => {
      const filePath = path.join(testDir, '..', 'etc', 'passwd');

      const result = await executeFileRead({ payload: { filePath } });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('FILE_PATH_INVALID');
    });

    it('should reject paths outside allowed base directories', async () => {
      const filePath = '/some/other/directory/file.txt';

      const result = await executeFileRead({ payload: { filePath } });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('FILE_PATH_INVALID');
    });

    it('should reject relative paths with .. at the start', async () => {
      const filePath = '../../../etc/shadow';

      const result = await executeFileRead({ payload: { filePath } });

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('FILE_PATH_INVALID');
    });
  });

  describe('FILE_NOT_FOUND', () => {
    it('should return FILE_NOT_FOUND for non-existent file', async () => {
      const filePath = path.join(testDir, 'nonexistent.txt');

      const result = await executeFileRead({ payload: { filePath } });

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('FILE_NOT_FOUND');
      expect(result.error!.message).toContain('does not exist');
    });
  });

  describe('FILE_TOO_LARGE', () => {
    it('should return FILE_TOO_LARGE when file exceeds max size', async () => {
      // Set max size to something tiny for testing
      process.env.FILESYSTEM_MAX_FILE_SIZE_BYTES = '10';
      process.env.FILESYSTEM_ALLOWED_BASE_PATHS = testDir;
      resetConfig();

      const filePath = path.join(testDir, 'large.txt');
      fs.writeFileSync(filePath, 'A'.repeat(100));

      const result = await executeFileRead({ payload: { filePath } });

      expect(result.success).toBe(false);
      expect(result.error!.code).toBe('FILE_TOO_LARGE');
      expect(result.error!.details).toBeDefined();
      expect((result.error!.details as Record<string, unknown>).fileSize).toBe(100);
      expect((result.error!.details as Record<string, unknown>).maxAllowed).toBe(10);

      // Restore
      delete process.env.FILESYSTEM_MAX_FILE_SIZE_BYTES;
      resetConfig();
    });
  });

  describe('error result structure', () => {
    it('should always include startedAt and completedAt on error', async () => {
      const filePath = path.join(testDir, 'nonexistent.txt');

      const result = await executeFileRead({ payload: { filePath } });

      expect(result.success).toBe(false);
      expect(result.startedAt).toBeDefined();
      expect(result.completedAt).toBeDefined();
      expect(new Date(result.startedAt).toISOString()).toBe(result.startedAt);
      expect(new Date(result.completedAt).toISOString()).toBe(result.completedAt);
    });

    it('should include error details with code and message', async () => {
      const filePath = '/outside/allowed/dir.txt';

      const result = await executeFileRead({ payload: { filePath } });

      expect(result.error).toBeDefined();
      expect(result.error!.code).toBeTruthy();
      expect(result.error!.message).toBeTruthy();
    });
  });
});
