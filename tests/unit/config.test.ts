import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, resetConfig, ConfigValidationError } from '@/config/index';

describe('Configuration Module', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
  });

  afterEach(() => {
    process.env = originalEnv;
    resetConfig();
  });

  describe('loadConfig - defaults', () => {
    it('should load default configuration when no env vars are set', () => {
      const config = loadConfig();

      expect(config.port).toBe(3000);
      expect(config.mongodb.uri).toBe('mongodb://localhost:27017');
      expect(config.mongodb.dbName).toBe('task_scheduler');
      expect(config.redis.host).toBe('localhost');
      expect(config.redis.port).toBe(6379);
      expect(config.redis.password).toBeUndefined();
      expect(config.scheduler.pollIntervalMs).toBe(1000);
      expect(config.scheduler.maxToleranceMs).toBe(5000);
      expect(config.task.defaultTimeoutSeconds).toBe(30);
      expect(config.task.defaultMaxRetries).toBe(3);
      expect(config.task.retryBaseDelaySeconds).toBe(1);
      expect(config.task.retryMultiplier).toBe(2);
      expect(config.task.retryMaxDelaySeconds).toBe(300);
      expect(config.fileSystem.allowedBasePaths).toEqual(['/data']);
      expect(config.fileSystem.maxFileSizeBytes).toBe(10 * 1024 * 1024);
      expect(config.email.smtp.host).toBe('localhost');
      expect(config.email.smtp.port).toBe(587);
      expect(config.email.smtp.secure).toBe(false);
      expect(config.email.smtp.auth.user).toBe('');
      expect(config.email.smtp.auth.pass).toBe('');
      expect(config.queue.maxPayloadSizeBytes).toBe(1 * 1024 * 1024);
    });
  });

  describe('loadConfig - environment variables', () => {
    it('should load configuration from environment variables', () => {
      process.env.PORT = '8080';
      process.env.MONGODB_URI = 'mongodb://db:27017';
      process.env.MONGODB_DB_NAME = 'test_db';
      process.env.REDIS_HOST = 'redis-host';
      process.env.REDIS_PORT = '6380';
      process.env.REDIS_PASSWORD = 'secret';
      process.env.SCHEDULER_POLL_INTERVAL_MS = '2000';
      process.env.SCHEDULER_MAX_TOLERANCE_MS = '10000';
      process.env.TASK_DEFAULT_TIMEOUT_SECONDS = '60';
      process.env.TASK_DEFAULT_MAX_RETRIES = '5';
      process.env.TASK_RETRY_BASE_DELAY_SECONDS = '2';
      process.env.TASK_RETRY_MULTIPLIER = '3';
      process.env.TASK_RETRY_MAX_DELAY_SECONDS = '600';
      process.env.FILESYSTEM_ALLOWED_BASE_PATHS = '/data,/tmp,/uploads';
      process.env.FILESYSTEM_MAX_FILE_SIZE_BYTES = '5242880';
      process.env.SMTP_HOST = 'smtp.example.com';
      process.env.SMTP_PORT = '465';
      process.env.SMTP_SECURE = 'true';
      process.env.SMTP_USER = 'user@example.com';
      process.env.SMTP_PASS = 'password123';
      process.env.QUEUE_MAX_PAYLOAD_SIZE_BYTES = '2097152';

      const config = loadConfig();

      expect(config.port).toBe(8080);
      expect(config.mongodb.uri).toBe('mongodb://db:27017');
      expect(config.mongodb.dbName).toBe('test_db');
      expect(config.redis.host).toBe('redis-host');
      expect(config.redis.port).toBe(6380);
      expect(config.redis.password).toBe('secret');
      expect(config.scheduler.pollIntervalMs).toBe(2000);
      expect(config.scheduler.maxToleranceMs).toBe(10000);
      expect(config.task.defaultTimeoutSeconds).toBe(60);
      expect(config.task.defaultMaxRetries).toBe(5);
      expect(config.task.retryBaseDelaySeconds).toBe(2);
      expect(config.task.retryMultiplier).toBe(3);
      expect(config.task.retryMaxDelaySeconds).toBe(600);
      expect(config.fileSystem.allowedBasePaths).toEqual(['/data', '/tmp', '/uploads']);
      expect(config.fileSystem.maxFileSizeBytes).toBe(5242880);
      expect(config.email.smtp.host).toBe('smtp.example.com');
      expect(config.email.smtp.port).toBe(465);
      expect(config.email.smtp.secure).toBe(true);
      expect(config.email.smtp.auth.user).toBe('user@example.com');
      expect(config.email.smtp.auth.pass).toBe('password123');
      expect(config.queue.maxPayloadSizeBytes).toBe(2097152);
    });

    it('should handle empty string env vars as defaults', () => {
      process.env.PORT = '';
      process.env.REDIS_PORT = '';

      const config = loadConfig();

      expect(config.port).toBe(3000);
      expect(config.redis.port).toBe(6379);
    });

    it('should handle non-numeric env vars as defaults', () => {
      process.env.PORT = 'abc';
      process.env.REDIS_PORT = 'invalid';

      const config = loadConfig();

      expect(config.port).toBe(3000);
      expect(config.redis.port).toBe(6379);
    });
  });

  describe('loadConfig - validation', () => {
    it('should throw ConfigValidationError when timeout is below range', () => {
      process.env.TASK_DEFAULT_TIMEOUT_SECONDS = '0';

      expect(() => loadConfig()).toThrow(ConfigValidationError);
      try {
        loadConfig();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError);
        expect((error as ConfigValidationError).errors).toContain(
          'task.defaultTimeoutSeconds must be between 1 and 3600, got 0'
        );
      }
    });

    it('should throw ConfigValidationError when timeout is above range', () => {
      process.env.TASK_DEFAULT_TIMEOUT_SECONDS = '3601';

      expect(() => loadConfig()).toThrow(ConfigValidationError);
    });

    it('should throw ConfigValidationError when maxRetries is below range', () => {
      process.env.TASK_DEFAULT_MAX_RETRIES = '-1';

      expect(() => loadConfig()).toThrow(ConfigValidationError);
    });

    it('should throw ConfigValidationError when maxRetries is above range', () => {
      process.env.TASK_DEFAULT_MAX_RETRIES = '11';

      expect(() => loadConfig()).toThrow(ConfigValidationError);
    });

    it('should throw ConfigValidationError when port is invalid', () => {
      process.env.PORT = '70000';

      expect(() => loadConfig()).toThrow(ConfigValidationError);
    });

    it('should accept boundary values for timeout (1 and 3600)', () => {
      process.env.TASK_DEFAULT_TIMEOUT_SECONDS = '1';
      expect(() => loadConfig()).not.toThrow();
      resetConfig();

      process.env.TASK_DEFAULT_TIMEOUT_SECONDS = '3600';
      expect(() => loadConfig()).not.toThrow();
    });

    it('should accept boundary values for maxRetries (0 and 10)', () => {
      process.env.TASK_DEFAULT_MAX_RETRIES = '0';
      expect(() => loadConfig()).not.toThrow();
      resetConfig();

      process.env.TASK_DEFAULT_MAX_RETRIES = '10';
      expect(() => loadConfig()).not.toThrow();
    });

    it('should collect multiple validation errors', () => {
      process.env.TASK_DEFAULT_TIMEOUT_SECONDS = '0';
      process.env.TASK_DEFAULT_MAX_RETRIES = '11';
      process.env.PORT = '0';

      try {
        loadConfig();
      } catch (error) {
        expect(error).toBeInstanceOf(ConfigValidationError);
        expect((error as ConfigValidationError).errors.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe('loadConfig - parseBoolean', () => {
    it('should parse SMTP_SECURE as true', () => {
      process.env.SMTP_SECURE = 'true';
      const config = loadConfig();
      expect(config.email.smtp.secure).toBe(true);
    });

    it('should parse SMTP_SECURE as true with "1"', () => {
      process.env.SMTP_SECURE = '1';
      const config = loadConfig();
      expect(config.email.smtp.secure).toBe(true);
    });

    it('should parse SMTP_SECURE as false with "false"', () => {
      process.env.SMTP_SECURE = 'false';
      const config = loadConfig();
      expect(config.email.smtp.secure).toBe(false);
    });
  });

  describe('loadConfig - parseStringArray', () => {
    it('should parse comma-separated base paths', () => {
      process.env.FILESYSTEM_ALLOWED_BASE_PATHS = '/data, /uploads , /tmp';
      const config = loadConfig();
      expect(config.fileSystem.allowedBasePaths).toEqual(['/data', '/uploads', '/tmp']);
    });

    it('should filter empty strings from array', () => {
      process.env.FILESYSTEM_ALLOWED_BASE_PATHS = '/data,,/tmp,';
      const config = loadConfig();
      expect(config.fileSystem.allowedBasePaths).toEqual(['/data', '/tmp']);
    });
  });
});
