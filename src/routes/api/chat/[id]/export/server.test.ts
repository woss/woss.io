import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Mock all external dependencies
vi.mock('$lib/server/db', () => ({
  getChat: vi.fn(),
  getMessages: vi.fn(),
  getToolCallsForMessages: vi.fn(),
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

import { getChat, getMessages, getToolCallsForMessages } from '$lib/server/db';
import { GET } from './+server';

type MockMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources: string;
  createdAt: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  error: undefined;
  irrecoverable: undefined;
  deletedAt: undefined;
  queryType: string;
  userId: string;
  chatId: string;
  reasoning: string;
  modelId: number;
  maxTokens: number;
};

const mockMessage: MockMessage = {
  id: 'msg-1',
  role: 'user',
  content: 'Hello world',
  sources: '',
  createdAt: '2025-01-15T10:00:00.000Z',
  tokensIn: 10,
  tokensOut: 50,
  durationMs: 1200,
  error: undefined,
  irrecoverable: undefined,
  deletedAt: undefined,
  queryType: 'general',
  userId: 'user-1',
  chatId: 'chat-1',
  reasoning: '',
  modelId: 0,
  maxTokens: 0,
};

const mockChat = {
  id: 'chat-1',
  title: 'Test Chat',
  createdAt: '2025-01-15T10:00:00.000Z',
  messageCount: 1,
  userId: 'user-1',
};

function buildEvent(params: Record<string, string>, searchParams?: Record<string, string>): RequestEvent {
  const url = new URL('http://localhost');
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }
  return {
    params,
    request: new Request('http://localhost'),
    getClientAddress: () => '127.0.0.1',
    url,
    cookies: {} as unknown,
    locals: {},
    setHeaders: () => {},
    isDataRequest: false,
    isSubRequest: false,
    route: { id: 'api/chat/[id]/export' },
    fetch: vi.fn(),
    platform: undefined,
    tracing: { enabled: false, root: {} as unknown, current: {} as unknown },
    isRemoteRequest: false,
  } as unknown as RequestEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getChat).mockReturnValue(mockChat);
  vi.mocked(getMessages).mockReturnValue([mockMessage]);
  vi.mocked(getToolCallsForMessages).mockReturnValue({});
});

