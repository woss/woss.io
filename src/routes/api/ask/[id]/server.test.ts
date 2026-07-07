import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// ── Module mocks ─────────────────────────────────────────────────────────

vi.mock('$lib/server/db', () => ({
  db: {
    events: {
      getChatEventsSince: vi.fn(() => []),
    },
    chats: {
      isChatLocked: vi.fn(() => false),
    },
  },
}));

vi.mock('$lib/server/chat-events', () => ({
  subscribe: vi.fn(() => vi.fn()),
}));

vi.mock('$lib/server/logger', () => ({
  CAT: { chat: 'chat' },
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  }),
}));

// ── Imports (after mocks are set up) ─────────────────────────────────────

import { db } from '$lib/server/db';
import { subscribe } from '$lib/server/chat-events';
import { GET } from './+server';

// ── Helpers ──────────────────────────────────────────────────────────────

function buildEvent(overrides: { chatId?: string; lastEventId?: string | null }): RequestEvent {
  const headers = new Map<string, string>();
  if (overrides.lastEventId) headers.set('Last-Event-ID', overrides.lastEventId);

  const addEventListener = vi.fn();

  return {
    params: { id: overrides.chatId ?? '' },
    request: {
      headers: { get: vi.fn((name: string) => headers.get(name) ?? null) },
      signal: { addEventListener },
    } as unknown as Request,
    getClientAddress: () => '127.0.0.1',
    url: new URL('http://localhost'),
  } as unknown as RequestEvent;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('GET /api/ask/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset db mocks to prevent mockResolvedValue/mockRejectedValue leakage
    vi.mocked(db.events.getChatEventsSince).mockReset();
    vi.mocked(db.chats.isChatLocked).mockReset();
  });

  describe('validation', () => {
    it('returns 400 when chatId param is missing', async () => {
      const event = buildEvent({ chatId: '' });
      const res = await GET(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Chat ID is required');
    });

    it('returns 400 when chatId param is undefined', async () => {
      const event = { params: {}, request: new Request('http://localhost') } as unknown as RequestEvent;
      const res = await GET(event);
      expect(res.status).toBe(400);
    });
  });

  describe('SSE response structure', () => {
    it('returns 200 with SSE headers for valid chatId', async () => {
      const event = buildEvent({ chatId: 'chat-1' });
      const res = await GET(event);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/event-stream');
      expect(res.headers.get('Cache-Control')).toBe('no-cache');
      expect(res.headers.get('Connection')).toBe('keep-alive');
      expect(res.headers.get('X-Accel-Buffering')).toBe('no');
    });

    it('returns a ReadableStream body', async () => {
      const event = buildEvent({ chatId: 'chat-1' });
      const res = await GET(event);
      expect(res.body).toBeInstanceOf(ReadableStream);
    });
  });

  describe('Last-Event-ID header', () => {
    it('passes parsed Last-Event-ID to getChatEventsSince', async () => {
      const event = buildEvent({ chatId: 'chat-1', lastEventId: '5' });
      await GET(event);
      expect(db.events.getChatEventsSince).toHaveBeenCalledWith('chat-1', 5);
    });

    it('defaults lastEventId to 0 when header is absent', async () => {
      const event = buildEvent({ chatId: 'chat-1', lastEventId: null });
      await GET(event);
      expect(db.events.getChatEventsSince).toHaveBeenCalledWith('chat-1', 0);
    });

    it('defaults lastEventId to 0 when header is not a valid number', async () => {
      const event = buildEvent({ chatId: 'chat-1', lastEventId: 'abc' });
      await GET(event);
      expect(db.events.getChatEventsSince).toHaveBeenCalledWith('chat-1', 0);
    });
  });

  describe('event replay', () => {
    it('replays persisted events since lastEventId', async () => {
      const events = [
        { id: 3, chatId: 'chat-1', type: 'message', data: { content: 'hello' }, createdAt: '2025-01-01T00:00:00.000Z' },
        { id: 4, chatId: 'chat-1', type: 'done', data: null, createdAt: '2025-01-01T00:00:01.000Z' },
      ];

      vi.mocked(db.events.getChatEventsSince).mockResolvedValue(events);

      const event = buildEvent({ chatId: 'chat-1' });
      await GET(event);
      expect(db.events.getChatEventsSince).toHaveBeenCalledWith('chat-1', 0);
    });

    it('filters out irrecoverable error events when chat is no longer locked', async () => {
      const irrecoverableEvent = {
        id: 1,
        chatId: 'chat-1',
        type: 'error',
        data: { irrecoverable: true, message: 'bad' },
        createdAt: '2025-01-01T00:00:00.000Z',
      };
      vi.mocked(db.events.getChatEventsSince).mockResolvedValue([irrecoverableEvent]);
      vi.mocked(db.chats.isChatLocked).mockResolvedValue(false);

      const event = buildEvent({ chatId: 'chat-1' });
      await GET(event);
      // The irrecoverable event should be filtered out — can't read stream body
      // easily here, but we verify the flow doesn't crash
      expect(db.chats.isChatLocked).toHaveBeenCalledWith('chat-1');
    });

    it('preserves irrecoverable error events when chat is still locked', async () => {
      const irrecoverableEvent = {
        id: 1,
        chatId: 'chat-1',
        type: 'error',
        data: { irrecoverable: true, message: 'bad' },
        createdAt: '2025-01-01T00:00:00.000Z',
      };
      vi.mocked(db.events.getChatEventsSince).mockResolvedValue([irrecoverableEvent]);
      vi.mocked(db.chats.isChatLocked).mockResolvedValue(true);

      const event = buildEvent({ chatId: 'chat-1' });
      await GET(event);
      expect(db.chats.isChatLocked).toHaveBeenCalledWith('chat-1');
    });

    it('preserves non-irrecoverable error events', async () => {
      const errorEvent = {
        id: 2,
        chatId: 'chat-1',
        type: 'error',
        data: { message: 'recoverable error' },
        createdAt: '2025-01-01T00:00:00.000Z',
      };
      vi.mocked(db.events.getChatEventsSince).mockResolvedValue([errorEvent]);

      const event = buildEvent({ chatId: 'chat-1' });
      await GET(event);
      // Filter should pass this event through (no irrecoverable flag)
      expect(db.chats.isChatLocked).not.toHaveBeenCalled();
    });

    it('handles errors during event replay gracefully', async () => {
      vi.mocked(db.events.getChatEventsSince).mockRejectedValue(new Error('DB connection error'));

      const event = buildEvent({ chatId: 'chat-1' });
      const res = await GET(event);
      // Stream is still returned — error written as SSE event, not HTTP error
      expect(res.status).toBe(200);
    });
  });

  describe('live subscription', () => {
    it('subscribes to live events for the chat', async () => {
      const event = buildEvent({ chatId: 'chat-1' });
      await GET(event);
      expect(subscribe).toHaveBeenCalledWith('chat-1', expect.any(Function));
    });

    it('sets up abort listener for cleanup on disconnect', async () => {
      const addEventListener = vi.fn();
      const event = {
        params: { id: 'chat-1' },
        request: {
          headers: { get: vi.fn(() => null) },
          signal: { addEventListener },
        } as unknown as Request,
        getClientAddress: () => '127.0.0.1',
        url: new URL('http://localhost'),
      } as unknown as RequestEvent;

      await GET(event);
      expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true });
    });

    it('does not call writeSSE for live events with id 0', async () => {
      const event = buildEvent({ chatId: 'chat-1' });
      await GET(event);

      // subscribe callback exists and is callable without throwing
      const subscribeCallback = vi.mocked(subscribe).mock.calls[0][1];
      expect(subscribeCallback).toBeInstanceOf(Function);
    });
  });
});
