import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks must come before route import ───────────────────────────────────────
// vi.mock factories are hoisted above variable declarations,
// so use vi.hoisted() for any mock references inside factories.

const { mockHandleRequest, mockConnect } = vi.hoisted(() => ({
  mockHandleRequest: vi.fn() as ReturnType<typeof vi.fn>,
  mockConnect: vi.fn().mockResolvedValue(undefined) as ReturnType<typeof vi.fn>,
}));

vi.mock('@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js', () => ({
  WebStandardStreamableHTTPServerTransport: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.handleRequest = mockHandleRequest;
    this.sessionId = 'test-session-id';
  }),
}));

vi.mock('$lib/server/mcp-server', () => ({
  mcpServer: { connect: mockConnect },
}));

vi.mock('$lib/server/rate-limiter', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
  CAT: { mcp: ['woss', 'mcp'] },
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  }),
}));

import { GET, POST, OPTIONS, DELETE } from './+server';
import { checkRateLimit } from '$lib/server/rate-limiter';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

function mockEvent(opts?: {
  ip?: string;
  rateLimit?: ReturnType<typeof vi.mocked<typeof checkRateLimit>>['mock']['results'][number]['value'];
}) {
  const request = new Request('http://localhost:5173/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1, params: {} }),
  });

  return {
    request,
    getClientAddress: () => opts?.ip ?? '127.0.0.1',
  } as Parameters<typeof POST>[0];
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MCP route handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the module-level `connected` flag by re-importing
    // We use dynamic import trick — but since vi.mock is module-scoped,
    // we test via the static import and rely on fresh mock state.
  });

  afterEach(async () => {
    // Close any lingering transport state
    vi.restoreAllMocks();
  });

  // ── GET ─────────────────────────────────────────────────────────────────────

  describe('GET', () => {
    it('returns 405 Method Not Allowed', async () => {
      const response = await GET();

      expect(response.status).toBe(405);
    });

    it('includes CORS headers', async () => {
      const response = await GET();

      for (const [key, value] of Object.entries(CORS)) {
        expect(response.headers.get(key)).toBe(value);
      }
    });
  });

  // ── DELETE ──────────────────────────────────────────────────────────────────

  describe('DELETE', () => {
    it('returns 405 Method Not Allowed', async () => {
      const response = await DELETE();

      expect(response.status).toBe(405);
    });

    it('includes CORS headers', async () => {
      const response = await DELETE();

      for (const [key, value] of Object.entries(CORS)) {
        expect(response.headers.get(key)).toBe(value);
      }
    });
  });

  // ── OPTIONS ────────────────────────────────────────────────────────────────

  describe('OPTIONS', () => {
    it('returns 204 No Content', async () => {
      const response = await OPTIONS();

      expect(response.status).toBe(204);
    });

    it('includes CORS headers', async () => {
      const response = await OPTIONS();

      for (const [key, value] of Object.entries(CORS)) {
        expect(response.headers.get(key)).toBe(value);
      }
    });
  });

  // ── POST ────────────────────────────────────────────────────────────────────

  describe('POST', () => {
    describe('rate limiting', () => {
      it('returns 429 when rate limited', async () => {
        vi.mocked(checkRateLimit).mockResolvedValue({
          allowed: false,
          remaining: 0,
          resetAt: Date.now() + 30_000,
        });

        const response = await POST(mockEvent());

        expect(response.status).toBe(429);
        expect(response.headers.get('Retry-After')).toBeTruthy();
        // Retry-After should be a positive number string
        const retryAfter = Number(response.headers.get('Retry-After'));
        expect(retryAfter).toBeGreaterThanOrEqual(1);
      });

      it('returns CORS headers on 429', async () => {
        vi.mocked(checkRateLimit).mockResolvedValue({
          allowed: false,
          remaining: 0,
          resetAt: Date.now() + 10_000,
        });

        const response = await POST(mockEvent());

        for (const [key, value] of Object.entries(CORS)) {
          expect(response.headers.get(key)).toBe(value);
        }
      });

      it('includes Retry-After as ceiling of seconds remaining', async () => {
        const resetAt = Date.now() + 25_500; // 25.5 seconds from now
        vi.mocked(checkRateLimit).mockResolvedValue({
          allowed: false,
          remaining: 0,
          resetAt,
        });

        const response = await POST(mockEvent());
        const retryAfter = Number(response.headers.get('Retry-After'));
        expect(retryAfter).toBe(26); // ceil(25.5) = 26
      });

      it('uses minimum Retry-After of 1', async () => {
        vi.mocked(checkRateLimit).mockResolvedValue({
          allowed: false,
          remaining: 0,
          resetAt: Date.now() - 100, // already expired but still over limit
        });

        const response = await POST(mockEvent());
        const retryAfter = Number(response.headers.get('Retry-After'));
        expect(retryAfter).toBe(1);
      });
    });

    describe('successful requests', () => {
      it('returns 200 with CORS headers when rate limit passes', async () => {
        vi.mocked(checkRateLimit).mockResolvedValue({
          allowed: true,
          remaining: 9,
          resetAt: Date.now() + 60_000,
        });
        mockHandleRequest.mockResolvedValue(new Response('{"jsonrpc":"2.0","result":{}}', { status: 200 }));

        const response = await POST(mockEvent());

        expect(response.status).toBe(200);
        for (const [key, value] of Object.entries(CORS)) {
          expect(response.headers.get(key)).toBe(value);
        }
      });

      it('delegates to transport handleRequest', async () => {
        vi.mocked(checkRateLimit).mockResolvedValue({
          allowed: true,
          remaining: 9,
          resetAt: Date.now() + 60_000,
        });
        mockHandleRequest.mockResolvedValue(new Response('ok', { status: 200 }));

        const event = mockEvent();
        await POST(event);

        expect(mockHandleRequest).toHaveBeenCalledTimes(1);
        const calledRequest = mockHandleRequest.mock.calls[0][0] as Request;
        // Accept header should be normalized to include text/event-stream
        expect(calledRequest.headers.get('accept')).toContain('text/event-stream');
        expect(calledRequest.headers.get('content-type')).toBe('application/json');
      });
    });

    describe('transport errors', () => {
      it('returns 500 when transport throws', async () => {
        vi.mocked(checkRateLimit).mockResolvedValue({
          allowed: true,
          remaining: 9,
          resetAt: Date.now() + 60_000,
        });
        mockHandleRequest.mockRejectedValue(new Error('transport exploded'));

        const response = await POST(mockEvent());

        expect(response.status).toBe(500);
        const body = await response.text();
        expect(body).toBe('Internal server error');
      });

      it('includes CORS headers on 500', async () => {
        vi.mocked(checkRateLimit).mockResolvedValue({
          allowed: true,
          remaining: 9,
          resetAt: Date.now() + 60_000,
        });
        mockHandleRequest.mockRejectedValue(new Error('boom'));

        const response = await POST(mockEvent());

        for (const [key, value] of Object.entries(CORS)) {
          expect(response.headers.get(key)).toBe(value);
        }
      });
    });

    describe('IP extraction', () => {
      it('uses x-forwarded-for header when present', async () => {
        vi.mocked(checkRateLimit).mockResolvedValue({
          allowed: false,
          remaining: 0,
          resetAt: Date.now() + 60_000,
        });

        const request = new Request('http://localhost:5173/mcp', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': '10.0.0.1, 10.0.0.2',
          },
          body: '{}',
        });

        const event = {
          request,
          getClientAddress: () => '127.0.0.1',
        } as Parameters<typeof POST>[0];

        await POST(event);

        expect(checkRateLimit).toHaveBeenCalledWith('10.0.0.1');
      });

      it('falls back to getClientAddress when no x-forwarded-for', async () => {
        vi.mocked(checkRateLimit).mockResolvedValue({
          allowed: false,
          remaining: 0,
          resetAt: Date.now() + 60_000,
        });

        await POST(mockEvent({ ip: '192.168.1.100' }));

        expect(checkRateLimit).toHaveBeenCalledWith('192.168.1.100');
      });
    });
  });
});