describe('GET /api/chat/[id]/export', () => {
  describe('validation', () => {
    it('returns 400 when id is missing', async () => {
      try {
        await GET(buildEvent({}));
        expect.unreachable('Should have thrown');
      } catch (e: unknown) {
        const err = e as { status: number; body: { message: string } };
        expect(err.status).toBe(400);
        expect(err.body.message).toBe('Chat ID is required');
      }
    });

    it('returns 400 for invalid format parameter', async () => {
      try {
        await GET(buildEvent({ id: 'chat-1' }, { format: 'xml' }));
        expect.unreachable('Should have thrown');
      } catch (e: unknown) {
        const err = e as { status: number; body: { message: string } };
        expect(err.status).toBe(400);
        expect(err.body.message).toBe('Invalid format. Use ?format=md or ?format=json');
      }
    });

    it('returns 404 when chat not found', async () => {
      vi.mocked(getChat).mockReturnValue(undefined);
      try {
        await GET(buildEvent({ id: 'nonexistent' }));
        expect.unreachable('Should have thrown');
      } catch (e: unknown) {
        const err = e as { status: number; body: { message: string } };
        expect(err.status).toBe(404);
        expect(err.body.message).toBe('Chat not found');
      }
    });
  });

  describe('JSON export', () => {
    it('exports chat as JSON with correct structure', async () => {
      const res = await GET(buildEvent({ id: 'chat-1' }));
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/json');
      expect(res.headers.get('Content-Disposition')).toContain('filename="woss.io-chat-test-chat-');
      expect(res.headers.get('Cache-Control')).toBe('no-store');

      const body = JSON.parse(await res.text());
      expect(body.chat).toEqual({
        id: 'chat-1',
        title: 'Test Chat',
        createdAt: '2025-01-15T10:00:00.000Z',
        messageCount: 1,
      });
      expect(body.exportedAt).toBeDefined();
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].id).toBe('msg-1');
      expect(body.messages[0].text).toBe('Hello world');
    });

    it('parses sources JSON when present', async () => {
      const msgWithSources = {
        ...mockMessage,
        sources: JSON.stringify([{ title: 'Source 1', url: 'https://example.com', score: 0.95 }]),
      };
      vi.mocked(getMessages).mockReturnValue([msgWithSources]);

      const res = await GET(buildEvent({ id: 'chat-1' }));
      const body = JSON.parse(await res.text());
      expect(body.messages[0].sources).toEqual([{ title: 'Source 1', url: 'https://example.com', score: 0.95 }]);
    });

    it('handles invalid sources JSON gracefully', async () => {
      const msgWithBadSources = {
        ...mockMessage,
        sources: '{invalid json}',
      };
      vi.mocked(getMessages).mockReturnValue([msgWithBadSources]);

      const res = await GET(buildEvent({ id: 'chat-1' }));
      const body = JSON.parse(await res.text());
      expect(body.messages[0].sources).toBeUndefined();
    });

    it('includes tool calls in messages', async () => {
      vi.mocked(getToolCallsForMessages).mockReturnValue({
        'msg-1': [
          {
            id: 'tc-1',
            name: 'search',
            serverId: 'web',
            durationMs: 300,
            startedAt: '2025-01-15T10:00:00.000Z',
            finishedAt: null,
          },
        ],
      });

      const res = await GET(buildEvent({ id: 'chat-1' }));
      const body = JSON.parse(await res.text());
      expect(body.messages[0].toolCalls).toHaveLength(1);
      expect(body.messages[0].toolCalls[0].name).toBe('search');
    });

    it('maps system role to assistant in export', async () => {
      const systemMsg = { ...mockMessage, role: 'system', id: 'msg-2' };
      vi.mocked(getMessages).mockReturnValue([mockMessage, systemMsg as MockMessage]);

      const res = await GET(buildEvent({ id: 'chat-1' }));
      const body = JSON.parse(await res.text());
      expect(body.messages[1].role).toBe('assistant');
    });
  });

  describe('Markdown export', () => {
    it('exports chat as markdown with correct headers', async () => {
      const res = await GET(buildEvent({ id: 'chat-1' }, { format: 'md' }));
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/markdown');
      expect(res.headers.get('Content-Disposition')).toContain('filename="woss.io-chat-test-chat-');
      expect(res.headers.get('Cache-Control')).toBe('no-store');

      const text = await res.text();
      expect(text).toContain('# Chat: Test Chat');
      expect(text).toContain('*Exported from woss.io');
      expect(text).toContain('*1 messages*');
    });

    it('includes user and assistant messages in markdown', async () => {
      const assistantMsg = { ...mockMessage, role: 'assistant', id: 'msg-2', content: 'Hi there!' };
      vi.mocked(getMessages).mockReturnValue([mockMessage, assistantMsg as MockMessage]);

      const res = await GET(buildEvent({ id: 'chat-1' }, { format: 'md' }));
      const text = await res.text();

      expect(text).toContain('## 1. User —');
      expect(text).toContain('Hello world');
      expect(text).toContain('## 2. Assistant —');
      expect(text).toContain('Hi there!');
    });

    it('includes sources section in markdown when present', async () => {
      const msgWithSources = {
        ...mockMessage,
        sources: JSON.stringify([{ title: 'Docs Page', url: 'https://docs.example.com', score: 0.92 }]),
      };
      vi.mocked(getMessages).mockReturnValue([msgWithSources]);

      const res = await GET(buildEvent({ id: 'chat-1' }, { format: 'md' }));
      const text = await res.text();
      expect(text).toContain('**Sources:**');
      expect(text).toContain('[Docs Page](https://docs.example.com)');
      expect(text).toContain('score: 0.92');
    });

    it('includes tool calls section in markdown', async () => {
      vi.mocked(getToolCallsForMessages).mockReturnValue({
        'msg-1': [
          {
            id: 'tc-1',
            name: 'search',
            serverId: 'web',
            durationMs: 300,
            startedAt: '2025-01-15T10:00:00.000Z',
            finishedAt: null,
          },
        ],
      });

      const res = await GET(buildEvent({ id: 'chat-1' }, { format: 'md' }));
      const text = await res.text();
      expect(text).toContain('**Tool Calls:**');
      expect(text).toContain('**search** on `web`');
      expect(text).toContain('300ms');
    });

    it('includes metadata line in markdown', async () => {
      const res = await GET(buildEvent({ id: 'chat-1' }, { format: 'md' }));
      const text = await res.text();
      expect(text).toContain('Type: general');
      expect(text).toContain('Tokens: 10→50');
      expect(text).toContain('Duration: 1200ms');
    });
  });

  describe('slugify', () => {
    it('slugifies chat title for filename', async () => {
      vi.mocked(getChat).mockReturnValue({ ...mockChat, title: 'My Cool Chat!!!' });

      const res = await GET(buildEvent({ id: 'chat-1' }));
      const disposition = res.headers.get('Content-Disposition') ?? '';
      expect(disposition).toContain('my-cool-chat');
    });

    it('handles special characters in title', async () => {
      vi.mocked(getChat).mockReturnValue({ ...mockChat, title: 'Q&A: "Testing" Things #2025' });

      const res = await GET(buildEvent({ id: 'chat-1' }));
      const disposition = res.headers.get('Content-Disposition') ?? '';
      expect(disposition).toContain('q-a-testing-things-2025');
    });
  });
});
