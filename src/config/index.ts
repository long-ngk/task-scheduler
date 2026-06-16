/**
 * Application configuration module.
 * Loads configuration from environment variables with sensible defaults
 * and validates ranges at startup.
 */

export interface AppConfig {
  port: number;
  mongodb: {
    uri: string;
    dbName: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
  };
  scheduler: {
    pollIntervalMs: number;
    maxToleranceMs: number;
  };
  task: {
    defaultTimeoutSeconds: number;
    defaultMaxRetries: number;
    retryBaseDelaySeconds: number;
    retryMultiplier: number;
    retryMaxDelaySeconds: number;
  };
  fileSystem: {
    allowedBasePaths: string[];
    maxFileSizeBytes: number;
  };
  email: {
    smtp: {
      host: string;
      port: number;
      secure: boolean;
      auth: { user: string; pass: string };
    };
  };
  queue: {
    maxPayloadSizeBytes: number;
  };
}

export class ConfigValidationError extends Error {
  constructor(public readonly errors: string[]) {
    super(`Configuration validation failed:\n${errors.join('\n')}`);
    this.name = 'ConfigValidationError';
  }
}

function parseNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined || value === '') return defaultValue;
  const parsed = Number(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined || value === '') return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}

function parseStringArray(value: string | undefined, defaultValue: string[]): string[] {
  if (value === undefined || value === '') return defaultValue;
  return value.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * Validates the configuration and throws if any values are out of range.
 */
function validateConfig(config: AppConfig): void {
  const errors: string[] = [];

  // Validate timeout range [1, 3600]
  if (config.task.defaultTimeoutSeconds < 1 || config.task.defaultTimeoutSeconds > 3600) {
    errors.push(
      `task.defaultTimeoutSeconds must be between 1 and 3600, got ${config.task.defaultTimeoutSeconds}`
    );
  }

  // Validate maxRetries range [0, 10]
  if (config.task.defaultMaxRetries < 0 || config.task.defaultMaxRetries > 10) {
    errors.push(
      `task.defaultMaxRetries must be between 0 and 10, got ${config.task.defaultMaxRetries}`
    );
  }

  // Validate port range
  if (config.port < 1 || config.port > 65535) {
    errors.push(`port must be between 1 and 65535, got ${config.port}`);
  }

  // Validate retry base delay is positive
  if (config.task.retryBaseDelaySeconds < 1) {
    errors.push(
      `task.retryBaseDelaySeconds must be at least 1, got ${config.task.retryBaseDelaySeconds}`
    );
  }

  // Validate retry multiplier is positive
  if (config.task.retryMultiplier < 1) {
    errors.push(`task.retryMultiplier must be at least 1, got ${config.task.retryMultiplier}`);
  }

  // Validate retry max delay is positive
  if (config.task.retryMaxDelaySeconds < 1) {
    errors.push(
      `task.retryMaxDelaySeconds must be at least 1, got ${config.task.retryMaxDelaySeconds}`
    );
  }

  // Validate scheduler poll interval is positive
  if (config.scheduler.pollIntervalMs < 100) {
    errors.push(
      `scheduler.pollIntervalMs must be at least 100, got ${config.scheduler.pollIntervalMs}`
    );
  }

  // Validate scheduler max tolerance is positive
  if (config.scheduler.maxToleranceMs < 1000) {
    errors.push(
      `scheduler.maxToleranceMs must be at least 1000, got ${config.scheduler.maxToleranceMs}`
    );
  }

  // Validate file system max size is positive
  if (config.fileSystem.maxFileSizeBytes < 1) {
    errors.push(
      `fileSystem.maxFileSizeBytes must be at least 1, got ${config.fileSystem.maxFileSizeBytes}`
    );
  }

  // Validate queue max payload size is positive
  if (config.queue.maxPayloadSizeBytes < 1) {
    errors.push(
      `queue.maxPayloadSizeBytes must be at least 1, got ${config.queue.maxPayloadSizeBytes}`
    );
  }

  // Validate redis port
  if (config.redis.port < 1 || config.redis.port > 65535) {
    errors.push(`redis.port must be between 1 and 65535, got ${config.redis.port}`);
  }

  // Validate smtp port
  if (config.email.smtp.port < 1 || config.email.smtp.port > 65535) {
    errors.push(`email.smtp.port must be between 1 and 65535, got ${config.email.smtp.port}`);
  }

  if (errors.length > 0) {
    throw new ConfigValidationError(errors);
  }
}

/**
 * Loads configuration from environment variables with defaults.
 * Validates all configuration ranges and throws ConfigValidationError if invalid.
 */
export function loadConfig(): AppConfig {
  const config: AppConfig = {
    port: parseNumber(process.env.PORT, 3000),
    mongodb: {
      uri: process.env.MONGODB_URI || 'mongodb://localhost:27017',
      dbName: process.env.MONGODB_DB_NAME || 'task_scheduler',
    },
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseNumber(process.env.REDIS_PORT, 6379),
      ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
    },
    scheduler: {
      pollIntervalMs: parseNumber(process.env.SCHEDULER_POLL_INTERVAL_MS, 1000),
      maxToleranceMs: parseNumber(process.env.SCHEDULER_MAX_TOLERANCE_MS, 5000),
    },
    task: {
      defaultTimeoutSeconds: parseNumber(process.env.TASK_DEFAULT_TIMEOUT_SECONDS, 30),
      defaultMaxRetries: parseNumber(process.env.TASK_DEFAULT_MAX_RETRIES, 3),
      retryBaseDelaySeconds: parseNumber(process.env.TASK_RETRY_BASE_DELAY_SECONDS, 1),
      retryMultiplier: parseNumber(process.env.TASK_RETRY_MULTIPLIER, 2),
      retryMaxDelaySeconds: parseNumber(process.env.TASK_RETRY_MAX_DELAY_SECONDS, 300),
    },
    fileSystem: {
      allowedBasePaths: parseStringArray(process.env.FILESYSTEM_ALLOWED_BASE_PATHS, ['/data']),
      maxFileSizeBytes: parseNumber(
        process.env.FILESYSTEM_MAX_FILE_SIZE_BYTES,
        10 * 1024 * 1024 // 10MB
      ),
    },
    email: {
      smtp: {
        host: process.env.SMTP_HOST || 'localhost',
        port: parseNumber(process.env.SMTP_PORT, 587),
        secure: parseBoolean(process.env.SMTP_SECURE, false),
        auth: {
          user: process.env.SMTP_USER || '',
          pass: process.env.SMTP_PASS || '',
        },
      },
    },
    queue: {
      maxPayloadSizeBytes: parseNumber(
        process.env.QUEUE_MAX_PAYLOAD_SIZE_BYTES,
        1 * 1024 * 1024 // 1MB
      ),
    },
  };

  validateConfig(config);

  return config;
}

/**
 * Singleton config instance. Call loadConfig() at startup to initialize.
 */
let _config: AppConfig | null = null;

/**
 * Get the application configuration. Must call loadConfig() first.
 */
export function getConfig(): AppConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/**
 * Reset the config singleton (useful for testing).
 */
export function resetConfig(): void {
  _config = null;
}
