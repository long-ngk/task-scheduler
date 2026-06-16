import * as fs from 'node:fs';
import * as path from 'node:path';
import { getConfig } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { ITaskDocument } from '../models/task.model.js';

// --- Interfaces ---

export interface ExecutionResult {
  success: boolean;
  result?: Record<string, unknown>;
  error?: TaskError;
  startedAt: string; // ISO 8601
  completedAt: string; // ISO 8601
}

export interface TaskError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface FileImportReport {
  total: number;
  successCount: number;
  failedCount: number;
  failedFiles: Array<{ filePath: string; errorCode: string; reason: string }>;
  importedFiles: string[];
}

// --- Error codes ---

const FILE_NOT_FOUND = 'FILE_NOT_FOUND';
const FILE_ACCESS_DENIED = 'FILE_ACCESS_DENIED';
const UNSUPPORTED_FORMAT = 'UNSUPPORTED_FORMAT';
const INVALID_CONTENT = 'INVALID_CONTENT';

// --- Helper functions ---

/**
 * Checks if a file path contains path traversal patterns or resolves outside allowed directories.
 */
function isPathSafe(filePath: string, allowedBasePaths: string[]): boolean {
  // Check for path traversal patterns
  if (filePath.includes('..')) {
    return false;
  }

  // Resolve absolute path
  const resolved = path.resolve(filePath);

  // Check if resolved path is within any allowed base path
  return allowedBasePaths.some((basePath) => {
    const resolvedBase = path.resolve(basePath);
    return resolved.startsWith(resolvedBase + path.sep) || resolved === resolvedBase;
  });
}

/**
 * Determines if the file extension is a supported format (CSV or JSON).
 */
function getSupportedFormat(filePath: string): 'csv' | 'json' | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv') return 'csv';
  if (ext === '.json') return 'json';
  return null;
}

/**
 * Parses CSV content into an array of records.
 * Simple CSV parser: splits by newlines and commas.
 */
function parseCsv(content: string): Record<string, unknown>[] {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error('CSV file is empty');
  }

  const headers = lines[0].split(',').map((h) => h.trim());
  if (headers.length === 0 || headers.some((h) => h.length === 0)) {
    throw new Error('CSV file has invalid or empty headers');
  }

  const records: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map((v) => v.trim());
    const record: Record<string, unknown> = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j] ?? '';
    }
    records.push(record);
  }

  return records;
}

/**
 * Parses JSON content. Validates it's a valid JSON structure.
 */
function parseJson(content: string): unknown {
  return JSON.parse(content);
}

/**
 * Processes a single file and returns parsed data or an error.
 */
function processFile(
  filePath: string,
  allowedBasePaths: string[],
  _maxFileSizeBytes: number,
): { success: true; data: unknown } | { success: false; errorCode: string; reason: string } {
  // 1. Validate path safety
  if (!isPathSafe(filePath, allowedBasePaths)) {
    return {
      success: false,
      errorCode: FILE_ACCESS_DENIED,
      reason: `File path is outside allowed directories or contains path traversal`,
    };
  }

  // 2. Check file format by extension
  const format = getSupportedFormat(filePath);
  if (!format) {
    return {
      success: false,
      errorCode: UNSUPPORTED_FORMAT,
      reason: `File format not supported. Only CSV and JSON formats are allowed`,
    };
  }

  // 3. Check file exists
  if (!fs.existsSync(filePath)) {
    return {
      success: false,
      errorCode: FILE_NOT_FOUND,
      reason: `File does not exist: ${filePath}`,
    };
  }

  // 4. Check read permissions
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    return {
      success: false,
      errorCode: FILE_ACCESS_DENIED,
      reason: `No read permission for file: ${filePath}`,
    };
  }

  // 5. Read and parse file content
  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return {
      success: false,
      errorCode: FILE_ACCESS_DENIED,
      reason: `Failed to read file: ${filePath}`,
    };
  }

  // 6. Parse content based on format
  try {
    if (format === 'csv') {
      const data = parseCsv(content);
      return { success: true, data };
    } else {
      const data = parseJson(content);
      return { success: true, data };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown parse error';
    return {
      success: false,
      errorCode: INVALID_CONTENT,
      reason: `File content doesn't match expected ${format.toUpperCase()} format: ${message}`,
    };
  }
}

// --- Executor ---

/**
 * File Import Executor
 *
 * Processes files sequentially from filePaths array.
 * Parses CSV and JSON formats.
 * Continues processing remaining files on individual failure.
 * Generates report: total, successCount, failedCount, failed files with reasons.
 * Determines task status: all fail → failed; at least one success → success.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
 */
export async function executeFileImport(task: ITaskDocument): Promise<ExecutionResult> {
  const startedAt = new Date().toISOString();
  const config = getConfig();
  const { allowedBasePaths, maxFileSizeBytes } = config.fileSystem;

  const payload = task.payload as { filePaths?: string[] };
  const filePaths = payload.filePaths ?? [];

  const report: FileImportReport = {
    total: filePaths.length,
    successCount: 0,
    failedCount: 0,
    failedFiles: [],
    importedFiles: [],
  };

  // Process each file sequentially
  for (const filePath of filePaths) {
    const result = processFile(filePath, allowedBasePaths, maxFileSizeBytes);

    if (result.success) {
      report.successCount++;
      report.importedFiles.push(filePath);
      logger.info(`File imported successfully`, { filePath });
    } else {
      report.failedCount++;
      report.failedFiles.push({
        filePath,
        errorCode: result.errorCode,
        reason: result.reason,
      });
      logger.error(`File import failed`, {
        filePath,
        errorCode: result.errorCode,
        reason: result.reason,
      });
    }
  }

  const completedAt = new Date().toISOString();

  // Determine overall task success: at least one success → success; all fail → failed
  if (report.successCount > 0) {
    return {
      success: true,
      result: report as unknown as Record<string, unknown>,
      startedAt,
      completedAt,
    };
  }

  // All files failed
  return {
    success: false,
    result: report as unknown as Record<string, unknown>,
    error: {
      code: 'FILE_IMPORT_FAILED',
      message: `All ${report.total} file(s) failed to import`,
      details: {
        failedFiles: report.failedFiles,
      },
    },
    startedAt,
    completedAt,
  };
}
