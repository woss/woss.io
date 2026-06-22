import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

vi.mock('$lib/server/db', () => ({
  getMessages: vi.fn(),
  getMessagesByUserId: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
  CAT: { chat: 'chat' },
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  })),
}));

import type { StoredMessage } from '$lib/server/db';
import { getMessages, getMessagesByUserId } from '$lib/server/db';
import { GET } from './+server';

function buildEvent(params: Record<string, string>): RequestEvent {
  const url = new URL('http://localhost/api/chat/history');
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return {
    params: {},
    request: {} as Request,
    url,
    getClientAddress: () => '127.0.0.1',
    cookies: {} as unknown,
    locals: {},
    setHeaders: () => {},
    isDataRequest: false,
    isSubRequest: false,
    route: { id: 'api/chat/history' },
    fetch: vi.fn(),
    platform: undefined,
    tracing: { enabled: false, root: {} as unknown, current: {} as unknown },
    isRemoteRequest: false,
  } as unknown as RequestEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/chat/history', () => {
  it('returns 400 when neither chatId nor userId is provided', async () => {
    const event = buildEvent({});
    const res = await GET(event);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Query parameter 'chatId' or 'userId' is required");
  });

  describe('chatId path', () => {
    it('returns 200 with messages when chatId is provided', async () => {
      const mockMessages = [
        { id: 'msg-1', role: 'user', content: 'Hello' },
        { id: 'msg-2', role: 'assistant', content: 'Hi there' },
      ];
      vi.mocked(getMessages).mockReturnValue(mockMessages as unknown as StoredMessage[]);

      const event = buildEvent({ chatId: 'chat-1' });
      const res = await GET(event);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.messages).toEqual(mockMessages);
      expect(getMessages).toHaveBeenCalledWith('chat-1', 50, 0);
      expect(getMessagesByUserId).not.toHaveBeenCalled();
    });

    it('returns 500 when getMessages throws', async () => {
      vi.mocked(getMessages).mockImplementation(() => {
        throw new Error('DB connection lost');
      });

      const event = buildEvent({ chatId: 'chat-1' });
      const res = await GET(event);

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Internal server error');
    });
  });

  describe('userId fallback path', () => {
    it('returns 200 with messages when userId is provided', async () => {
      const mockMessages = [{ id: 'msg-1', role: 'user', content: 'Hello' }];
      vi.mocked(getMessagesByUserId).mockReturnValue(mockMessages as unknown as StoredMessage[]);

      const event = buildEvent({ userId: 'user-1' });
      const res = await GET(event);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.messages).toEqual(mockMessages);
      expect(getMessagesByUserId).toHaveBeenCalledWith('user-1', 50, 0);
      expect(getMessages).not.toHaveBeenCalled();
    });

    it('returns 500 when getMessagesByUserId throws', async () => {
      vi.mocked(getMessagesByUserId).mockImplementation(() => {
        throw new Error('DB connection lost');
      });

      const event = buildEvent({ userId: 'user-1' });
      const res = await GET(event);

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Internal server error');
    });
  });

  it('prefers chatId over userId when both are provided', async () => {
    vi.mocked(getMessages).mockReturnValue([]);
    vi.mocked(getMessagesByUserId).mockReturnValue([]);

    const event = buildEvent({ chatId: 'chat-1', userId: 'user-1' });
    const res = await GET(event);

    expect(res.status).toBe(200);
    expect(getMessages).toHaveBeenCalledWith('chat-1', 50, 0);
    expect(getMessagesByUserId).not.toHaveBeenCalled();
  });
});
