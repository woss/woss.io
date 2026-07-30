import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.rateLimit);

const CAPACITY = 100;
const WINDOW_MS = 60_000;

const buckets = new Map<string, { tokens: number; lastRefill: number }>();

export function checkRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  if (!ip || typeof ip !== 'string') {
    return { allowed: false, remaining: 0, resetAt: Date.now() + WINDOW_MS };
  }

  const now = Date.now();
  const bucket = buckets.get(ip);

  if (!bucket) {
    buckets.set(ip, { tokens: CAPACITY - 1, lastRefill: now });
    log.debug('Rate limit check', { ip, remaining: CAPACITY - 1, ttl: WINDOW_MS });
    return { allowed: true, remaining: CAPACITY - 1, resetAt: now + WINDOW_MS };
  }

  const elapsed = now - bucket.lastRefill;
  const refill = elapsed * (CAPACITY / WINDOW_MS);
  bucket.tokens = Math.min(CAPACITY, bucket.tokens + refill);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    const remaining = Math.floor(bucket.tokens);
    log.debug('Rate limit check', { ip, remaining, ttl: WINDOW_MS });
    return {
      allowed: true,
      remaining,
      resetAt: now + (CAPACITY - bucket.tokens) * (WINDOW_MS / CAPACITY),
    };
  }

  log.warn('Rate limit exceeded', { ip, ttl: WINDOW_MS });
  return {
    allowed: false,
    remaining: 0,
    resetAt: now + (1 - bucket.tokens) * (WINDOW_MS / CAPACITY),
  };
}
