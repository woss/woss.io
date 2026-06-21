import type { RequestEvent } from '@sveltejs/kit';
import { insertLead, updateUserContact } from '$lib/server/db';
import { lookupCountry } from '$lib/server/geo';
import { checkRateLimit } from '$lib/server/rate-limiter';
import { callWebhook } from '$lib/server/webhooks';
import { CAT, createLogger } from '$lib/server/logger';
import { sanitizeText } from '$lib/server/sanitize';

const log = createLogger(CAT.api);

// Lead-specific rate limiter (3/hour/IP)
const LEAD_WINDOW_MS = 3600_000;
const LEAD_MAX = 3;
const leadHits = new Map<string, number[]>();

function checkLeadRateLimit(ip: string): { allowed: boolean; remaining: number; resetAt: number } {
  if (!ip) return { allowed: false, remaining: 0, resetAt: Date.now() + LEAD_WINDOW_MS };
  const now = Date.now();
  const windowStart = now - LEAD_WINDOW_MS;
  const prev = leadHits.get(ip) ?? [];
  const windowed = prev.filter((t) => t > windowStart);
  if (windowed.length >= LEAD_MAX) {
    const oldest = windowed[windowed.length - 1];
    return { allowed: false, remaining: 0, resetAt: oldest + LEAD_WINDOW_MS };
  }
  windowed.push(now);
  leadHits.set(ip, windowed);
  return { allowed: true, remaining: LEAD_MAX - windowed.length, resetAt: now + LEAD_WINDOW_MS };
}

function getClientIP(event: RequestEvent): string {
  return event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? event.getClientAddress();
}

export async function POST(event: RequestEvent): Promise<Response> {
  // Reject requests without a valid Origin or Referer (CSRF protection)
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

  let body: Record<string, unknown>;
  try {
    body = await event.request.json();
  } catch (e) {
    log.warn`Failed to parse lead request body: ${e}`;
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userId = String(body.userId ?? '');
  const name = String(body.name ?? '');
  const email = String(body.email ?? '');
  const companyName = String(body.companyName ?? '');
  const role = String(body.role ?? '');
  const message = String(body.message ?? '');

  if (!userId) {
    return new Response(JSON.stringify({ error: 'userId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!name) {
    return new Response(JSON.stringify({ error: 'Name is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!email) {
    return new Response(JSON.stringify({ error: 'Email is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const sanitizedName = sanitizeText(name).slice(0, 100);
  const sanitizedEmail = sanitizeText(email).slice(0, 200);
  const sanitizedCompany = companyName ? sanitizeText(companyName).slice(0, 200) : '';
  const sanitizedRole = role ? sanitizeText(role).slice(0, 200) : '';
  const sanitizedMessage = message ? sanitizeText(message).slice(0, 1000) : '';

  if (!sanitizedName) {
    return new Response(JSON.stringify({ error: 'Name cannot be empty' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!sanitizedEmail) {
    return new Response(JSON.stringify({ error: 'Email cannot be empty' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(sanitizedEmail)) {
    return new Response(JSON.stringify({ error: 'Invalid email format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ip = getClientIP(event);
  const rl = checkLeadRateLimit(ip);
  if (!rl.allowed) {
    return new Response(JSON.stringify({ error: 'Too many submissions. Please try again later.' }), {
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
    updateUserContact(userId, sanitizedName, sanitizedEmail);
    insertLead(userId, sanitizedName, sanitizedEmail, sanitizedCompany, sanitizedRole, sanitizedMessage, ip);
    const ua = event.request.headers.get('user-agent') ?? 'unknown';
    const country = lookupCountry(ip);
    callWebhook({
      type: 'contactSubmitted',
      reason: `Name: ${sanitizedName}, Email: ${sanitizedEmail}${sanitizedCompany ? `, Company: ${sanitizedCompany}` : ''}${sanitizedRole ? `, Role: ${sanitizedRole}` : ''}${sanitizedMessage ? `, Message: ${sanitizedMessage}` : ''}`,
      userAgent: ua,
      country: country ?? undefined,
    }).catch(() => {});
  } catch (e) {
    log.error`Failed to save lead: ${e}`;
    return new Response(JSON.stringify({ error: 'Failed to save your request. Please try again.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
