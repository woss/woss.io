import { config } from '$lib/server/config';
import { initLogger, CAT, createLogger } from '$lib/server/logger';
import { generateTraceId, generateSpanId, withTrace } from '$lib/server/trace-context';
import { getActiveOtelContext } from '$lib/server/trace-context';
import type { Handle } from '@sveltejs/kit';
import { dev } from '$app/environment';

import { env } from '$env/dynamic/private';

const APP_ORIGIN = config().app.origin;

let logInitialized = false;

export const handle: Handle = async ({ event, resolve }) => {
  // Init logger on first request
  if (!logInitialized) {
    logInitialized = true;
    const VALID_LOG_LEVELS = ['trace', 'debug', 'info', 'warning', 'error'] as const;
    type LogLevel = (typeof VALID_LOG_LEVELS)[number];
    const rawLevel = env.LOG_LEVEL;
    const logLevel: LogLevel = VALID_LOG_LEVELS.includes(rawLevel as LogLevel) ? (rawLevel as LogLevel) : 'info';
    await initLogger(logLevel);
    const log = createLogger(CAT.hooks);
    log.info(`Logger initialized. App origin: ${APP_ORIGIN}`);
  }

  const log = createLogger(CAT.hooks);

  // Only check /api/* routes in production
  if (!dev && event.url.pathname.startsWith('/api/')) {
    const origin = event.request.headers.get('origin');
    const referer = event.request.headers.get('referer');

    if (origin && origin !== APP_ORIGIN) {
      log.warn(`Blocked request from invalid origin: ${origin}`);
      return new Response(JSON.stringify({ error: 'Forbidden: invalid origin' }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    }

    if (!origin && (!referer || !referer.startsWith(APP_ORIGIN))) {
      const hasProxyHeaders = event.request.headers.has('cf-ray') || event.request.headers.has('x-forwarded-for');
      const isSafeMethod = event.request.method === 'GET' || event.request.method === 'HEAD';

      if (hasProxyHeaders || isSafeMethod) {
        // Allow through — infra probes, proxy health checks
      } else {
        log.warn(`Blocked request with missing origin and no valid referer: ${referer ?? 'none'}`);
        return new Response(JSON.stringify({ error: 'Forbidden: missing origin and no valid referer' }), {
          status: 403,
          headers: { 'content-type': 'application/json' },
        });
      }
    }
  }

  // Wrap request with trace context for log correlation
  // Prefer OTel active span (from SvelteKit's experimental.tracing.server) when available
  const otelCtx = getActiveOtelContext();
  const traceId = otelCtx?.traceId ?? generateTraceId();
  const spanId = otelCtx?.spanId ?? generateSpanId();
  const response = await withTrace(traceId, spanId, () => resolve(event));
  if (response.status === 404) {
    const ip = event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? event.getClientAddress();
    log.warn`[404] ${event.request.method} ${event.url.pathname} UA=${event.request.headers.get('user-agent') ?? 'none'} IP=${ip}`;
  }
  return response;
};
