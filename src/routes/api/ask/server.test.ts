import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// ── Module mocks (all deps hoisted by Vite) ──────────────────────────────

vi.mock('$lib/server/db', () => ({
  addMessage: vi.fn(() => 'msg-id'),
  ensureModel: vi.fn(),
  getChat: vi.fn(),
  getChatMessageCount: vi.fn(() => 0),
  getDb: vi.fn(),
  getMessages: vi.fn(),
  getOrCreateUserAgent: vi.fn(() => 42),
  isChatLocked: vi.fn(() => false),
  lockChat: vi.fn(),
  searchChunks: vi.fn(),
}));

vi.mock('$lib/server/embed', () => ({
  embedText: vi.fn(),
}));

vi.mock('$lib/server/openai-provider', () => ({
  buildRagPrompt: vi.fn(),
  isAvailable: vi.fn().mockResolvedValue(true),
}));

vi.mock('$lib/server/llm-cache', () => ({
  checkCache: vi.fn(),
  storeCache: vi.fn(),
}));

vi.mock('$lib/server/rate-limiter', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 }),
}));

vi.mock('$lib/server/mcp/tools', () => ({
  getMcpToolDefs: vi.fn(),
  getMcpResourceContent: vi.fn(),
}));

vi.mock('$lib/server/config', () => ({
  config: vi.fn(),
}));

vi.mock('$lib/config', () => ({
  config: { public: { maxMessages: 10 } },
}));

vi.mock('$lib/server/chat-helpers', () => ({
  generatePoliteResponse: vi.fn(),
  isRelevant: vi.fn(),
  needsGithubTools: vi.fn(),
  needsMaculaTools: vi.fn(),
  tryRenameChat: vi.fn(),
}));

vi.mock('$lib/server/sanitize', () => ({
  sanitizeText: vi.fn((s: string) => s.trim()),
}));

vi.mock('$lib/server/generate', () => ({
  startGeneration: vi.fn(),
}));

vi.mock('$lib/server/trace-context', () => ({
  generateTraceId: vi.fn(() => 'test-trace-id'),
  generateSpanId: vi.fn(() => 'test-span-id'),
  withTrace: vi.fn((_traceId: string, _spanId: string, fn: () => unknown) => fn()),
}));

