/**
 * App-wide LogTape logger.
 * Initialized on first import via hooks.server.ts.
 *
 * Sinks:
 *   - console: getPrettyFormatter (dev readability)
 *   - file: getJsonLinesFormatter({ properties: "flatten" }) → ./data/logs/woss.io.log (rotating)
 *   - otel: OpenTelemetry LoggerProvider registered by instrumentation.server.ts
 *
 * Use:
 *   import { CAT, createLogger } from '$lib/server/logger';
 *   const log = createLogger(CAT.app);
 *   log.debug`Hello ${name}`;
 *   log.error`Failed: ${err}`;
 */

import {
  configure,
  getConsoleSink,
  getLogger,
  getJsonLinesFormatter,
  type Logger,
  type LogRecord,
  type Sink,
} from '@logtape/logtape';
import { getRotatingFileSink } from '@logtape/file';
import { getPrettyFormatter } from '@logtape/pretty';
import { context, trace } from '@opentelemetry/api';
import { logs, SeverityNumber, type LogAttributes, type AnyValue } from '@opentelemetry/api-logs';
import { dev } from '$app/environment';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { traceStorage } from './trace-context';
import { truncateLogMessage } from './log-truncate';
import { hexIdToLow64Decimal, isZeroLow64Decimal } from './datadog-ids';

const OTEL_SEVERITY_MAP: Record<string, SeverityNumber> = {
  trace: SeverityNumber.TRACE,
  debug: SeverityNumber.DEBUG,
  info: SeverityNumber.INFO,
  warning: SeverityNumber.WARN,
  error: SeverityNumber.ERROR,
  fatal: SeverityNumber.FATAL,
};

function formatLogtapeMessage(parts: readonly (string | unknown)[]): string {
  let msg = '';
  for (let i = 0; i < parts.length; i += 2) {
    msg += parts[i];
    if (i + 1 < parts.length) msg += String(parts[i + 1] ?? '');
  }
  return msg;
}

function toOtelAttribute(value: unknown): AnyValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) {
    return { type: value.name, message: value.message, ...(value.stack ? { stack: value.stack } : {}) };
  }
  if (value instanceof Uint8Array) return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function getOpenTelemetryLogSink(): Sink {
  return (record: LogRecord) => {
    const message = truncateLogMessage(formatLogtapeMessage(record.message));
    const activeContext = context.active();
    const activeSpanContext = trace.getSpan(activeContext)?.spanContext();
    const hasValidActiveSpan =
      activeSpanContext !== undefined &&
      activeSpanContext.traceId !== '00000000000000000000000000000000' &&
      activeSpanContext.spanId !== '0000000000000000';
    const attributes: LogAttributes = { 'logtape.category': record.category.join('.') };
    const properties = record.properties as Record<string, unknown>;
    for (const [key, value] of Object.entries(properties)) {
      const attribute = toOtelAttribute(value);
      if (attribute !== undefined) attributes[key] = attribute;
    }

    const { traceId, spanId } = properties as Record<string, string | undefined>;
    if (!hasValidActiveSpan && traceId && spanId) {
      const ddTraceId = hexIdToLow64Decimal(traceId);
      const ddSpanId = hexIdToLow64Decimal(spanId);
      if (!isZeroLow64Decimal(ddTraceId) && !isZeroLow64Decimal(ddSpanId)) {
        attributes['dd.trace_id'] = ddTraceId;
        attributes['dd.span_id'] = ddSpanId;
      }
    }

    logs.getLogger(record.category.join('.')).emit({
      body: message,
      severityNumber: OTEL_SEVERITY_MAP[record.level] ?? SeverityNumber.UNSPECIFIED,
      severityText: record.level.toUpperCase(),
      attributes,
      context: activeContext,
    });
  };
}

/** Categories used across the app — add new ones here. */
export const CAT = {
  app: ['woss', 'app'] as [string, string],
  db: ['woss', 'db'] as [string, string],
  api: ['woss', 'api'] as [string, string],
  llm: ['woss', 'llm'] as [string, string],
  mcp: ['woss', 'mcp'] as [string, string],
  chat: ['woss', 'chat'] as [string, string],
  content: ['woss', 'content'] as [string, string],
  search: ['woss', 'search'] as [string, string],
  hooks: ['woss', 'hooks'] as [string, string],
  rateLimit: ['woss', 'rate-limit'] as [string, string],
  startup: ['woss', 'startup'] as [string, string],
} as const;

type Category = string[] & { readonly 0: string; readonly 1: string };

const INIT_KEY = '__woss_log_initialized';

/**
 * Initialize LogTape sinks + loggers.
 * Called once from hooks.server.ts on first request.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function initLogger(logLevel: 'trace' | 'debug' | 'info' | 'warning' | 'error' = 'info'): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  const currentInitialization = g[INIT_KEY];
  if (currentInitialization === true) return;
  if (currentInitialization instanceof Promise) {
    await currentInitialization;
    return;
  }

  const initialization = (async () => {
    // Ensure log directory exists
    const logDir = join(process.cwd(), 'data', 'logs');
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }

    const logFile = join(logDir, 'woss.io.log');

    const sinks: Record<string, Sink> = {
      ...(dev && {
        console: getConsoleSink({
          formatter: getPrettyFormatter({ timestamp: 'time', inspectOptions: { colors: true }, wordWrap: 400 }),
        }),
      }),
      file: getRotatingFileSink(logFile, {
        formatter: getJsonLinesFormatter({ properties: 'flatten' }),
        bufferSize: 0,
        flushInterval: 0,
        nonBlocking: true,
        maxFiles: 70,
        maxSize: 10 * 1024 * 1024, // 10 MB per file
      }),
      otel: getOpenTelemetryLogSink(),
    };

    await configure({
      sinks,
      contextLocalStorage: traceStorage,
      loggers: [
        {
          category: ['woss'],
          lowestLevel: logLevel,
          sinks: [...(dev ? ['console'] : []), 'file', 'otel'],
        },
        {
          category: ['logtape', 'meta'],
          lowestLevel: 'warning',
          sinks: [...(dev ? ['console'] : []), 'file', 'otel'],
        },
      ],
    });
  })();

  g[INIT_KEY] = initialization;
  try {
    await initialization;
  } catch (error) {
    if (g[INIT_KEY] === initialization) delete g[INIT_KEY];
    throw error;
  }
  g[INIT_KEY] = true;
}

/**
 * Create a category-scoped logger.
 *
 * Usage:
 *   const log = logger(CAT.db);
 *   log.debug`Query took ${duration}ms`;
 */
export function createLogger(category: Category): Logger {
  return getLogger(category);
}

// Re-export getLogger for direct use
export { getLogger };
