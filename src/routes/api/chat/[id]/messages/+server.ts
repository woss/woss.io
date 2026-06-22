import type { RequestEvent } from '@sveltejs/kit';
import { getMessages, getToolCallsForMessages } from '$lib/server/db';
import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.chat);

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
} as const;

// GET /api/chat/[id]/messages — get messages for a chat
export async function GET(event: RequestEvent): Promise<Response> {
  const chatId = event.params.id;

  if (!chatId) {
    return new Response(JSON.stringify({ error: 'chatId required' }), {
      status: 400,
      headers: JSON_HEADERS,
    });
  }

  try {
    const storedMessages = getMessages(chatId, 50, 0);
    // Batch fetch tool calls for all messages
    const messageIds = storedMessages.map((m) => m.id);
    const toolCallsByMessage = getToolCallsForMessages(messageIds);
    const messages = storedMessages.map((m) => ({
      ...m,
      sources: m.sources
        ? (() => {
            try {
              return JSON.parse(m.sources);
            } catch {
              return undefined;
            }
          })()
        : undefined,
      toolCalls: toolCallsByMessage[m.id] || [],
    }));
    return new Response(JSON.stringify({ messages }), {
      status: 200,
      headers: JSON_HEADERS,
    });
  } catch (err) {
    log.error`Failed to load chat messages: ${err}`;
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
}
