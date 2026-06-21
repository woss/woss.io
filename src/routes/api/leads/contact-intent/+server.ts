import { insertContactIntent } from '$lib/server/db';
import { checkRateLimit } from '$lib/server/rate-limiter';
import type { RequestEvent } from '@sveltejs/kit';
import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.api);

// Lead-specific rate limiter (10/hour/IP — higher since it's just logging intent, not submitting)
const INTENT_WINDOW_MS = 3600_000;
const INTENT_MAX = 10;
const intentHits = new Map<string, number[]>();

function checkIntentRateLimit(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
  if (!ip) return { allowed: false, remaining: 0, resetAt: Date.now() + INTENT_WINDOW_MS };
  const now = Date.now();
  const windowStart = now - INTENT_WINDOW_MS;
  const prev = intentHits.get(ip) ?? [];
  const windowed = prev.filter((t) => t > windowStart);
  if (windowed.length >= INTENT_MAX) {
    const oldest = windowed[windowed.length - 1];
    return { allowed: false, remaining: 0, resetAt: oldest + INTENT_WINDOW_MS };
  }
  windowed.push(now);
  intentHits.set(ip, windowed);
  return { allowed: true, remaining: INTENT_MAX - windowed.length, resetAt: now + INTENT_WINDOW_MS };
}

function getClientIP(event: RequestEvent): string {
  return event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? event.getClientAddress();
}

export async function POST(event: RequestEvent): Promise<Response> {
  // Origin check (CSRF protection)
  const origin = event.request.headers.get('origin') ?? '';
  const referer = event.request.headers.get('referer') ?? '';
  const allowedHosts = ['localhost:5173', 'localhost:4173', 'woss.io', 'www.woss.io'];
  const hasValidOrigin = allowedHosts.some((h) => origin.includes(h) || referer.includes(h));
  if (!hasValidOrigin) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { userId?: string; chatId?: string };
  try {
    body = await event.request.json();
  } catch (e) {
    log.warn`Failed to parse contact-intent request body: ${e}`;
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = String(body.userId ?? '');
  const chatId = String(body.chatId ?? '');

  if (!userId || !chatId) {
    return new Response(JSON.stringify({ error: 'userId and chatId are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Rate limiting
  const ip = getClientIP(event);
  const rl = checkIntentRateLimit(ip);
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: 'Too many requests. Please slow down.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const generalRl = checkRateLimit(ip);
  if (!generalRl.allowed) {
    return new Response(JSON.stringify({ error: 'Too many requests. Please slow down.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    insertContactIntent(userId, chatId, '/contact');
  } catch (e) {
    log.error`Failed to log contact intent: ${e}`;
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
