import { getChatEventsSince, isChatLocked } from '$lib/server/db';
import { subscribe } from '$lib/server/chat-events';
import type { RequestEvent } from '@sveltejs/kit';
import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.chat);

/** Write an SSE frame to the response stream. */
function writeSSE(controller: ReadableStreamDefaultController, event: string, data: unknown, id?: number): void {
  let frame = '';
  if (event) frame += `event: ${event}\n`;
  if (id !== undefined) frame += `id: ${id}\n`;
  frame += `data: ${JSON.stringify(data !== undefined ? data : null)}\n\n`;
  controller.enqueue(new TextEncoder().encode(frame));
}

export async function GET(event: RequestEvent): Promise<Response> {
  const chatId = event.params.id;

  if (!chatId) {
    return new Response(JSON.stringify({ error: 'Chat ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse Last-Event-ID header (sent by EventSource on reconnect)
  const lastEventIdHeader = event.request.headers.get('Last-Event-ID');
  const lastEventId = lastEventIdHeader ? parseInt(lastEventIdHeader, 10) || 0 : 0;

  const stream = new ReadableStream({
    start(controller) {
      // Replay persisted events since lastEventId
      try {
        const events = getChatEventsSince(chatId, lastEventId).filter((evt) => {
          // Don't replay irrecoverable errors if chat is no longer locked
          if (
            evt.type === 'error' &&
            typeof evt.data === 'object' &&
            evt.data !== null &&
            'irrecoverable' in evt.data &&
            evt.data.irrecoverable === true
          ) {
            if (!isChatLocked(chatId)) return false;
          }
          return true;
        });
        for (const evt of events) {
          writeSSE(controller, evt.type, evt.data, evt.id);
        }
      } catch (err) {
        log.error`Failed to replay events: ${err}`;
        writeSSE(controller, 'error', { message: 'Failed to load events' });
        controller.close();
        return;
      }

      // Subscribe to live events
      const unsub = subscribe(chatId, (evt) => {
        try {
          if (evt.id > 0) {
            // Persisted event — include event id for reconnect tracking
            writeSSE(controller, evt.type, evt.data, evt.id);
          } else {
            // Live event (token, status) — no id
            writeSSE(controller, evt.type, evt.data);
          }
        } catch (e) {
          log.warn`SSE write failed, unsubscribing from chat ${chatId}: ${e}`;
          // Stream closed, unsubscribe
          unsub();
        }
      });

      // Cleanup on client disconnect
      event.request.signal.addEventListener(
        'abort',
        () => {
          unsub();
        },
        { once: true },
      );
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
