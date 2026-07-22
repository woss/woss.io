import { db } from '$lib/server/db';
import { subscribe, type ChatEventPayload } from '$lib/server/chat-events';
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
      // Subscribe FIRST — buffer events that arrive during DB replay
      const buffer: ChatEventPayload[] = [];
      let replayDone = false;

      const unsub = subscribe(chatId, (evt) => {
        if (!replayDone) {
          // During replay phase — buffer events
          buffer.push(evt);
          return;
        }
        try {
          if (evt.id > 0) {
            writeSSE(controller, evt.type, evt.data, evt.id);
          } else {
            writeSSE(controller, evt.type, evt.data);
          }
        } catch (e) {
          log.warn`SSE write failed, unsubscribing from chat ${chatId}: ${e}`;
          unsub();
        }
      });

      // Replay persisted events since lastEventId, then flush buffer
      (async () => {
        try {
          const events = await db.events.getChatEventsSince(chatId, lastEventId);
          const filtered: Array<(typeof events)[number]> = [];
          for (const evt of events) {
            if (
              evt.type === 'error' &&
              typeof evt.data === 'object' &&
              evt.data !== null &&
              'irrecoverable' in evt.data &&
              evt.data.irrecoverable === true
            ) {
              if (!(await db.chats.isChatLocked(chatId))) continue;
            }
            filtered.push(evt);
          }

          // Mark replay as done BEFORE flushing buffer
          replayDone = true;

          // Flush DB events
          for (const evt of filtered) {
            writeSSE(controller, evt.type, evt.data, evt.id);
          }

          // Flush buffered live events with dedup by event ID
          const seenIds = new Set(filtered.map((e) => e.id).filter((id) => id > 0));
          for (const evt of buffer) {
            if (evt.id > 0 && seenIds.has(evt.id)) continue;
            try {
              if (evt.id > 0) {
                writeSSE(controller, evt.type, evt.data, evt.id);
              } else {
                writeSSE(controller, evt.type, evt.data);
              }
            } catch (e) {
              log.warn`SSE write failed during buffer flush: ${e}`;
              break;
            }
          }
        } catch (err) {
          log.error`Failed to replay events: ${err}`;
          writeSSE(controller, 'error', { message: 'Failed to load events' });
          controller.close();
          return;
        }

        // Cleanup on client disconnect
        event.request.signal.addEventListener(
          'abort',
          () => {
            unsub();
          },
          { once: true },
        );
      })();
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