vi.mock('$app/environment', () => ({
  dev: false,
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

vi.mock('$lib/query-classifier', () => ({
  classifyQuery: vi.fn(),
}));

vi.mock('$lib/server/chat-events', () => ({
  publishLive: vi.fn(),
  publishPersistent: vi.fn(),
}));

vi.mock('$lib/server/webhooks', () => ({
  callWebhook: vi.fn(),
}));

// ── Imports (after mocks are set up) ─────────────────────────────────────

import { addMessage, getChat, getChatMessageCount, getOrCreateUserAgent, isChatLocked } from '$lib/server/db';
import { isAvailable } from '$lib/server/openai-provider';
import { checkRateLimit } from '$lib/server/rate-limiter';
import { sanitizeText } from '$lib/server/sanitize';
import { startGeneration } from '$lib/server/generate';
import { POST } from './+server';

// ── Helpers ──────────────────────────────────────────────────────────────

const VALID_BODY = { text: 'What is your name?', userId: 'user-1' };
const VALID_BODY_WITH_CHAT = { text: 'What is your name?', userId: 'user-1', chatId: 'chat-1' };

function buildEvent(overrides: { body?: Record<string, unknown>; ip?: string; userAgent?: string }): RequestEvent {
  const body = JSON.stringify(overrides.body ?? {});
  const headers = new Map<string, string>();
  if (overrides.ip) headers.set('x-forwarded-for', overrides.ip);
  if (overrides.userAgent) headers.set('user-agent', overrides.userAgent);

  const request = new Request('http://localhost', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...Object.fromEntries(headers) },
    body,
  });

  return {
    params: {},
    request,
    getClientAddress: () => '127.0.0.1',
    url: new URL('http://localhost'),
    cookies: {},
    locals: {},
    setHeaders: () => {},
    isDataRequest: false,
    isSubRequest: false,
    fetch: vi.fn(),
    platform: undefined,
    route: { id: 'api/ask' },
  } as unknown as RequestEvent;
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('POST /api/ask', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });
    vi.mocked(isAvailable).mockResolvedValue(true);
  });

  describe('request body validation', () => {
    it('returns 400 for invalid JSON body', async () => {
      const request = new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      const event = {
        params: {},
        request,
        getClientAddress: () => '127.0.0.1',
        url: new URL('http://localhost'),
      } as RequestEvent;
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Invalid JSON body');
    });

    it('returns 400 when text field is missing', async () => {
      const event = buildEvent({ body: { userId: 'user-1' } });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Field 'text' is required");
    });

    it('returns 400 when text is not a string', async () => {
      const event = buildEvent({ body: { text: 42, userId: 'user-1' } });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Field 'text' is required");
    });

    it('returns 400 when text sanitizes to empty', async () => {
      vi.mocked(sanitizeText).mockReturnValueOnce('');
      const event = buildEvent({ body: { text: '   ', userId: 'user-1' } });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Field 'text' is required");
    });

    it('returns 400 when text exceeds 500 characters', async () => {
      const event = buildEvent({ body: { text: 'a'.repeat(501), userId: 'user-1' } });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('500 characters');
    });

    it('returns 400 when maxChunks is not an integer', async () => {
      const event = buildEvent({ body: { ...VALID_BODY, maxChunks: 3.5 } });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('integer between 1 and 20');
    });

    it('returns 400 when maxChunks is less than 1', async () => {
      const event = buildEvent({ body: { ...VALID_BODY, maxChunks: 0 } });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('integer between 1 and 20');
    });

    it('returns 400 when maxChunks is greater than 20', async () => {
      const event = buildEvent({ body: { ...VALID_BODY, maxChunks: 21 } });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('integer between 1 and 20');
    });

    it('accepts maxChunks at boundary values 1 and 20', async () => {
      const event1 = buildEvent({ body: { ...VALID_BODY, maxChunks: 1 } });
      const res1 = await POST(event1);
      expect(res1.status).toBe(202);

      const event20 = buildEvent({ body: { ...VALID_BODY, maxChunks: 20 } });
      const res20 = await POST(event20);
      expect(res20.status).toBe(202);
    });

    it('returns 400 when userId is missing', async () => {
      const event = buildEvent({ body: { text: 'hello' } });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Field 'userId' is required");
    });

    it('returns 400 when userId is not a string', async () => {
      const event = buildEvent({ body: { text: 'hello', userId: 123 } });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Field 'userId' is required");
    });
  });

  describe('chat validation', () => {
    it('returns 400 when chat has reached max messages', async () => {
      vi.mocked(getChatMessageCount).mockReturnValueOnce(10);
      const event = buildEvent({ body: VALID_BODY_WITH_CHAT });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('maximum');
    });

    it('passes message count check when chat is below max', async () => {
      vi.mocked(getChatMessageCount).mockReturnValueOnce(5);
      const event = buildEvent({ body: VALID_BODY_WITH_CHAT });
      const res = await POST(event);
      expect(res.status).toBe(202);
    });

    it('returns 400 when chat is locked', async () => {
      vi.mocked(isChatLocked).mockReturnValueOnce(true);
      const event = buildEvent({ body: VALID_BODY_WITH_CHAT });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('This chat has been locked');
      expect(json.locked).toBe(true);
    });

    it('returns 403 when userId does not match chat owner', async () => {
      vi.mocked(getChat).mockReturnValueOnce({
        userId: 'other-user',
        id: 'chat-1',
        title: 'Test',
        createdAt: new Date().toISOString(),
        messageCount: 5,
      } as { id: string; title: string; createdAt: string; messageCount: number; userId: string });
      const event = buildEvent({ body: VALID_BODY_WITH_CHAT });
      const res = await POST(event);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Not authorized');
    });

    it('skips chat validation when chatId is not provided', async () => {
      // getChatMessageCount and isChatLocked should not be called
      const event = buildEvent({ body: VALID_BODY });
      await POST(event);
      expect(getChatMessageCount).not.toHaveBeenCalled();
      expect(isChatLocked).not.toHaveBeenCalled();
      expect(getChat).not.toHaveBeenCalled();
    });
  });

  describe('rate limiting', () => {
    it('returns 429 when rate limit exceeded', async () => {
      const resetAt = Date.now() + 60_000;
      vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt });
      const event = buildEvent({ body: VALID_BODY, ip: 'rate-test' });
      const res = await POST(event);
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toBe('Rate limit exceeded');
      expect(json.resetAt).toBe(resetAt);
      expect(res.headers.get('Retry-After')).toBe('60');
    });
  });

  describe('AI service availability', () => {
    it('returns 503 when AI service is unavailable', async () => {
      vi.mocked(isAvailable).mockResolvedValue(false);
      const event = buildEvent({ body: VALID_BODY });
      const res = await POST(event);
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toBe('AI service is not available');
    });
  });

  describe('user agent tracking', () => {
    it('calls getOrCreateUserAgent when user-agent header is present', async () => {
      const event = buildEvent({ body: VALID_BODY, userAgent: 'TestBot/1.0', ip: '1.2.3.4' });
      await POST(event);
      expect(getOrCreateUserAgent).toHaveBeenCalledWith('TestBot/1.0', '1.2.3.4');
    });

    it('skips getOrCreateUserAgent when user-agent header is absent', async () => {
      const event = buildEvent({ body: VALID_BODY });
      await POST(event);
      expect(getOrCreateUserAgent).not.toHaveBeenCalled();
    });
  });

  describe('success path', () => {
    it('returns 202 with accepted true and chatId for existing chat', async () => {
      const event = buildEvent({ body: VALID_BODY_WITH_CHAT });
      const res = await POST(event);
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.accepted).toBe(true);
      expect(json.chatId).toBe('chat-1');
    });

    it('returns 202 with accepted true for new chat (no chatId)', async () => {
      const event = buildEvent({ body: VALID_BODY });
      const res = await POST(event);
      expect(res.status).toBe(202);
      const json = await res.json();
      expect(json.accepted).toBe(true);
      expect(json).not.toHaveProperty('chatId');
    });

    it('calls addMessage with user message', async () => {
      const event = buildEvent({ body: VALID_BODY_WITH_CHAT, userAgent: 'Bot/1.0', ip: '1.2.3.4' });
      await POST(event);
      expect(addMessage).toHaveBeenCalledWith({
        userId: 'user-1',
        role: 'user',
        content: 'What is your name?',
        chatId: 'chat-1',
        userAgentId: 42,
      });
    });

    it('passes undefined userAgentId when no user-agent header', async () => {
      const event = buildEvent({ body: VALID_BODY_WITH_CHAT });
      await POST(event);
      expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ userAgentId: undefined }));
    });

    it('calls startGeneration when chatId is present', async () => {
      const event = buildEvent({ body: VALID_BODY_WITH_CHAT, userAgent: 'Bot/1.0', ip: '1.2.3.4' });
      await POST(event);
      expect(startGeneration).toHaveBeenCalledWith(
        'What is your name?',
        'chat-1',
        'user-1',
        8, // default maxChunks
        42, // userAgentId
        'msg-id', // userMsgId
        'test-trace-id',
      );
    });

    it('does not call startGeneration when chatId is absent', async () => {
      const event = buildEvent({ body: VALID_BODY });
      await POST(event);
      expect(startGeneration).not.toHaveBeenCalled();
    });

    it('uses default maxChunks of 8 when not provided', async () => {
      const event = buildEvent({ body: VALID_BODY_WITH_CHAT });
      await POST(event);
      expect(startGeneration).toHaveBeenCalledWith(
        'What is your name?',
        'chat-1',
        'user-1',
        8,
        undefined,
        'msg-id',
        'test-trace-id',
      );
    });

    it('passes custom maxChunks to startGeneration', async () => {
      const event = buildEvent({ body: { ...VALID_BODY_WITH_CHAT, maxChunks: 15 } });
      await POST(event);
      expect(startGeneration).toHaveBeenCalledWith(
        'What is your name?',
        'chat-1',
        'user-1',
        15,
        undefined,
        'msg-id',
        'test-trace-id',
      );
    });

    it('sets Content-Type to application/json', async () => {
      const event = buildEvent({ body: VALID_BODY });
      const res = await POST(event);
      expect(res.headers.get('Content-Type')).toBe('application/json');
    });
  });
});
