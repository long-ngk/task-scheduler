import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { executeFileImport } from '../../src/executors/fileImport.executor.js';
import type { ITaskDocument } from '../../src/models/task.model.js';

// Mock config
vi.mock('../../src/config/index.js', () => ({
  getConfig: () => ({
    fileSystem: {
      allowedBasePaths: ['/data', os.tmpdir()],
      maxFileSizeBytes: 10 * 1024 * 1024,
    },
  }),
}));

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function createMockTask(filePaths: string[]): ITaskDocument {
  return {
    _id: 'test-task-id',
    type: 'file_import',
    status: 'running',
    payload: { filePaths },
    timeout: 30,
    maxRetries: 3,
    retryCount: 0,
    executionHistory: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as ITaskDocument;
}

describe('FileImport Executor', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-import-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('CSV file processing', () => {
    it('should successfully parse a valid CSV file', async () => {
      const csvPath = path.join(tempDir, 'data.csv');
      fs.writeFileSync(csvPath, 'name,age,city\nAlice,30,NYC\nBob,25,LA\n');

      const task = createMockTask([csvPath]);
      const result = await executeFileImport(task);

      expect(result.success).toBe(true);
      expect(result.startedAt).toBeDefined();
      expect(result.completedAt).toBeDefined();

      const report = result.result as Record<string, unknown>;
      expect(report.total).toBe(1);
      expect(report.successCount).toBe(1);
      expect(report.failedCount).toBe(0);
      expect(report.failedFiles).toEqual([]);
    });

    it('should fail with INVALID_CONTENT for malformed CSV (empty file)', async () => {
      const csvPath = path.join(tempDir, 'empty.csv');
      fs.writeFileSync(csvPath, '');

      const task = createMockTask([csvPath]);
      const result = await executeFileImport(task);

      expect(result.success).toBe(false);
      const report = result.result as Record<string, unknown>;
      expect(report.failedCount).toBe(1);

      const failedFiles = report.failedFiles as Array<{ errorCode: string }>;
      expect(failedFiles[0].errorCode).toBe('INVALID_CONTENT');
    });
  });

  describe('JSON file processing', () => {
    it('should successfully parse a valid JSON file', async () => {
      const jsonPath = path.join(tempDir, 'data.json');
      fs.writeFileSync(jsonPath, JSON.stringify({ users: [{ name: 'Alice' }] }));

      const task = createMockTask([jsonPath]);
      const result = await executeFileImport(task);

      expect(result.success).toBe(true);
      const report = result.result as Record<string, unknown>;
      expect(report.total).toBe(1);
      expect(report.successCount).toBe(1);
      expect(report.failedCount).toBe(0);
    });

    it('should fail with INVALID_CONTENT for malformed JSON', async () => {
      const jsonPath = path.join(tempDir, 'bad.json');
      fs.writeFileSync(jsonPath, '{ invalid json content');

      const task = createMockTask([jsonPath]);
      const result = await executeFileImport(task);

      expect(result.success).toBe(false);
      const report = result.result as Record<string, unknown>;
      expect(report.failedCount).toBe(1);

      const failedFiles = report.failedFiles as Array<{ errorCode: string }>;
      expect(failedFiles[0].errorCode).toBe('INVALID_CONTENT');
    });
  });

  describe('Error handling per file', () => {
    it('should return FILE_NOT_FOUND for non-existent file', async () => {
      const filePath = path.join(tempDir, 'does-not-exist.csv');

      const task = createMockTask([filePath]);
      const result = await executeFileImport(task);

      expect(result.success).toBe(false);
      const report = result.result as Record<string, unknown>;
      const failedFiles = report.failedFiles as Array<{ errorCode: string }>;
      expect(failedFiles[0].errorCode).toBe('FILE_NOT_FOUND');
    });

    it('should return UNSUPPORTED_FORMAT for non-CSV/JSON files', async () => {
      const txtPath = path.join(tempDir, 'data.txt');
      fs.writeFileSync(txtPath, 'some text');

      const task = createMockTask([txtPath]);
      const result = await executeFileImport(task);

      expect(result.success).toBe(false);
      const report = result.result as Record<string, unknown>;
      const failedFiles = report.failedFiles as Array<{ errorCode: string }>;
      expect(failedFiles[0].errorCode).toBe('UNSUPPORTED_FORMAT');
    });

    it('should return FILE_ACCESS_DENIED for path outside allowed directories', async () => {
      const task = createMockTask(['/etc/passwd.csv']);
      const result = await executeFileImport(task);

      expect(result.success).toBe(false);
      const report = result.result as Record<string, unknown>;
      const failedFiles = report.failedFiles as Array<{ errorCode: string }>;
      expect(failedFiles[0].errorCode).toBe('FILE_ACCESS_DENIED');
    });

    it('should return FILE_ACCESS_DENIED for path traversal attempts', async () => {
      const task = createMockTask([path.join(tempDir, '..', '..', 'etc', 'passwd.csv')]);
      const result = await executeFileImport(task);

      expect(result.success).toBe(false);
      const report = result.result as Record<string, unknown>;
      const failedFiles = report.failedFiles as Array<{ errorCode: string }>;
      expect(failedFiles[0].errorCode).toBe('FILE_ACCESS_DENIED');
    });
  });

  describe('Multiple files processing', () => {
    it('should process files sequentially and report mixed results', async () => {
      const csvPath = path.join(tempDir, 'valid.csv');
      fs.writeFileSync(csvPath, 'col1,col2\nval1,val2\n');

      const nonExistentPath = path.join(tempDir, 'missing.json');

      const task = createMockTask([csvPath, nonExistentPath]);
      const result = await executeFileImport(task);

      // At least one success → overall success
      expect(result.success).toBe(true);
      const report = result.result as Record<string, unknown>;
      expect(report.total).toBe(2);
      expect(report.successCount).toBe(1);
      expect(report.failedCount).toBe(1);
    });

    it('should mark task as failed when all files fail', async () => {
      const task = createMockTask([
        path.join(tempDir, 'missing1.csv'),
        path.join(tempDir, 'missing2.json'),
      ]);
      const result = await executeFileImport(task);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.code).toBe('FILE_IMPORT_FAILED');

      const report = result.result as Record<string, unknown>;
      expect(report.total).toBe(2);
      expect(report.successCount).toBe(0);
      expect(report.failedCount).toBe(2);
    });

    it('should mark task as success when at least one file succeeds', async () => {
      const jsonPath = path.join(tempDir, 'good.json');
      fs.writeFileSync(jsonPath, '{"data": true}');

      const task = createMockTask([
        path.join(tempDir, 'missing.csv'),
        jsonPath,
        path.join(tempDir, 'missing2.json'),
      ]);
      const result = await executeFileImport(task);

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();

      const report = result.result as Record<string, unknown>;
      expect(report.total).toBe(3);
      expect(report.successCount).toBe(1);
      expect(report.failedCount).toBe(2);
    });
  });

  describe('Report generation', () => {
    it('should include correct report structure with all fields', async () => {
      const csvPath = path.join(tempDir, 'report.csv');
      fs.writeFileSync(csvPath, 'header\nvalue\n');

      const task = createMockTask([csvPath]);
      const result = await executeFileImport(task);

      const report = result.result as Record<string, unknown>;
      expect(report).toHaveProperty('total');
      expect(report).toHaveProperty('successCount');
      expect(report).toHaveProperty('failedCount');
      expect(report).toHaveProperty('failedFiles');
      expect(report).toHaveProperty('importedFiles');
    });

    it('should include failed file details with errorCode and reason', async () => {
      const txtPath = path.join(tempDir, 'data.xml');
      fs.writeFileSync(txtPath, '<root/>');

      const task = createMockTask([txtPath]);
      const result = await executeFileImport(task);

      const report = result.result as Record<string, unknown>;
      const failedFiles = report.failedFiles as Array<{
        filePath: string;
        errorCode: string;
        reason: string;
      }>;
      expect(failedFiles).toHaveLength(1);
      expect(failedFiles[0].filePath).toBe(txtPath);
      expect(failedFiles[0].errorCode).toBe('UNSUPPORTED_FORMAT');
      expect(failedFiles[0].reason).toBeDefined();
    });
  });

  describe('Empty filePaths', () => {
    it('should return failed when filePaths is empty', async () => {
      const task = createMockTask([]);
      const result = await executeFileImport(task);

      // 0 successes → overall failed
      expect(result.success).toBe(false);
      const report = result.result as Record<string, unknown>;
      expect(report.total).toBe(0);
      expect(report.successCount).toBe(0);
      expect(report.failedCount).toBe(0);
    });
  });

  describe('ISO 8601 timestamps', () => {
    it('should return valid ISO 8601 startedAt and completedAt', async () => {
      const csvPath = path.join(tempDir, 'time.csv');
      fs.writeFileSync(csvPath, 'a\n1\n');

      const task = createMockTask([csvPath]);
      const result = await executeFileImport(task);

      expect(new Date(result.startedAt).toISOString()).toBe(result.startedAt);
      expect(new Date(result.completedAt).toISOString()).toBe(result.completedAt);
      expect(new Date(result.startedAt).getTime()).toBeLessThanOrEqual(
        new Date(result.completedAt).getTime(),
      );
    });
  });
});
