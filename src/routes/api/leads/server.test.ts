import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Mock all external dependencies
vi.mock('$lib/server/db', () => ({
  insertLead: vi.fn(),
  updateUserContact: vi.fn(),
}));

vi.mock('$lib/server/geo', () => ({
  lookupCountry: vi.fn(),
}));

vi.mock('$lib/server/rate-limiter', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('$lib/server/webhooks', () => ({
  callWebhook: vi.fn().mockResolvedValue(undefined),
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

vi.mock('$lib/server/sanitize', () => ({
  sanitizeText: vi.fn((s: string) => s.trim()),
}));

// Import mocked modules for assertions
import { insertLead, updateUserContact } from '$lib/server/db';
import { lookupCountry } from '$lib/server/geo';
import { checkRateLimit } from '$lib/server/rate-limiter';
import { callWebhook } from '$lib/server/webhooks';
import { POST } from './+server';

function buildEvent(overrides: {
  origin?: string;
  referer?: string;
  body?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}): RequestEvent {
  const body = JSON.stringify(overrides.body ?? {});
  const headers = new Map<string, string>();
  if (overrides.origin) headers.set('origin', overrides.origin);
  if (overrides.referer) headers.set('referer', overrides.referer);
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
    cookies: {} as unknown,
    locals: {},
    setHeaders: () => {},
    isDataRequest: false,
    isSubRequest: false,
    route: { id: 'api/leads' },
    fetch: vi.fn(),
    platform: undefined,
    tracing: { enabled: false, root: {} as unknown, current: {} as unknown },
    isRemoteRequest: false,
  } as unknown as RequestEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });
  vi.mocked(lookupCountry).mockReturnValue('US');
});

describe('POST /api/leads', () => {
  const validBody = {
    userId: 'user-1',
    name: 'Alice',
    email: 'alice@example.com',
    companyName: 'Acme Inc',
    role: 'Engineer',
    message: 'Interested in your product',
  };

  describe('CSRF protection', () => {
    it('rejects request without valid origin or referer', async () => {
      const event = buildEvent({ body: validBody });
      const res = await POST(event);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBe('Forbidden');
    });

    it('accepts request with valid origin (woss.io)', async () => {
      const event = buildEvent({ origin: 'https://woss.io', ip: 'csrf-test-1', body: validBody });
      const res = await POST(event);
      expect(res.status).toBe(200);
    });

    it('accepts request with valid referer (www.woss.io)', async () => {
      const event = buildEvent({ referer: 'https://www.woss.io/contact', ip: 'csrf-test-2', body: validBody });
      const res = await POST(event);
      expect(res.status).toBe(200);
    });

    it('accepts localhost origin in dev', async () => {
      const event = buildEvent({ origin: 'http://localhost:5173', ip: 'csrf-test-3', body: validBody });
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
      const event = buildEvent({ origin: 'https://woss.io', body: { name: 'Alice', email: 'alice@example.com' } });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('userId is required');
    });

    it('rejects missing name', async () => {
      const event = buildEvent({ origin: 'https://woss.io', body: { userId: 'user-1', email: 'alice@example.com' } });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Name is required');
    });

    it('rejects missing email', async () => {
      const event = buildEvent({ origin: 'https://woss.io', body: { userId: 'user-1', name: 'Alice' } });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Email is required');
    });

    it('rejects invalid email format', async () => {
      const event = buildEvent({
        origin: 'https://woss.io',
        body: { userId: 'user-1', name: 'Alice', email: 'not-an-email' },
      });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Invalid email format');
    });

    it('rejects name that sanitizes to empty', async () => {
      const event = buildEvent({
        origin: 'https://woss.io',
        body: { userId: 'user-1', name: '   ', email: 'alice@example.com' },
      });
      const res = await POST(event);
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Name cannot be empty');
    });
  });

  describe('rate limiting', () => {
    it('returns 429 when lead rate limit exceeded', async () => {
      const ip = 'rate-lead-test';
      for (let i = 0; i < 3; i++) {
        await POST(buildEvent({ origin: 'https://woss.io', ip, body: validBody }));
      }

      const res = await POST(buildEvent({ origin: 'https://woss.io', ip, body: validBody }));
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toBe('Too many submissions. Please try again later.');
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
    it('inserts lead and updates user contact on valid request', async () => {
      const event = buildEvent({
        origin: 'https://woss.io',
        ip: 'success-test-1',
        userAgent: 'TestBot/1.0',
        body: validBody,
      });
      const res = await POST(event);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      expect(updateUserContact).toHaveBeenCalledWith('user-1', 'Alice', 'alice@example.com');
      expect(insertLead).toHaveBeenCalledWith(
        'user-1',
        'Alice',
        'alice@example.com',
        'Acme Inc',
        'Engineer',
        'Interested in your product',
        'success-test-1',
      );
      expect(callWebhook).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'contactSubmitted',
          userAgent: 'TestBot/1.0',
          country: 'US',
        }),
      );
    });

    it('handles missing optional fields gracefully', async () => {
      const event = buildEvent({
        origin: 'https://woss.io',
        ip: 'success-test-2',
        body: { userId: 'user-1', name: 'Alice', email: 'alice@example.com' },
      });
      const res = await POST(event);
      expect(res.status).toBe(200);

      expect(insertLead).toHaveBeenCalledWith('user-1', 'Alice', 'alice@example.com', '', '', '', 'success-test-2');
    });
  });

  describe('error handling', () => {
    it('returns 500 when DB call throws', async () => {
      vi.mocked(insertLead).mockImplementation(() => {
        throw new Error('DB connection lost');
      });

      const event = buildEvent({ origin: 'https://woss.io', ip: 'error-test-1', body: validBody });
      const res = await POST(event);
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toBe('Failed to save your request. Please try again.');
    });
  });
});
