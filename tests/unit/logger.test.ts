import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, asyncLocalStorage, LogEntry } from '../../src/utils/logger';

describe('Logger Utility', () => {
  let writtenOutput: string[];

  beforeEach(() => {
    writtenOutput = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      writtenOutput.push(chunk.toString());
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function getLastLogEntry(): LogEntry {
    const lastLine = writtenOutput[writtenOutput.length - 1];
    return JSON.parse(lastLine.trim());
  }

  describe('log levels', () => {
    it('should log info level messages', () => {
      logger.info('test info message');
      const entry = getLastLogEntry();
      expect(entry.level).toBe('info');
      expect(entry.message).toBe('test info message');
    });

    it('should log warn level messages', () => {
      logger.warn('test warn message');
      const entry = getLastLogEntry();
      expect(entry.level).toBe('warn');
      expect(entry.message).toBe('test warn message');
    });

    it('should log error level messages', () => {
      logger.error('test error message');
      const entry = getLastLogEntry();
      expect(entry.level).toBe('error');
      expect(entry.message).toBe('test error message');
    });

    it('should log debug level messages', () => {
      logger.debug('test debug message');
      const entry = getLastLogEntry();
      expect(entry.level).toBe('debug');
      expect(entry.message).toBe('test debug message');
    });
  });

  describe('log entry structure', () => {
    it('should output valid JSON', () => {
      logger.info('json test');
      const lastLine = writtenOutput[writtenOutput.length - 1];
      expect(() => JSON.parse(lastLine.trim())).not.toThrow();
    });

    it('should include ISO 8601 timestamp', () => {
      logger.info('timestamp test');
      const entry = getLastLogEntry();
      expect(entry.timestamp).toBeDefined();
      const date = new Date(entry.timestamp);
      expect(date.toISOString()).toBe(entry.timestamp);
    });

    it('should include context when provided', () => {
      logger.info('with context', { userId: '123', action: 'login' });
      const entry = getLastLogEntry();
      expect(entry.context).toEqual({ userId: '123', action: 'login' });
    });

    it('should not include context key when context is undefined', () => {
      logger.info('no context');
      const entry = getLastLogEntry();
      expect(entry).not.toHaveProperty('context');
    });

    it('should use "no-correlation-id" when no AsyncLocalStorage context', () => {
      logger.info('no correlation');
      const entry = getLastLogEntry();
      expect(entry.correlationId).toBe('no-correlation-id');
    });
  });

  describe('AsyncLocalStorage integration', () => {
    it('should inject correlationId from AsyncLocalStorage', () => {
      asyncLocalStorage.run({ correlationId: 'test-correlation-123' }, () => {
        logger.info('correlated message');
        const entry = getLastLogEntry();
        expect(entry.correlationId).toBe('test-correlation-123');
      });
    });

    it('should use different correlationIds in nested contexts', () => {
      asyncLocalStorage.run({ correlationId: 'outer-id' }, () => {
        logger.info('outer message');
        const outerEntry = getLastLogEntry();
        expect(outerEntry.correlationId).toBe('outer-id');

        asyncLocalStorage.run({ correlationId: 'inner-id' }, () => {
          logger.info('inner message');
          const innerEntry = getLastLogEntry();
          expect(innerEntry.correlationId).toBe('inner-id');
        });
      });
    });

    it('should revert to no-correlation-id outside AsyncLocalStorage context', () => {
      asyncLocalStorage.run({ correlationId: 'temp-id' }, () => {
        logger.info('inside');
      });
      logger.info('outside');
      const entry = getLastLogEntry();
      expect(entry.correlationId).toBe('no-correlation-id');
    });
  });

  describe('output format', () => {
    it('should write each log entry as a single line ending with newline', () => {
      logger.info('line test');
      const output = writtenOutput[writtenOutput.length - 1];
      expect(output.endsWith('\n')).toBe(true);
      expect(output.trim().split('\n')).toHaveLength(1);
    });
  });
});
