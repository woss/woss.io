import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Mock all external dependencies
vi.mock('$lib/server/db', () => ({
  insertContactIntent: vi.fn(),
}));

vi.mock('$lib/server/rate-limiter', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
  CAT: { api: 'api' },
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  }),
}));

import { insertContactIntent } from '$lib/server/db';
import { checkRateLimit } from '$lib/server/rate-limiter';
import { POST } from './+server';

function buildEvent(overrides: {
  origin?: string;
  referer?: string;
  body?: Record<string, unknown>;
  ip?: string;
}): RequestEvent {
  const body = JSON.stringify(overrides.body ?? {});
  const headers = new Map<string, string>();
  if (overrides.origin) headers.set('origin', overrides.origin);
  if (overrides.referer) headers.set('referer', overrides.referer);
  if (overrides.ip) headers.set('x-forwarded-for', overrides.ip);

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
    cookies: {} as unknown,
    locals: {},
    setHeaders: () => {},
    isDataRequest: false,
    isSubRequest: false,
    route: { id: 'api/leads/contact-intent' },
    fetch: vi.fn(),
    platform: undefined,
    tracing: { enabled: false, root: {} as unknown, current: {} as unknown },
    isRemoteRequest: false,
  } as unknown as RequestEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });
});

describe('POST /api/leads/contact-intent', () => {
  const validBody = { userId: 'user-1', chatId: 'chat-1' };

  describe('CSRF protection', () => {
    it('rejects request without valid origin or referer', async () => {
      const event = buildEvent({ body: validBody });
      const res = await POST(event);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Forbidden');
    });

    it('accepts request with valid origin', async () => {
      const event = buildEvent({ origin: 'https://woss.io', ip: 'csrf-test-1', body: validBody });
      const res = await POST(event);
      expect(res.status).toBe(200);
    });

    it('accepts request with valid referer', async () => {
      const event = buildEvent({ referer: 'https://www.woss.io/some-page', ip: 'csrf-test-2', body: validBody });
      const res = await POST(event);
      expect(res.status).toBe(200);
    });

    it('accepts localhost origin in dev', async () => {
      const event = buildEvent({ origin: 'http://localhost:4173', ip: 'csrf-test-3', body: validBody });
      const res = await POST(event);
      expect(res.status).toBe(200);
    });
  });

  describe('request body validation', () => {
    it('rejects non-JSON body', async () => {
      const request = new Request('http://localhost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: 'https://woss.io' },
        body: 'not json',
      });
      const event = {
        params: {},
        request,
        getClientAddress: () => '127.0.0.1',
        url: new URL('http://localhost'),
      } as unknown as RequestEvent;
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Invalid JSON');
    });

    it('rejects missing userId', async () => {
      const event = buildEvent({ origin: 'https://woss.io', body: { chatId: 'chat-1' } });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('userId and chatId are required');
    });

    it('rejects missing chatId', async () => {
      const event = buildEvent({ origin: 'https://woss.io', body: { userId: 'user-1' } });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('userId and chatId are required');
    });

    it('rejects empty userId', async () => {
      const event = buildEvent({ origin: 'https://woss.io', body: { userId: '', chatId: 'chat-1' } });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('userId and chatId are required');
    });

    it('rejects empty chatId', async () => {
      const event = buildEvent({ origin: 'https://woss.io', body: { userId: 'user-1', chatId: '' } });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('userId and chatId are required');
    });
  });

  describe('rate limiting', () => {
    it('returns 429 when intent rate limit exceeded', async () => {
      const ip = 'rate-intent-test';
      for (let i = 0; i < 10; i++) {
        await POST(buildEvent({ origin: 'https://woss.io', ip, body: validBody }));
      }

      const res = await POST(buildEvent({ origin: 'https://woss.io', ip, body: validBody }));
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toBe('Too many requests. Please slow down.');
    });

    it('returns 429 when general rate limit exceeded', async () => {
      vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: Date.now() + 60_000 });

      const event = buildEvent({ origin: 'https://woss.io', ip: 'rate-general-test', body: validBody });
      const res = await POST(event);
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toBe('Too many requests. Please slow down.');
    });
  });

  describe('success path', () => {
    it('inserts contact intent on valid request', async () => {
      const event = buildEvent({ origin: 'https://woss.io', ip: 'success-test-1', body: validBody });
      const res = await POST(event);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      expect(insertContactIntent).toHaveBeenCalledWith('user-1', 'chat-1', '/contact');
    });
  });

  describe('error handling', () => {
    it('returns 200 even when insertContactIntent throws (fire-and-forget)', async () => {
      vi.mocked(insertContactIntent).mockImplementation(() => {
        throw new Error('DB connection lost');
      });

      const event = buildEvent({ origin: 'https://woss.io', ip: 'error-test-1', body: validBody });
      const res = await POST(event);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('calls insertContactIntent with correct arguments', async () => {
      const event = buildEvent({
        origin: 'https://woss.io',
        ip: 'arg-test-1',
        body: { userId: 'user-42', chatId: 'chat-99' },
      });
      await POST(event);

      expect(insertContactIntent).toHaveBeenCalledWith('user-42', 'chat-99', '/contact');
    });
  });
});
