/**
 * App-wide LogTape logger.
 * Initialized on first import via hooks.server.ts.
 *
 * Sinks:
 *   - console: getPrettyFormatter (dev readability)
 *   - file: getJsonLinesFormatter({ properties: "flatten" }) → ./data/logs/woss.io.log (rotating)
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
import { env } from 'node:process';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { traceStorage } from './trace-context';

// Level mapping: LogTape → ZinaLog
const ZINA_LEVEL_MAP: Record<string, string> = {
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warning: 'warning',
  error: 'error',
  fatal: 'error',
};

function formatLogtapeMessage(parts: readonly (string | unknown)[]): string {
  let msg = '';
  for (let i = 0; i < parts.length; i += 2) {
    msg += parts[i];
    if (i + 1 < parts.length) msg += String(parts[i + 1] ?? '');
  }
  return msg;
}

function getZinaLogSink(url: string, apiKey: string): Sink {
  const ingestUrl = `${url.replace(/\/$/, '')}/api/logs`;
  return (record: LogRecord) => {
    const level = ZINA_LEVEL_MAP[record.level] ?? 'info';
    const message = formatLogtapeMessage(record.message);
    const service = record.category.join('.');
    const body: Record<string, unknown> = { level, message, service };
    // Attach trace context to metadata
    const { traceId, spanId } = record.properties as Record<string, string | undefined>;
    if (traceId || spanId) {
      const metadata: Record<string, string> = {};
      if (traceId) metadata.traceId = traceId;
      if (spanId) metadata.spanId = spanId;
      body.metadata = metadata;
    }
    const bodyStr = JSON.stringify(body);
    // Fire-and-forget POST — non-blocking
    fetch(ingestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: bodyStr,
    }).catch((err: unknown) => {
      // fallback: can't use logger here (circular), use console as last resort
      console.error('[zinalog] push failed:', (err as Error)?.message ?? err);
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

  // ZinaLog sink (if configured)
  const zinalogUrl = env.ZINALOG_URL;
  const zinalogApiKey = env.ZINALOG_API_KEY;

  const sinks: Record<string, Sink> = {
    console: getConsoleSink({ formatter: getPrettyFormatter({ timestamp: 'time', inspectOptions: { colors: true } }) }),
    file: getRotatingFileSink(logFile, {
      formatter: getJsonLinesFormatter({ properties: 'flatten' }),
      bufferSize: 0,
      flushInterval: 0,
      nonBlocking: true,
      maxFiles: 7,
      maxSize: 10 * 1024 * 1024, // 10 MB per file
    }),
  };

  const extraSinks: string[] = [];

  if (zinalogUrl && zinalogApiKey) {
    sinks.zinalog = getZinaLogSink(zinalogUrl, zinalogApiKey);
    extraSinks.push('zinalog');
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

// Re-export getLogger for direct use
export { getLogger };
