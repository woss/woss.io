import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { Chat } from '$lib/server/db';

vi.mock('$lib/server/db', () => ({
  db: {
    chats: {
      getChats: vi.fn(),
    },
  },
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

import { db } from '$lib/server/db';
import { GET } from './+server';

function buildEvent(userId: string | null): RequestEvent {
  const url = new URL('http://localhost/api/chat');
  if (userId) url.searchParams.set('userId', userId);

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
    route: { id: 'api/chat' },
    fetch: vi.fn(),
    platform: undefined,
    tracing: { enabled: false, root: {} as unknown, current: {} as unknown },
    isRemoteRequest: false,
  } as unknown as RequestEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/chat', () => {
  it('returns 400 when userId is missing', async () => {
    const event = buildEvent(null);
    const res = await GET(event);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('userId required');
  });

  it('returns 200 with chats array on success', async () => {
    const mockChats = [
      { id: 'chat-1', title: 'Chat 1', createdAt: '2024-01-01T00:00:00.000Z', messageCount: 5, userId: 'user-1' },
      { id: 'chat-2', title: 'Chat 2', createdAt: '2024-01-02T00:00:00.000Z', messageCount: 3, userId: 'user-1' },
    ] as Chat[];
    vi.mocked(db.chats.getChats).mockResolvedValue(mockChats);

    const event = buildEvent('user-1');
    const res = await GET(event);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.chats).toEqual(mockChats);
    expect(db.chats.getChats).toHaveBeenCalledWith('user-1');
  });

  it('returns 500 when getChats throws', async () => {
    vi.mocked(db.chats.getChats).mockRejectedValue(new Error('DB connection lost'));

    const event = buildEvent('user-1');
    const res = await GET(event);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Internal server error');
  });

  it('returns 200 with empty array when user has no chats', async () => {
    vi.mocked(db.chats.getChats).mockResolvedValue([]);

    const event = buildEvent('user-empty');
    const res = await GET(event);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.chats).toEqual([]);
  });
});
