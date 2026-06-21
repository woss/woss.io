import type { LogRecord, Sink } from '@logtape/logtape';
import { env } from 'node:process';

interface DatadogLogPayload {
  ddsource: string;
  ddtags: string;
  hostname: string;
  service: string;
  message: string;
  status: 'emergency' | 'alert' | 'critical' | 'error' | 'warning' | 'notice' | 'info' | 'debug';
  level: string;
  category: string;
  logger: {
    name: string;
    version: string;
  };
  dd?: {
    trace_id?: string;
    span_id?: string;
  };
  [key: string]: unknown;
}

function formatMessage(parts: readonly (string | unknown)[]): string {
  let msg = '';
  for (let i = 0; i < parts.length; i += 2) {
    msg += parts[i];
    if (i + 1 < parts.length) msg += String(parts[i + 1] ?? '');
  }
  return msg;
}

const LEVEL_MAP: Record<string, DatadogLogPayload['status']> = {
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warning: 'warning',
  error: 'error',
  fatal: 'critical',
};

const LOGTAPE_TO_DD_LEVEL: Record<string, string> = {
  trace: 'debug',
  debug: 'debug',
  info: 'info',
  warning: 'warn',
  error: 'error',
  fatal: 'fatal',
};

export function getDatadogSite(): string {
  return env.DD_SITE ?? 'datadoghq.eu';
}

export function getDatadogApiKey(): string | undefined {
  return env.DD_API_KEY;
}

export function createDatadogSink(): Sink | null {
  const apiKey = getDatadogApiKey();
  if (!apiKey) return null;

  const site = getDatadogSite();
  const intakeUrl = `https://http-intake.logs.${site}/api/v2/logs`;
  const service = env.DD_SERVICE ?? 'woss-io';
  const hostname = env.HOSTNAME ?? env.DD_HOSTNAME ?? 'unknown';
  const tags = env.DD_TAGS ?? '';
  const source = env.DD_SOURCE ?? 'nodejs';

  let batch: DatadogLogPayload[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const FLUSH_INTERVAL = 5000;
  const MAX_BATCH_SIZE = 100;

  function flush() {
    if (batch.length === 0) return;
    const key = apiKey;
    if (!key) return;
    const payload = batch;
    batch = [];
    flushTimer = null;

    const body = JSON.stringify(payload);
    fetch(intakeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'DD-API-KEY': key,
      },
      body,
    }).catch((err: unknown) => {
      console.error('[datadog-sink] push failed:', (err as Error)?.message ?? err);
    });
  }

  function scheduleFlush() {
    if (flushTimer === null) {
      flushTimer = setTimeout(flush, FLUSH_INTERVAL);
    }
  }

  return (record: LogRecord) => {
    const message = formatMessage(record.message);
    const level = record.level;
    const status = LEVEL_MAP[level] ?? 'info';
    const logLevel = LOGTAPE_TO_DD_LEVEL[level] ?? 'info';
    const category = record.category.join('.');
    const props = record.properties as Record<string, unknown> | undefined;

    const payload: DatadogLogPayload = {
      ddsource: source,
      ddtags: tags,
      hostname,
      service,
      message,
      status,
      level: logLevel,
      category,
      logger: {
        name: category,
        version: '1.0',
      },
    };

    if (props) {
      const ddTraceId = props['dd.trace_id'] ?? props.traceId;
      const ddSpanId = props['dd.span_id'] ?? props.spanId;
      if (typeof ddTraceId === 'string' || typeof ddTraceId === 'number') {
        payload.dd = { ...payload.dd, trace_id: String(ddTraceId) };
      }
      if (typeof ddSpanId === 'string' || typeof ddSpanId === 'number') {
        payload.dd = { ...payload.dd, span_id: String(ddSpanId) };
      }
      for (const [key, val] of Object.entries(props)) {
        if (!key.startsWith('dd.') && key !== 'traceId' && key !== 'spanId' && key !== 'msgId') {
          if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
            payload[key] = val;
          }
        }
      }
    }

    batch.push(payload);

    if (level === 'error' || level === 'fatal') {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      flush();
    } else {
      scheduleFlush();
      if (batch.length >= MAX_BATCH_SIZE) {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        flush();
      }
    }
  };
}
