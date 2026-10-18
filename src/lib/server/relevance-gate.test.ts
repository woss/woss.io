import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks declared BEFORE imports (lazy vi.mock) — matches chat-helpers.test.ts
// ---------------------------------------------------------------------------

const configMock = {
  openai: {
    apiKey: 'test-key',
    relevanceGate: {
      provider: 'jev' as const,
      url: 'https://opencode.ai/inference/systemone/v1/systemone',
      model: 'jev-1.13-free',
      threshold: 0.5,
    },
  },
};

vi.mock('$lib/server/config', () => ({
  config: vi.fn(() => configMock),
}));

vi.mock('$lib/server/logger', () => ({
  CAT: { chat: 'chat' },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { jevRelevanceCheck } from './relevance-gate';

function mockJevResponse(noul: unknown) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ answers: { is_relevant: { type: 'noul', noul } } }),
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  configMock.openai.relevanceGate = {
    provider: 'jev',
    url: 'https://opencode.ai/inference/systemone/v1/systemone',
    model: 'jev-1.13-free',
    threshold: 0.5,
  };
});

describe('jevRelevanceCheck', () => {
  it('returns true when noul >= threshold', async () => {
    mockJevResponse(0.95);

    await expect(jevRelevanceCheck('What projects has Daniel built?', undefined)).resolves.toBe(true);
  });

  it('returns false when noul < threshold', async () => {
    mockJevResponse(0.05);

    await expect(jevRelevanceCheck('Who won the football match?', undefined)).resolves.toBe(false);
  });

  it('uses >= (noul exactly at threshold is relevant)', async () => {
    mockJevResponse(0.5);

    await expect(jevRelevanceCheck('Tell me about Daniel', undefined)).resolves.toBe(true);
  });

  it('sends model, noul question, instructions and criteria to the Jev endpoint', async () => {
    mockJevResponse(0.9);

    await jevRelevanceCheck('What is your stack?', undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://opencode.ai/inference/systemone/v1/systemone');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('jev-1.13-free');
    expect(body.questions.is_relevant.type).toBe('noul');
    expect(body.questions.is_relevant.instructions).toContain("Daniel Maricic's professional portfolio");
    expect(body.questions.is_relevant.criteria.true).toBeTruthy();
    expect(body.questions.is_relevant.criteria.false).toBeTruthy();
  });

  it('puts the question in state.message and context in state.recent_history', async () => {
    mockJevResponse(0.9);

    await jevRelevanceCheck('and his career?', 'user: hi\nassistant: hello');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.state.message).toBe('and his career?');
    expect(body.state.recent_history).toBe('user: hi\nassistant: hello');
  });

  it('omits state.recent_history when no context', async () => {
    mockJevResponse(0.9);

    await jevRelevanceCheck('What is Woss?', undefined);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.state.message).toBe('What is Woss?');
    expect(body.state).not.toHaveProperty('recent_history');
  });

  it('forwards the caller signal to fetch', async () => {
    mockJevResponse(0.9);
    const controller = new AbortController();

    await jevRelevanceCheck('hello', undefined, controller.signal);

    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('throws on non-OK response (caller fail-opens)', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    await expect(jevRelevanceCheck('hello', undefined)).rejects.toThrow('jev HTTP 503');
  });

  it('throws when answers.is_relevant is missing', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    await expect(jevRelevanceCheck('hello', undefined)).rejects.toThrow('noul');
  });

  it('throws when noul is malformed', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ answers: { is_relevant: { type: 'noul', noul: 'high' } } }),
    });

    await expect(jevRelevanceCheck('hello', undefined)).rejects.toThrow('noul');
  });
});
