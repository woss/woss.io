import type { RequestEvent } from '@sveltejs/kit';
import { setReaction, deleteReaction, getReaction } from '$lib/server/db';
import { CAT, createLogger } from '$lib/server/logger';
import { callWebhook } from '$lib/server/webhooks';
import { lookupCountry } from '$lib/server/geo';

const log = createLogger(CAT.chat);

function getClientIP(event: RequestEvent): string {
  return event.request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? event.getClientAddress();
}

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
} as const;

function getUserId(event: RequestEvent): string | null {
  return event.request.headers.get('x-user-id') ?? event.url.searchParams.get('userId');
}

// GET /api/messages/[messageId]/reaction?userId=xxx — get existing reaction
export async function GET(event: RequestEvent): Promise<Response> {
  const messageId = event.params.messageId;
  const userId = getUserId(event);

  if (!messageId) {
    return new Response(JSON.stringify({ error: 'Invalid messageId' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  if (!userId) {
    return new Response(JSON.stringify({ error: 'userId required' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  try {
    const reaction = getReaction(messageId, userId);
    return new Response(JSON.stringify({ reaction }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err) {
    log.error`Failed to get reaction: ${err}`;
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
}

// POST /api/messages/[messageId]/reaction — set or update a reaction
export async function POST(event: RequestEvent): Promise<Response> {
  const messageId = event.params.messageId;

  if (!messageId) {
    return new Response(JSON.stringify({ error: 'Invalid messageId' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  try {
    const body = (await event.request.json()) as {
      userId: string;
      reactionType: 'up' | 'down' | 'heart';
      reason?: string;
    };

    if (!body.userId) {
      return new Response(JSON.stringify({ error: 'userId required' }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    if (body.reactionType !== 'up' && body.reactionType !== 'down' && body.reactionType !== 'heart') {
      return new Response(JSON.stringify({ error: "reactionType must be 'up', 'down', or 'heart'" }), {
        status: 400,
        headers: JSON_HEADERS,
      });
    }

    setReaction(messageId, body.userId, body.reactionType, body.reason);

    const ua = event.request.headers.get('user-agent') ?? 'unknown';
    const ip = getClientIP(event);
    const country = lookupCountry(ip);
    const webhookType =
      body.reactionType === 'up'
        ? ('messageUpvote' as const)
        : body.reactionType === 'heart'
          ? ('messageHeart' as const)
          : ('messageDownvote' as const);
    callWebhook({
      type: webhookType,
      messageId,
      reason: body.reason?.trim(),
      userAgent: ua,
      country: country ?? undefined,
    }).catch(() => {});

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err) {
    log.error`Failed to save reaction: ${err}`;
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
}

// DELETE /api/messages/[messageId]/reaction — remove a reaction
export async function DELETE(event: RequestEvent): Promise<Response> {
  const messageId = event.params.messageId;
  const userId = getUserId(event);

  if (!messageId) {
    return new Response(JSON.stringify({ error: 'Invalid messageId' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  if (!userId) {
    return new Response(JSON.stringify({ error: 'userId required' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  try {
    deleteReaction(messageId, userId);

    const ua = event.request.headers.get('user-agent') ?? 'unknown';
    const ip = getClientIP(event);
    const country = lookupCountry(ip);
    callWebhook({
      type: 'reactionRemoved',
      messageId,
      reason: 'Reaction removed',
      userAgent: ua,
      country: country ?? undefined,
    }).catch(() => {});

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err) {
    log.error`Failed to delete reaction: ${err}`;
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
}
