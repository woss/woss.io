import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

vi.mock('$lib/server/db', () => ({
  db: {
    toolCalls: {
      getToolCallsByMessageId: vi.fn(),
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

function buildEvent(msgId: string | null): RequestEvent {
  return {
    params: msgId ? { msgId } : {},
    request: {} as Request,
    url: new URL(`http://localhost/api/chat/chat-1/messages/${msgId ?? ''}/tool-calls`),
    getClientAddress: () => '127.0.0.1',
    cookies: {} as unknown,
    locals: {},
    setHeaders: () => {},
    isDataRequest: false,
    isSubRequest: false,
    route: { id: 'api/chat/[id]/messages/[msgId]/tool-calls' },
    fetch: vi.fn(),
    platform: undefined,
    tracing: { enabled: false, root: {} as unknown, current: {} as unknown },
    isRemoteRequest: false,
  } as unknown as RequestEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/chat/[id]/messages/[msgId]/tool-calls', () => {
  it('returns 400 when msgId is missing from params', async () => {
    const event = buildEvent(null);
    const res = await GET(event);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('messageId required');
  });

  it('returns 200 with tool calls array on success', async () => {
    const mockToolCalls = [
      {
        id: 'tc-1',
        name: 'search',
        serverId: 'web',
        startedAt: '2025-01-15T10:00:00.000Z',
        finishedAt: null,
        durationMs: null,
      },
      {
        id: 'tc-2',
        name: 'read_file',
        serverId: 'local',
        startedAt: '2025-01-15T10:00:05.000Z',
        finishedAt: '2025-01-15T10:00:06.000Z',
        durationMs: 1000,
      },
    ];

    vi.mocked(db.toolCalls.getToolCallsByMessageId).mockResolvedValue(mockToolCalls);

    const event = buildEvent('msg-1');
    const res = await GET(event);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.toolCalls).toEqual(mockToolCalls);
    expect(db.toolCalls.getToolCallsByMessageId).toHaveBeenCalledWith('msg-1');
  });

  it('returns 200 with empty array when no tool calls exist', async () => {
    vi.mocked(db.toolCalls.getToolCallsByMessageId).mockResolvedValue([]);

    const event = buildEvent('msg-empty');
    const res = await GET(event);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.toolCalls).toEqual([]);
  });

  it('returns 500 when getToolCallsByMessageId throws', async () => {
    vi.mocked(db.toolCalls.getToolCallsByMessageId).mockRejectedValue(new Error('DB connection lost'));

    const event = buildEvent('msg-1');
    const res = await GET(event);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Internal server error');
  });

  it('sets correct content-type header on success', async () => {
    vi.mocked(db.toolCalls.getToolCallsByMessageId).mockResolvedValue([]);

    const event = buildEvent('msg-1');
    const res = await GET(event);

    expect(res.headers.get('Content-Type')).toBe('application/json');
  });
});
