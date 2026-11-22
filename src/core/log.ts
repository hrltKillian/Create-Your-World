/**
 * Logging without touching `console` in pure layers: the caller (app, tools, tests)
 * injects a sink. Until then, messages are dropped.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogSink = (level: LogLevel, scope: string, message: string, data?: unknown) => void;

let sink: LogSink = () => {};

export function setLogSink(next: LogSink): void {
  sink = next;
}

export interface Logger {
  debug(message: string, data?: unknown): void;
  info(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
  error(message: string, data?: unknown): void;
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, data) => sink('debug', scope, message, data),
    info: (message, data) => sink('info', scope, message, data),
    warn: (message, data) => sink('warn', scope, message, data),
    error: (message, data) => sink('error', scope, message, data),
  };
}
