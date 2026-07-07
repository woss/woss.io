import type { RequestEvent } from '@sveltejs/kit';
import { callWebhook } from '$lib/server/webhooks';
import { checkRateLimit } from '$lib/server/rate-limiter';
import { lookupCountry } from '$lib/server/geo';
import { CAT, createLogger } from '$lib/server/logger';
import { db } from '$lib/server/db';

const log = createLogger(CAT.chat);

function getClientIP(event: RequestEvent): string {
  return event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? event.getClientAddress();
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
} as const;

// POST /api/messages/[messageId]/report — report a message
export async function POST(event: RequestEvent): Promise<Response> {
  const ip = getClientIP(event);
  const rateCheck = await checkRateLimit(ip);
  if (!rateCheck.allowed) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(Math.ceil((rateCheck.resetAt - Date.now()) / 1000)),
      },
    });
  }

  const messageId = event.params.messageId;

  if (!messageId) {
    return new Response(JSON.stringify({ error: 'Invalid messageId' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  try {
    const body = (await event.request.json()) as { userId: string; reason: string };

    if (!body.userId) {
      return new Response(JSON.stringify({ error: 'userId required' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    if (!body.reason || typeof body.reason !== 'string' || !body.reason.trim()) {
      return new Response(JSON.stringify({ error: 'reason is required' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    await db.reactions.setReaction(messageId, body.userId, 'down', body.reason);
    await db.messages.softDeleteMessage(messageId);

    const ua = event.request.headers.get('user-agent') ?? 'unknown';
    const ip = getClientIP(event);
    const country = lookupCountry(ip);
    callWebhook({
      type: 'reportMessage',
      messageId,
      reason: body.reason.trim(),
      userAgent: ua,
      country: country ?? undefined,
    }).catch(() => {});

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err) {
    log.error`Failed to report message: ${err}`;
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
}
