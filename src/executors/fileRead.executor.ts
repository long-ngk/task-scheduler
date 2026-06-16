/**
 * File Read Task Executor.
 *
 * Reads a file from disk and returns metadata including filename, size,
 * read time, line count, and encoding.
 *
 * Security: validates file path against allowed base directories and
 * rejects path traversal attempts.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { getConfig } from '../config/index.js';

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

export interface FileReadTask {
  payload: {
    filePath: string;
  };
}

// --- Error Codes ---

const ERROR_CODES = {
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  FILE_ACCESS_DENIED: 'FILE_ACCESS_DENIED',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_PATH_INVALID: 'FILE_PATH_INVALID',
} as const;

// --- Helper Functions ---

/**
 * Validates that a file path does not contain path traversal segments
 * and resolves within one of the allowed base directories.
 */
function validateFilePath(filePath: string, allowedBasePaths: string[]): TaskError | null {
  // Check for path traversal segments in the raw path
  const normalizedSeparators = filePath.replace(/\\/g, '/');
  const segments = normalizedSeparators.split('/');

  for (const segment of segments) {
    if (segment === '..') {
      return {
        code: ERROR_CODES.FILE_PATH_INVALID,
        message: 'Path traversal detected: ".." segments are not allowed',
        details: { filePath },
      };
    }
  }

  // Resolve the absolute path
  const resolvedPath = path.resolve(filePath);

  // Check if resolved path is within any allowed base directory
  const isAllowed = allowedBasePaths.some((basePath) => {
    const resolvedBase = path.resolve(basePath);
    // Ensure the resolved path starts with the base path followed by a separator
    // or is exactly the base path (for reading a file at the root of allowed dir)
    return (
      resolvedPath === resolvedBase ||
      resolvedPath.startsWith(resolvedBase + path.sep)
    );
  });

  if (!isAllowed) {
    return {
      code: ERROR_CODES.FILE_PATH_INVALID,
      message: 'File path is outside allowed base directories',
      details: { filePath, allowedBasePaths },
    };
  }

  return null;
}

/**
 * Counts the number of lines in a string.
 */
function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  // Count newline characters; a file with no newline still has 1 line
  const newlineCount = content.split('\n').length;
  return newlineCount;
}

// --- Executor ---

/**
 * Executes a file read task.
 *
 * Steps:
 * 1. Validate file path (no traversal, within allowed directories)
 * 2. Check file exists (stat)
 * 3. Check read permissions (access)
 * 4. Check file size against configured maximum
 * 5. Read file content
 * 6. Return metadata: filename, size, read time, line count, encoding
 */
export async function executeFileRead(task: FileReadTask): Promise<ExecutionResult> {
  const startedAt = new Date().toISOString();
  const config = getConfig();
  const { allowedBasePaths, maxFileSizeBytes } = config.fileSystem;
  const filePath = task.payload.filePath;

  // Step 1: Validate file path
  const pathError = validateFilePath(filePath, allowedBasePaths);
  if (pathError) {
    return {
      success: false,
      error: pathError,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  const resolvedPath = path.resolve(filePath);

  // Step 2: Check file exists
  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(resolvedPath);
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code === 'ENOENT') {
      return {
        success: false,
        error: {
          code: ERROR_CODES.FILE_NOT_FOUND,
          message: `File does not exist: ${filePath}`,
          details: { filePath },
        },
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }
    // For permission errors during stat
    if (nodeErr.code === 'EACCES') {
      return {
        success: false,
        error: {
          code: ERROR_CODES.FILE_ACCESS_DENIED,
          message: `No read permission for file: ${filePath}`,
          details: { filePath },
        },
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }
    throw err;
  }

  // Step 3: Check read permissions
  try {
    await fs.promises.access(resolvedPath, fs.constants.R_OK);
  } catch {
    return {
      success: false,
      error: {
        code: ERROR_CODES.FILE_ACCESS_DENIED,
        message: `No read permission for file: ${filePath}`,
        details: { filePath },
      },
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  // Step 4: Check file size
  if (stats.size > maxFileSizeBytes) {
    return {
      success: false,
      error: {
        code: ERROR_CODES.FILE_TOO_LARGE,
        message: `File size ${stats.size} bytes exceeds maximum allowed ${maxFileSizeBytes} bytes`,
        details: {
          filePath,
          fileSize: stats.size,
          maxAllowed: maxFileSizeBytes,
        },
      },
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  // Step 5: Read file content
  const content = await fs.promises.readFile(resolvedPath, 'utf-8');

  // Step 6: Return metadata
  const readTime = new Date().toISOString();
  const lineCount = countLines(content);
  const filename = path.basename(resolvedPath);
  const encoding = 'utf-8';

  return {
    success: true,
    result: {
      filename,
      size: stats.size,
      readTime,
      lineCount,
      encoding,
    },
    startedAt,
    completedAt: readTime,
  };
}
