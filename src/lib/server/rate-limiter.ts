import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.rateLimit);

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;

/**
 * Per-IP rate limit store — in-memory Map of timestamps.
 * Rate limit data is ephemeral (per-minute window), so there is no benefit
 * to persisting it in a database. Using an in-memory store eliminates the
 * SurrealDB dependency and avoids noisy "cleanup failed" logs when SurrealDB
 * is not running (e.g. dev/test environments).
 */
const hits = new Map<string, number[]>();

function trimWindow(ip: string, now: number): number[] {
  const cutoff = now - WINDOW_MS;
  const timestamps = (hits.get(ip) ?? []).filter((t) => t > cutoff);
  if (timestamps.length === 0) {
    hits.delete(ip);
  } else {
    hits.set(ip, timestamps);
  }
  return timestamps;
}

export async function checkRateLimit(ip: string): Promise<{
  allowed: boolean;
  remaining: number;
  resetAt: number;
}> {
  if (!ip || typeof ip !== 'string') {
    return { allowed: false, remaining: 0, resetAt: Date.now() + WINDOW_MS };
  }

  const now = Date.now();
  const timestamps = trimWindow(ip, now);
  const oldest = timestamps[0] ?? now;

  if (timestamps.length >= MAX_REQUESTS) {
    log.warn('Rate limit exceeded', { ip, count: timestamps.length });
    return { allowed: false, remaining: 0, resetAt: oldest + WINDOW_MS };
  }

  timestamps.push(now);
  hits.set(ip, timestamps);

  const remaining = MAX_REQUESTS - timestamps.length;
  log.debug('Rate limit check', { ip, remaining });
  return { allowed: true, remaining, resetAt: oldest + WINDOW_MS };
}
