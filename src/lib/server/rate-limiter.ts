const WINDOW_MS = 60_000;
const MAX_REQUESTS = 100;

/** Sliding-window timestamps per IP (in-memory). Resets on server restart. */
const requests = new Map<string, number[]>();

export function checkRateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  if (!ip || typeof ip !== 'string') {
    return { allowed: false, remaining: 0, resetAt: Date.now() + WINDOW_MS };
  }

  const now = Date.now();
  const timestamps = requests.get(ip) ?? [];
  const recent = timestamps.filter((t) => t > now - WINDOW_MS);

  if (recent.length >= MAX_REQUESTS) {
    const oldest = recent[0];
    return { allowed: false, remaining: 0, resetAt: oldest + WINDOW_MS };
  }

  recent.push(now);
  requests.set(ip, recent);

  return { allowed: true, remaining: MAX_REQUESTS - recent.length, resetAt: recent[0] + WINDOW_MS };
}
