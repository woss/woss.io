import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

vi.mock('$lib/server/db', () => ({
  getMessages: vi.fn(),
  getToolCallsForMessages: vi.fn(),
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
import { getMessages, getToolCallsForMessages } from '$lib/server/db';
import { GET } from './+server';

function buildEvent(chatId: string | null): RequestEvent {
  return {
    params: chatId ? { id: chatId } : {},
    request: {} as Request,
    url: new URL(`http://localhost/api/chat/${chatId ?? ''}/messages`),
    getClientAddress: () => '127.0.0.1',
    cookies: {} as unknown,
    locals: {},
    setHeaders: () => {},
    isDataRequest: false,
    isSubRequest: false,
    route: { id: 'api/chat/[id]/messages' },
    fetch: vi.fn(),
    platform: undefined,
    tracing: { enabled: false, root: {} as unknown, current: {} as unknown },
    isRemoteRequest: false,
  } as unknown as RequestEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/chat/[id]/messages', () => {
  it('returns 400 when chatId is missing from params', async () => {
    const event = buildEvent(null);
    const res = await GET(event);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('chatId required');
  });

  it('returns 200 with messages including toolCalls on success', async () => {
    const mockMessages = [
      { id: 'msg-1', role: 'user', content: 'Hello', sources: '[]' },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Hi there',
        sources: '[{"title":"Source 1","score":0.95,"slug":"test","url":"/test","type":"post"}]',
      },
    ];
    const mockToolCalls = {
      'msg-2': [
        {
          id: 'tc-1',
          name: 'search',
          serverId: 'server-1',
          startedAt: '2024-01-01',
          finishedAt: '2024-01-01',
          durationMs: null,
        },
      ],
    };

    vi.mocked(getMessages).mockReturnValue(mockMessages as unknown as StoredMessage[]);
    vi.mocked(getToolCallsForMessages).mockReturnValue(mockToolCalls);

    const event = buildEvent('chat-1');
    const res = await GET(event);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.messages).toEqual([
      { ...mockMessages[0], sources: [], toolCalls: [] },
      {
        ...mockMessages[1],
        sources: [{ title: 'Source 1', score: 0.95, slug: 'test', url: '/test', type: 'post' }],
        toolCalls: mockToolCalls['msg-2'],
      },
    ]);
    expect(getMessages).toHaveBeenCalledWith('chat-1', 50, 0);
    expect(getToolCallsForMessages).toHaveBeenCalledWith(['msg-1', 'msg-2']);
  });

  it('returns 200 with empty toolCalls when getToolCallsForMessages returns empty', async () => {
    const mockMessages = [{ id: 'msg-1', role: 'user', content: 'Hello' }];
    vi.mocked(getMessages).mockReturnValue(mockMessages as unknown as StoredMessage[]);
    vi.mocked(getToolCallsForMessages).mockReturnValue({});

    const event = buildEvent('chat-1');
    const res = await GET(event);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.messages).toEqual([{ ...mockMessages[0], toolCalls: [] }]);
  });

  it('returns sources as undefined for invalid JSON', async () => {
    const mockMessages = [{ id: 'msg-1', role: 'user', content: 'Hello', sources: 'not-valid-json' }];

    vi.mocked(getMessages).mockReturnValue(mockMessages as unknown as StoredMessage[]);
    vi.mocked(getToolCallsForMessages).mockReturnValue({});

    const event = buildEvent('chat-1');
    const res = await GET(event);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.messages).toEqual([{ ...mockMessages[0], sources: undefined, toolCalls: [] }]);
  });

  it('returns 500 when getMessages throws', async () => {
    vi.mocked(getMessages).mockImplementation(() => {
      throw new Error('DB connection lost');
    });

    const event = buildEvent('chat-1');
    const res = await GET(event);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Internal server error');
  });

  it('returns 500 when getToolCallsForMessages throws', async () => {
    vi.mocked(getMessages).mockReturnValue([{ id: 'msg-1' }] as unknown as StoredMessage[]);
    vi.mocked(getToolCallsForMessages).mockImplementation(() => {
      throw new Error('DB connection lost');
    });

    const event = buildEvent('chat-1');
    const res = await GET(event);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Internal server error');
  });
});
