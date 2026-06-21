import type { RequestEvent } from '@sveltejs/kit';
import { getChats } from '$lib/server/db';
import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.chat);

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
} as const;

// GET /api/chat?userId=xxx — list chats for a user
export async function GET(event: RequestEvent): Promise<Response> {
  const userId = event.url.searchParams.get('userId');

  if (!userId) {
    return new Response(JSON.stringify({ error: 'userId required' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  try {
    const chats = getChats(userId);
    return new Response(JSON.stringify({ chats }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err) {
    log.error`Failed to load chats: ${err}`;
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
}
