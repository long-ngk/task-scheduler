import { AsyncLocalStorage } from 'node:async_hooks';

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  correlationId: string;
  message: string;
  context?: Record<string, unknown>;
}

export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

export interface RequestContext {
  correlationId: string;
}

export const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

function buildLogEntry(
  level: LogEntry['level'],
  message: string,
  context?: Record<string, unknown>,
): LogEntry {
  const store = asyncLocalStorage.getStore();
  const correlationId = store?.correlationId ?? 'no-correlation-id';

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    correlationId,
    message,
  };

  if (context !== undefined) {
    entry.context = context;
  }

  return entry;
}

function writeLog(entry: LogEntry): void {
  const output = JSON.stringify(entry);
  process.stdout.write(output + '\n');
}

export const logger: Logger = {
  info(message: string, context?: Record<string, unknown>): void {
    writeLog(buildLogEntry('info', message, context));
  },

  warn(message: string, context?: Record<string, unknown>): void {
    writeLog(buildLogEntry('warn', message, context));
  },

  error(message: string, context?: Record<string, unknown>): void {
    writeLog(buildLogEntry('error', message, context));
  },

  debug(message: string, context?: Record<string, unknown>): void {
    writeLog(buildLogEntry('debug', message, context));
  },
};
