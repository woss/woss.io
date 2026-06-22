import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Mock all external dependencies
vi.mock('$lib/server/db', () => ({
  setReaction: vi.fn(),
  deleteReaction: vi.fn(),
  softDeleteMessage: vi.fn(),
  getChat: vi.fn(),
}));

vi.mock('$lib/server/webhooks', () => ({
  callWebhook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/geo', () => ({
  lookupCountry: vi.fn(),
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

// Import mocked modules for assertions
import { setReaction, deleteReaction, softDeleteMessage, getChat } from '$lib/server/db';
import { callWebhook } from '$lib/server/webhooks';
import { lookupCountry } from '$lib/server/geo';
import { actions } from './+page.server';

// Helper to build a minimal RequestEvent
function buildEvent(chatId: string, fields: Record<string, string>): RequestEvent<{ id: string }, '/chat/[id]'> {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    fd.set(key, value);
  }
  const request = new Request('http://localhost', {
    method: 'POST',
    body: fd,
  });
  return {
    params: { id: chatId },
    request,
    getClientAddress: () => '127.0.0.1',
    url: new URL('http://localhost'),
    cookies: {} as unknown,
    locals: {},
    setHeaders: () => {},
    isDataRequest: false,
    isSubRequest: false,
    route: { id: 'chat/[id]' },
    fetch: vi.fn(),
    platform: undefined,
    tracing: { enabled: false, root: {} as unknown, current: {} as unknown },
    isRemoteRequest: false,
  } as unknown as RequestEvent<{ id: string }, '/chat/[id]'>;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(lookupCountry).mockReturnValue('US');
  vi.mocked(getChat).mockReturnValue({
    id: 'chat-1',
    title: 'Test Chat',
    createdAt: '2025-01-15T10:00:00.000Z',
    messageCount: 1,
    userId: 'user-1',
  });
});

describe('reaction action', () => {
  describe('mode=set', () => {
    it('calls setReaction and webhook for thumbs up', async () => {
      const event = buildEvent('chat-1', {
        messageId: 'msg-1',
        userId: 'user-1',
        mode: 'set',
        reactionType: 'up',
        reason: '',
      });
      const result = await actions.reaction(event);
      expect(setReaction).toHaveBeenCalledWith('msg-1', 'user-1', 'up', undefined);
      expect(callWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'messageUpvote',
          messageId: 'msg-1',
          country: 'US',
        }),
      );
      expect(result).toEqual({ success: true });
    });

    it('calls setReaction for heart', async () => {
      const event = buildEvent('chat-1', {
        messageId: 'msg-1',
        userId: 'user-1',
        mode: 'set',
        reactionType: 'heart',
        reason: '',
      });
      const result = await actions.reaction(event);
      expect(setReaction).toHaveBeenCalledWith('msg-1', 'user-1', 'heart', undefined);
      expect(callWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'messageHeart',
          messageId: 'msg-1',
        }),
      );
      expect(result).toEqual({ success: true });
    });

    it('calls setReaction for thumbs down with reason', async () => {
      const event = buildEvent('chat-1', {
        messageId: 'msg-1',
        userId: 'user-1',
        mode: 'set',
        reactionType: 'down',
        reason: 'Not clear',
      });
      const result = await actions.reaction(event);
      expect(setReaction).toHaveBeenCalledWith('msg-1', 'user-1', 'down', 'Not clear');
      expect(callWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'messageDownvote',
          reason: 'Not clear',
        }),
      );
      expect(result).toEqual({ success: true });
    });

    it('fails with 400 for missing reactionType', async () => {
      const event = buildEvent('chat-1', {
        messageId: 'msg-1',
        userId: 'user-1',
        mode: 'set',
        reactionType: '',
        reason: '',
      });
      const result = await actions.reaction(event);
      expect(result).toHaveProperty('status', 400);
    });

    it('fails with 400 for invalid reactionType', async () => {
      const event = buildEvent('chat-1', {
        messageId: 'msg-1',
        userId: 'user-1',
        mode: 'set',
        reactionType: 'invalid',
        reason: '',
      });
      const result = await actions.reaction(event);
      expect(result).toHaveProperty('status', 400);
    });
  });

  describe('mode=remove', () => {
    it('calls deleteReaction and webhook', async () => {
      const event = buildEvent('chat-1', {
        messageId: 'msg-1',
        userId: 'user-1',
        mode: 'remove',
      });
      const result = await actions.reaction(event);
      expect(deleteReaction).toHaveBeenCalledWith('msg-1', 'user-1');
      expect(callWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'reactionRemoved',
          messageId: 'msg-1',
        }),
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('validation', () => {
    it('fails with 400 for missing messageId', async () => {
      const event = buildEvent('chat-1', {
        messageId: '',
        userId: 'user-1',
        mode: 'set',
        reactionType: 'up',
      });
      const result = await actions.reaction(event);
      expect(result).toHaveProperty('status', 400);
    });

    it('fails with 400 for missing userId', async () => {
      const event = buildEvent('chat-1', {
        messageId: 'msg-1',
        userId: '',
        mode: 'set',
        reactionType: 'up',
      });
      const result = await actions.reaction(event);
      expect(result).toHaveProperty('status', 400);
    });
  });
});

describe('report action', () => {
  it('calls setReaction, softDeleteMessage, and webhook', async () => {
    const event = buildEvent('chat-1', {
      messageId: 'msg-1',
      userId: 'user-1',
      reason: 'Offensive',
    });
    const result = await actions.report(event);
    expect(setReaction).toHaveBeenCalledWith('msg-1', 'user-1', 'down', 'Offensive');
    expect(softDeleteMessage).toHaveBeenCalledWith('msg-1');
    expect(callWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'reportMessage',
        messageId: 'msg-1',
        reason: 'Offensive',
        country: 'US',
      }),
    );
    expect(result).toEqual({ success: true });
  });

  it('fails with 400 for missing reason', async () => {
    const event = buildEvent('chat-1', {
      messageId: 'msg-1',
      userId: 'user-1',
      reason: '',
    });
    const result = await actions.report(event);
    expect(result).toHaveProperty('status', 400);
  });

  it('fails with 400 for whitespace-only reason', async () => {
    const event = buildEvent('chat-1', {
      messageId: 'msg-1',
      userId: 'user-1',
      reason: '   ',
    });
    const result = await actions.report(event);
    expect(result).toHaveProperty('status', 400);
  });

  it('fails with 400 for missing messageId', async () => {
    const event = buildEvent('chat-1', {
      messageId: '',
      userId: 'user-1',
      reason: 'Bad',
    });
    const result = await actions.report(event);
    expect(result).toHaveProperty('status', 400);
  });

  it('fails with 400 for missing userId', async () => {
    const event = buildEvent('chat-1', {
      messageId: 'msg-1',
      userId: '',
      reason: 'Bad',
    });
    const result = await actions.report(event);
    expect(result).toHaveProperty('status', 400);
  });
});
