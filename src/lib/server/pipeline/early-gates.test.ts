import { describe, it, expect, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ALL external dependencies BEFORE imports
// ---------------------------------------------------------------------------

vi.mock('$lib/server/db', () => ({
  addMessage: vi.fn(() => 'msg-id'),
  getChatMessageCount: vi.fn(() => 5),
  getMessages: vi.fn(() => []),
  lockChat: vi.fn(),
  getOffTopicCount: vi.fn(() => 0),
  incrementOffTopicCount: vi.fn(() => 1),
}));

vi.mock('$lib/server/embed', () => ({
  embedText: vi.fn(),
}));

vi.mock('$lib/server/llm-cache', () => ({
  checkCache: vi.fn(),
  storeCache: vi.fn(),
}));

vi.mock('$lib/server/chat-events', () => ({
  publishLive: vi.fn(),
  publishPersistent: vi.fn(),
}));

vi.mock('$lib/server/webhooks', () => ({
  callWebhook: vi.fn(),
  callErrorWebhook: vi.fn(),
}));

vi.mock('$lib/server/config', () => ({
  config: vi.fn(() => ({
    maculaNickname: 'woss',
    app: { origin: 'http://localhost:5173' },
    openai: {
      apiKey: 'test-key',
      baseUrl: 'https://api.test.com/v1',
      model: 'test-model',
      maxTokens: 4096,
      maxResultsLength: 10000,
      firstRoundMaxSteps: 5,
      maxRounds: 10,
      toolClassifyTimeoutMs: 5000,
      toolClassifyModel: undefined,
      relevanceCheckModel: undefined,
    },
    mcp: { servers: [] },
    llmCache: { enabled: true },
    report: { webhookUrl: '', webhookToken: '', errorWebhookUrl: '' },
  })),
}));

vi.mock('$lib/server/logger', () => ({
  CAT: { chat: 'chat', llm: 'llm', api: 'api', search: 'search', content: 'content', db: 'db' },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('$lib/server/chat-helpers', () => ({
  generatePoliteResponse: vi.fn(),
  isRelevant: vi.fn(),
  needsGithubTools: vi.fn().mockResolvedValue(false),
  needsMaculaTools: vi.fn().mockResolvedValue(false),
  tryRenameChat: vi.fn(),
  parseSources: vi.fn(),
}));

vi.mock('./tool-classifier', () => ({
  classifyToolNeeds: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import { handleEarlyGates } from './early-gates';
import type { StoredMessage } from '$lib/server/db';
import { getMessages, addMessage, lockChat, incrementOffTopicCount } from '$lib/server/db';
import { embedText } from '$lib/server/embed';
import { checkCache } from '$lib/server/llm-cache';
import { publishLive, publishPersistent } from '$lib/server/chat-events';
import { callWebhook } from '$lib/server/webhooks';
import { isRelevant, generatePoliteResponse, needsGithubTools, needsMaculaTools } from '$lib/server/chat-helpers';

// ===========================================================================
// handleEarlyGates
// ===========================================================================

describe('handleEarlyGates', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // Off-topic paths
  // -----------------------------------------------------------------------

  it('rejects off-topic question with attempts left (< 3 strikes)', async () => {
    vi.mocked(getMessages).mockReturnValue([
      { role: 'user', content: 'Previous question' },
    ] as unknown as StoredMessage[]);
    vi.mocked(needsGithubTools).mockResolvedValue(false);
    vi.mocked(needsMaculaTools).mockResolvedValue(false);
    vi.mocked(isRelevant).mockResolvedValue(false);
    vi.mocked(incrementOffTopicCount).mockReturnValue(1);

    const result = await handleEarlyGates(
      'What is the weather?',
      'chat-1',
      'user-1',
      new AbortController(),
      undefined,
      Date.now(),
    );

    expect(result).toEqual({ handled: true });
    expect(isRelevant).toHaveBeenCalled();
    expect(incrementOffTopicCount).toHaveBeenCalledWith('chat-1');
    expect(addMessage).toHaveBeenCalled();
    expect(publishPersistent).toHaveBeenCalledWith('chat-1', 'error', expect.objectContaining({ attemptsLeft: 2 }));
    expect(lockChat).not.toHaveBeenCalled();
  });

  it('locks chat after 3 off-topic strikes', async () => {
    vi.mocked(getMessages).mockReturnValue([
      { role: 'user', content: 'Previous question' },
    ] as unknown as StoredMessage[]);
    vi.mocked(needsGithubTools).mockResolvedValue(false);
    vi.mocked(needsMaculaTools).mockResolvedValue(false);
    vi.mocked(isRelevant).mockResolvedValue(false);
    vi.mocked(incrementOffTopicCount).mockReturnValue(3);

    const result = await handleEarlyGates(
      'Tell me about sports',
      'chat-2',
      'user-1',
      new AbortController(),
      undefined,
      Date.now(),
    );

    expect(result).toEqual({ handled: true });
    expect(lockChat).toHaveBeenCalledWith('chat-2');
    expect(callWebhook).toHaveBeenCalledWith(expect.objectContaining({ type: 'chatLocked' }));
    expect(publishPersistent).toHaveBeenCalledWith('chat-2', 'error', expect.objectContaining({ irrecoverable: true }));
  });

  // -----------------------------------------------------------------------
  // Tool intent bypasses relevance check
  // -----------------------------------------------------------------------

  it('skips relevance check when tool intent detected via keywords', async () => {
    vi.mocked(getMessages).mockReturnValue([{ role: 'user', content: 'Show repos' }] as unknown as StoredMessage[]);
    vi.mocked(needsGithubTools).mockResolvedValue(true);
    // Ensure we don't reach the isRelevant call
    vi.mocked(isRelevant).mockRejectedValue(new Error('should not be called'));
    vi.mocked(embedText).mockResolvedValue({ data: [0.1, 0.2], dimensions: 2 });

    const result = await handleEarlyGates(
      'Show me your repos',
      'chat-3',
      'user-1',
      new AbortController(),
      undefined,
      Date.now(),
    );

    // Should pass through to the embedding step since tool intent detected
    expect(result).toMatchObject({ handled: false, embedding: { data: [0.1, 0.2], dimensions: 2 } });
    expect(isRelevant).not.toHaveBeenCalled();
  });

  it('skips relevance check for /summarize commands', async () => {
    vi.mocked(getMessages).mockReturnValue([{ role: 'user', content: 'Old question' }] as unknown as StoredMessage[]);
    vi.mocked(isRelevant).mockRejectedValue(new Error('should not be called'));
    vi.mocked(embedText).mockResolvedValue({ data: [0.5, 0.6], dimensions: 2 });

    const result = await handleEarlyGates(
      '/summarize',
      'chat-4',
      'user-1',
      new AbortController(),
      undefined,
      Date.now(),
    );

    expect(result).toMatchObject({ handled: false });
    expect(isRelevant).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Polite-only path
  // -----------------------------------------------------------------------

  it('returns polite response for thank-you messages', async () => {
    vi.mocked(getMessages).mockReturnValue([]);
    vi.mocked(generatePoliteResponse).mockResolvedValue('You are welcome!');

    const result = await handleEarlyGates(
      'thank you!',
      'chat-5',
      'user-1',
      new AbortController(),
      undefined,
      Date.now(),
    );

    expect(result).toEqual({ handled: true });
    expect(generatePoliteResponse).toHaveBeenCalledWith('thank you!', expect.any(AbortSignal));
    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: 'You are welcome!' }),
    );
    expect(publishPersistent).toHaveBeenCalledWith(
      'chat-5',
      'done',
      expect.objectContaining({ answer: 'You are welcome!' }),
    );
  });

  it('uses fallback when polite response generation fails', async () => {
    vi.mocked(getMessages).mockReturnValue([]);
    vi.mocked(generatePoliteResponse).mockRejectedValue(new Error('LLM error'));

    const result = await handleEarlyGates('thanks', 'chat-6', 'user-1', new AbortController(), undefined, Date.now());

    expect(result).toEqual({ handled: true });
    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('welcome'),
      }),
    );
  });

  // -----------------------------------------------------------------------
  // Embedding error path
  // -----------------------------------------------------------------------

  it('returns handled: true when embedding fails', async () => {
    vi.mocked(getMessages).mockReturnValue([{ role: 'user', content: 'A question' }] as unknown as StoredMessage[]);
    vi.mocked(needsGithubTools).mockResolvedValue(false);
    vi.mocked(needsMaculaTools).mockResolvedValue(false);
    vi.mocked(isRelevant).mockResolvedValue(true);
    vi.mocked(embedText).mockRejectedValue(new Error('ONNX runtime error'));

    const result = await handleEarlyGates(
      'What is your name?',
      'chat-7',
      'user-1',
      new AbortController(),
      undefined,
      Date.now(),
    );

    expect(result).toEqual({ handled: true });
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ error: 'Failed to generate embedding' }));
    expect(publishPersistent).toHaveBeenCalledWith(
      'chat-7',
      'error',
      expect.objectContaining({ message: 'Failed to generate embedding' }),
    );
  });

  // -----------------------------------------------------------------------
  // Cache hit path
  // -----------------------------------------------------------------------

  it('returns cached answer on cache hit when cache enabled', async () => {
    vi.mocked(getMessages).mockReturnValue([{ role: 'user', content: 'Old question' }] as unknown as StoredMessage[]);
    vi.mocked(needsGithubTools).mockResolvedValue(false);
    vi.mocked(needsMaculaTools).mockResolvedValue(false);
    vi.mocked(isRelevant).mockResolvedValue(true);
    vi.mocked(embedText).mockResolvedValue({ data: [0.1, 0.2, 0.3], dimensions: 3 });
    vi.mocked(checkCache).mockReturnValueOnce({
      answer: 'Cached answer',
      sources: '[{"title":"Source"}]',
      toolCalls: [],
    });

    const result = await handleEarlyGates(
      'What is your name?',
      'chat-8',
      'user-1',
      new AbortController(),
      undefined,
      Date.now(),
    );

    expect(result).toEqual({ handled: true });
    expect(addMessage).toHaveBeenCalledWith(expect.objectContaining({ content: 'Cached answer' }));
    expect(publishPersistent).toHaveBeenCalledWith(
      'chat-8',
      'done',
      expect.objectContaining({ answer: 'Cached answer' }),
    );
    expect(publishLive).not.toHaveBeenCalledWith('chat-8', 'tool_call_start', expect.anything());
  });

  it('emits tool call events on cache hit when cached data has tool calls', async () => {
    vi.mocked(getMessages).mockReturnValue([{ role: 'user', content: 'Old question' }] as unknown as StoredMessage[]);
    vi.mocked(needsGithubTools).mockResolvedValue(false);
    vi.mocked(needsMaculaTools).mockResolvedValue(false);
    vi.mocked(isRelevant).mockResolvedValue(true);
    vi.mocked(embedText).mockResolvedValue({ data: [0.1, 0.2, 0.3], dimensions: 3 });
    vi.mocked(checkCache).mockReturnValueOnce({
      answer: 'Cached with tools',
      sources: '[]',
      toolCalls: [
        { name: 'traverse', serverId: 'macula' },
        { name: 'get_file', serverId: 'macula' },
      ],
    });

    const result = await handleEarlyGates(
      'Show me files',
      'chat-9',
      'user-1',
      new AbortController(),
      undefined,
      Date.now(),
    );

    expect(result).toEqual({ handled: true });

    // Should emit tool_call_start for each cached tool call
    expect(publishLive).toHaveBeenCalledWith(
      'chat-9',
      'tool_call_start',
      expect.objectContaining({ name: 'traverse', serverId: 'macula' }),
    );
    expect(publishLive).toHaveBeenCalledWith(
      'chat-9',
      'tool_call_start',
      expect.objectContaining({ name: 'get_file', serverId: 'macula' }),
    );

    // Should emit tool_call_end for each cached tool call
    expect(publishLive).toHaveBeenCalledWith('chat-9', 'tool_call_end', expect.objectContaining({ name: 'traverse' }));
    expect(publishLive).toHaveBeenCalledWith('chat-9', 'tool_call_end', expect.objectContaining({ name: 'get_file' }));

    // Should still emit done event with answer
    expect(publishPersistent).toHaveBeenCalledWith(
      'chat-9',
      'done',
      expect.objectContaining({ answer: 'Cached with tools' }),
    );
  });

  // -----------------------------------------------------------------------
  // All gates pass
  // -----------------------------------------------------------------------

  it('returns embedding, messages, and history when all gates pass', async () => {
    vi.mocked(getMessages).mockReturnValue([
      { role: 'user', content: 'Previous question', sources: '' },
      { role: 'assistant', content: 'Previous answer', sources: '' },
    ] as unknown as StoredMessage[]);
    vi.mocked(needsGithubTools).mockResolvedValue(false);
    vi.mocked(needsMaculaTools).mockResolvedValue(false);
    vi.mocked(isRelevant).mockResolvedValue(true);
    vi.mocked(embedText).mockResolvedValue({ data: [0.1, 0.2, 0.3], dimensions: 3 });

    const result = await handleEarlyGates(
      'What is your name?',
      'chat-9',
      'user-1',
      new AbortController(),
      undefined,
      Date.now(),
    );

    expect(result).toEqual({
      handled: false,
      embedding: { data: [0.1, 0.2, 0.3], dimensions: 3 },
      cacheEmbeddingData: [0.1, 0.2, 0.3],
      cacheText: 'What is your name?',
      ctxMessages: [
        { role: 'user', content: 'Previous question', sources: '' },
        { role: 'assistant', content: 'Previous answer', sources: '' },
      ],
      history: [
        { role: 'user', content: 'Previous question' },
        { role: 'assistant', content: 'Previous answer' },
      ],
      classifyResult: undefined,
    });
  });
});
