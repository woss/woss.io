import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Capture the customFetch passed into createOpenAICompatible so the real
// module export path is exercised without exporting internals for tests.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  captured: {} as { fetch?: typeof fetch },
  fetchMock: vi.fn(),
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn((cfg: { name?: string; fetch?: typeof fetch }) => {
    mocks.captured.fetch = cfg.fetch;
    return { name: cfg.name ?? 'provider' };
  }),
}));

vi.mock('$lib/server/logger', () => ({
  CAT: { llm: 'llm' },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Config is a lazy singleton — provider.ts calls config() at module load.
vi.mock('$lib/server/config.js', () => ({
  config: vi.fn(() => ({
    openai: {
      apiKey: 'test-key',
      baseUrl: 'https://opencode.ai/zen/v1',
      model: 'test-model',
      maxTokens: undefined,
      maxResultsLength: 10,
      firstRoundMaxSteps: 5,
      toolClassifyTimeoutMs: 1000,
      toolClassifyModel: undefined,
      relevanceCheckModel: undefined,
      maxRounds: 3,
    },
  })),
}));

import { provider } from './provider.js';

const ZEN_URL = 'https://opencode.ai/zen/v1/chat/completions';
const OTHER_URL = 'https://api.deepseek.com/v1/chat/completions';

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } });
}

describe('provider customFetch', () => {
  beforeEach(() => {
    mocks.fetchMock.mockReset();
    vi.stubGlobal('fetch', mocks.fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('wires customFetch into the provider', () => {
    expect(typeof mocks.captured.fetch).toBe('function');
    expect(provider).toBeDefined();
  });

  it('injects User-Agent opencode/* on Zen endpoint requests', async () => {
    mocks.fetchMock.mockResolvedValue(jsonResponse('{}'));
    const customFetch = mocks.captured.fetch!;

    await customFetch(ZEN_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

    expect(mocks.fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = mocks.fetchMock.mock.calls[0] as [unknown, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('user-agent')).toBe('opencode/*');
    expect(headers.get('content-type')).toBe('application/json');
  });

  it('does NOT inject User-Agent on non-Zen requests', async () => {
    mocks.fetchMock.mockResolvedValue(jsonResponse('{}'));
    const customFetch = mocks.captured.fetch!;

    await customFetch(OTHER_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });

    const [, init] = mocks.fetchMock.mock.calls[0] as [unknown, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('user-agent')).toBeNull();
  });

  it('handles Request-object input without crashing and preserves its headers', async () => {
    mocks.fetchMock.mockResolvedValue(jsonResponse('{}'));
    const customFetch = mocks.captured.fetch!;

    const req = new Request(ZEN_URL, { method: 'POST', headers: { 'x-test': '1' } });
    await expect(customFetch(req)).resolves.toBeInstanceOf(Response);

    const [, init] = mocks.fetchMock.mock.calls[0] as [unknown, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get('user-agent')).toBe('opencode/*');
    expect(headers.get('x-test')).toBe('1');
  });

  it('maps 429 rate limit to 400 to skip SDK retries', async () => {
    mocks.fetchMock.mockResolvedValue(jsonResponse('Rate limit exceeded', 429));
    const customFetch = mocks.captured.fetch!;

    const res = await customFetch(ZEN_URL, { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('passes through non-429 errors untouched', async () => {
    mocks.fetchMock.mockResolvedValue(jsonResponse('nope', 500));
    const customFetch = mocks.captured.fetch!;

    const res = await customFetch(ZEN_URL, { method: 'POST' });
    expect(res.status).toBe(500);
  });
});
