/**
 * App-wide LogTape logger.
 * Initialized on first import via hooks.server.ts.
 *
 * Sinks:
 *   - console: getPrettyFormatter (dev readability)
 *   - file: getJsonLinesFormatter({ properties: "flatten" }) → ./data/logs/woss.io.log (rotating)
 *   - datadog: conditional DD log ingestion (when DD_API_KEY set)
 *
 * Use:
 *   import { CAT, createLogger } from '$lib/server/logger';
 *   const log = createLogger(CAT.app);
 *   log.debug`Hello ${name}`;
 *   log.error`Failed: ${err}`;
 */

import { configure, getConsoleSink, getLogger, getJsonLinesFormatter, type Logger, type Sink } from '@logtape/logtape';
import { getRotatingFileSink } from '@logtape/file';
import { getPrettyFormatter } from '@logtape/pretty';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { createDatadogSink } from './datadog-sink';
import { traceStorage } from './trace-context';

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
  if (g[INIT_KEY]) return;
  g[INIT_KEY] = true;

  // Ensure log directory exists
  const logDir = join(process.cwd(), 'data', 'logs');
  if (!existsSync(logDir)) {
    mkdirSync(logDir, { recursive: true });
  }

  const logFile = join(logDir, 'woss.io.log');

  const sinks: Record<string, Sink> = {
    console: getConsoleSink({
      formatter: getPrettyFormatter({ timestamp: 'time', inspectOptions: { colors: true }, wordWrap: 400 }),
    }),
    file: getRotatingFileSink(logFile, {
      formatter: getJsonLinesFormatter({ properties: 'flatten' }),
      bufferSize: 0,
      flushInterval: 0,
      nonBlocking: true,
      maxFiles: 70,
      maxSize: 10 * 1024 * 1024, // 10 MB per file
    }),
  };

  const extraSinks: string[] = [];

  const datadogSink = createDatadogSink();
  if (datadogSink) {
    sinks.datadog = datadogSink;
    extraSinks.push('datadog');
  }

  await configure({
    sinks,
    contextLocalStorage: traceStorage,
    loggers: [
      {
        category: ['woss'],
        lowestLevel: logLevel,
        sinks: ['console', 'file', ...extraSinks],
      },
      {
        category: ['logtape', 'meta'],
        lowestLevel: 'warning',
        sinks: ['console', 'file', ...extraSinks],
      },
    ],
  });
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
