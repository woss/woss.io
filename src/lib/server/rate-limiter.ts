import { getDb } from './db.ts';
import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.rateLimit);

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 10;
const CLEANUP_INTERVAL_MS = 300_000;

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - WINDOW_MS;
    try {
      const db = getDb();
      db.prepare('DELETE FROM rate_limits WHERE timestamp < ?').run(cutoff);
    } catch (cleanupErr) {
      log.debug('Rate limit cleanup failed (db may not be available)', {
        error: cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
      });
    }
  }, CLEANUP_INTERVAL_MS);
  if (typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

export function checkRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  if (!ip || typeof ip !== 'string') {
    return { allowed: false, remaining: 0, resetAt: Date.now() + WINDOW_MS };
  }

  startCleanup();

  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  try {
    const db = getDb();

    // Count recent requests from this IP
    const row = db
      .prepare('SELECT COUNT(*) AS count FROM rate_limits WHERE ip = ? AND timestamp > ?')
      .get(ip, windowStart) as { count: number };

    if (row.count >= MAX_REQUESTS) {
      log.warn('Rate limit exceeded', { ip, ttl: WINDOW_MS });
      // Find oldest timestamp in window for calculating reset
      const oldest = db
        .prepare('SELECT timestamp FROM rate_limits WHERE ip = ? AND timestamp > ? ORDER BY timestamp ASC LIMIT 1')
        .get(ip, windowStart) as { timestamp: number } | undefined;
      return { allowed: false, remaining: 0, resetAt: (oldest?.timestamp ?? now) + WINDOW_MS };
    }

    // Record this hit
    db.prepare('INSERT INTO rate_limits (ip, timestamp) VALUES (?, ?)').run(ip, now);

    const remaining = MAX_REQUESTS - row.count - 1;
    log.debug('Rate limit check', { ip, remaining, ttl: WINDOW_MS });
    return { allowed: true, remaining, resetAt: now + WINDOW_MS };
  } catch (dbErr) {
    log.warn('Rate limit DB check failed — failing open', {
      error: dbErr instanceof Error ? dbErr.message : String(dbErr),
    });
    return { allowed: false, remaining: 0, resetAt: now + WINDOW_MS };
  }
}
