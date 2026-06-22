import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

// Mock all external dependencies
vi.mock('$lib/server/db', () => ({
  searchChunks: vi.fn(),
}));

vi.mock('$lib/server/embed', () => ({
  embedText: vi.fn(),
}));

vi.mock('$lib/server/openai-provider', () => ({
  isAvailable: vi.fn(),
}));

vi.mock('$lib/server/rate-limiter', () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
  CAT: { search: 'search' },
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  }),
}));

import { searchChunks } from '$lib/server/db';
import { embedText } from '$lib/server/embed';
import { isAvailable } from '$lib/server/openai-provider';
import { checkRateLimit } from '$lib/server/rate-limiter';
import { GET } from './+server';

function buildEvent(searchParams?: Record<string, string>, ip?: string): RequestEvent {
  const url = new URL('http://localhost');
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }
  const headers = new Map<string, string>();
  if (ip) headers.set('x-forwarded-for', ip);

  return {
    params: {},
    request: new Request('http://localhost', { headers: Object.fromEntries(headers) as Record<string, string> }),
    getClientAddress: () => '127.0.0.1',
    url,
    cookies: {} as unknown,
    locals: {},
    setHeaders: () => {},
    isDataRequest: false,
    isSubRequest: false,
    route: { id: 'api/search' },
    fetch: vi.fn(),
    platform: undefined,
    tracing: { enabled: false, root: {} as unknown, current: {} as unknown },
    isRemoteRequest: false,
  } as unknown as RequestEvent;
}

interface MockChunk {
  id: string;
  text: string;
  title: string;
  date: string | null;
  tags: string[];
  section: string;
  slug: string;
  embedding: number[];
  type: 'post' | 'experience';
}

interface MockSearchResult {
  chunk: MockChunk;
  score: number;
}

const mockSearchResult = (overrides: Partial<MockSearchResult> = {}): MockSearchResult => ({
  chunk: {
    id: 'chunk-1',
    text: 'Sample text content',
    title: 'Sample Title',
    date: '2025-01-15',
    tags: ['test', 'sample'],
    section: 'documentation',
    slug: 'sample-title',
    embedding: [0.1, 0.2, 0.3],
    type: 'post',
  },
  score: 0.85,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 9, resetAt: Date.now() + 60_000 });
  vi.mocked(isAvailable).mockResolvedValue(true);
  vi.mocked(embedText).mockResolvedValue({ data: [0.1, 0.2, 0.3], dimensions: 3 });
  vi.mocked(searchChunks).mockReturnValue([mockSearchResult()]);
});

describe('GET /api/search', () => {
  describe('validation', () => {
    it('returns 400 when q param is missing', async () => {
      const res = await GET(buildEvent({}));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Query parameter 'q' is required");
      expect(json.results).toEqual([]);
    });

    it('returns 400 when q param is empty string', async () => {
      const res = await GET(buildEvent({ q: '' }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Query parameter 'q' is required");
    });

    it('returns 400 when query sanitizes to empty (HTML only)', async () => {
      const res = await GET(buildEvent({ q: '<div></div>' }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Query parameter 'q' is required");
    });

    it('returns 400 when query sanitizes to empty (whitespace)', async () => {
      const res = await GET(buildEvent({ q: '   ' }));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("Query parameter 'q' is required");
    });
  });

  describe('rate limiting', () => {
    it('returns 429 when rate limit exceeded', async () => {
      const now = Date.now();
      vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAt: now + 60_000 });

      const res = await GET(buildEvent({ q: 'test' }));
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toBe('Rate limit exceeded');
      expect(json.results).toEqual([]);
      expect(res.headers.get('Retry-After')).toBeDefined();
    });
  });

  describe('AI service availability', () => {
    it('returns 503 when AI service is unreachable', async () => {
      vi.mocked(isAvailable).mockResolvedValue(false);

      const res = await GET(buildEvent({ q: 'test' }));
      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toBe('Search unavailable — AI service not reachable');
      expect(json.results).toEqual([]);
    });
  });

  describe('query processing', () => {
    it('strips HTML tags from query', async () => {
      await GET(buildEvent({ q: '<b>test</b> query' }));
      expect(embedText).toHaveBeenCalledWith('test query');
    });

    it('truncates query to 200 characters', async () => {
      const longQuery = 'a'.repeat(300);
      await GET(buildEvent({ q: longQuery }));
      expect(embedText).toHaveBeenCalledWith('a'.repeat(200));
    });
  });

  describe('type filtering', () => {
    it('passes type filter when type=post', async () => {
      await GET(buildEvent({ q: 'test', type: 'post' }));
      expect(searchChunks).toHaveBeenCalledWith(expect.any(Array), 216, 'post');
    });

    it('passes type filter when type=experience', async () => {
      await GET(buildEvent({ q: 'test', type: 'experience' }));
      expect(searchChunks).toHaveBeenCalledWith(expect.any(Array), 216, 'experience');
    });

    it('omits type filter for invalid type values', async () => {
      await GET(buildEvent({ q: 'test', type: 'invalid' }));
      expect(searchChunks).toHaveBeenCalledWith(expect.any(Array), 216, undefined);
    });
  });

  describe('response formatting', () => {
    it('filters out results with score >= 1.5', async () => {
      const highScoreResult = mockSearchResult({ score: 2.0 });
      vi.mocked(searchChunks).mockReturnValue([
        mockSearchResult({ score: 0.5 }),
        highScoreResult,
        mockSearchResult({ score: 1.0 }),
      ]);

      const res = await GET(buildEvent({ q: 'test' }));
      const json = await res.json();
      expect(json.results).toHaveLength(2);
      expect(json.results[0].score).toBe(0.5);
      expect(json.results[1].score).toBe(1.0);
    });

    it('strips internal fields from chunk response', async () => {
      const res = await GET(buildEvent({ q: 'test' }));
      const json = await res.json();
      const result = json.results[0];

      expect(result.chunk).toEqual({
        id: 'chunk-1',
        text: 'Sample text content',
        title: 'Sample Title',
        date: '2025-01-15',
        tags: ['test', 'sample'],
        section: 'documentation',
      });
      expect(result.chunk).not.toHaveProperty('slug');
      expect(result.chunk).not.toHaveProperty('embedding');
      expect(result.chunk).not.toHaveProperty('type');
    });

    it('returns 200 with empty results when no matches', async () => {
      vi.mocked(searchChunks).mockReturnValue([]);

      const res = await GET(buildEvent({ q: 'nonexistent' }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.results).toEqual([]);
    });
  });

  describe('headers', () => {
    it('sets no-store cache control', async () => {
      const res = await GET(buildEvent({ q: 'test' }));
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(res.headers.get('Content-Type')).toBe('application/json');
    });
  });
});
