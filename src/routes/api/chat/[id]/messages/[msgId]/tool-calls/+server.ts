import type { RequestEvent } from '@sveltejs/kit';
import { getToolCallsByMessageId } from '$lib/server/db';
import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.chat);

// GET /api/chat/[id]/messages/[msgId]/tool-calls — get tool calls for a message
export async function GET(event: RequestEvent): Promise<Response> {
  const msgId = event.params.msgId;

  if (!msgId) {
    return new Response(JSON.stringify({ error: 'messageId required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const toolCalls = getToolCallsByMessageId(msgId);
    return new Response(JSON.stringify({ toolCalls }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    log.warn`Failed to get tool calls for message ${msgId}: ${e}`;
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
