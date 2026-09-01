import { describe, it, expect, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ALL external dependencies BEFORE imports
// ---------------------------------------------------------------------------

vi.mock('$lib/server/chat-events', () => ({
  publishLive: vi.fn(),
  publishPersistent: vi.fn(),
}));

const mockService = vi.hoisted(() => ({
  updateMessage: vi.fn().mockResolvedValue(undefined),
  addMessage: vi.fn().mockResolvedValue('fallback-msg-id'),
}));

vi.mock('$lib/server/db-service', () => ({
  getDbService: vi.fn(() => ({
    updateMessage: mockService.updateMessage,
    addMessage: mockService.addMessage,
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

vi.mock('$lib/server/llm-cache', () => ({
  storeCache: vi.fn(),
}));

vi.mock('$lib/server/config', () => ({
  config: vi.fn(() => ({
    llmCache: { enabled: true },
  })),
}));

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import { saveAndEmitResult } from './save-result';
import type { SaveResultParams } from './save-result';
import { getDbService } from '$lib/server/db-service';
import { publishPersistent } from '$lib/server/chat-events';
import { storeCache } from '$lib/server/llm-cache';

// ===========================================================================
// saveAndEmitResult
// ===========================================================================

const baseParams: SaveResultParams = {
  userId: 'user-1',
  chatId: 'chat-1',
  userAgentId: undefined,
  answerText: 'Hello world!',
  reasoningText: 'Thinking...',
  sources: [{ title: 'Source 1', score: 0.1, slug: 'src-1', url: '/posts/src-1' }],
  currentModelId: 42,
  tokenUsage: { promptTokens: 10, completionTokens: 20 },
  responseMs: 150,
  maxTokens: 4096,
  partial: false,
  lastError: null,
  msgId: 'msg-1',
  cacheEmbeddingData: [0.1, 0.2, 0.3],
  cacheText: 'original query',
  ragChunks: [{ title: 'Chunk 1', text: '...', score: 0.1, slug: 'chunk-1', type: 'post' }],
  queryType: 'rag',
  startTime: 0,
  irrecoverable: false,
  toolCalls: [],
};

describe('saveAndEmitResult', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  // =======================================================================
  // Success path
  // =======================================================================

  it('calls updateMessage with all success fields on happy path', async () => {
    await saveAndEmitResult(baseParams);

    expect(getDbService().updateMessage).toHaveBeenCalledWith('msg-1', {
      content: 'Hello world!',
      sources: JSON.stringify(baseParams.sources),
      reasoning: 'Thinking...',
      modelId: 42,
      tokensIn: 10,
      tokensOut: 20,
      durationMs: 150,
      maxTokens: 4096,
    });
  });

  it('emits done SSE event with correct payload on success', async () => {
    await saveAndEmitResult(baseParams);

    expect(publishPersistent).toHaveBeenCalledWith('chat-1', 'done', {
      answer: 'Hello world!',
      reasoning: 'Thinking...',
      sources: baseParams.sources,
      messageId: 'msg-1',
      queryType: 'rag',
      usage: {
        chunks: 1,
        totalTime: expect.any(Number),
        modelId: 42,
        tokensIn: 10,
        tokensOut: 20,
        durationMs: 150,
      },
    });
  });

  it('stores cache when llmCache is enabled and not partial', async () => {
    await saveAndEmitResult(baseParams);

    expect(storeCache).toHaveBeenCalledWith(
      [0.1, 0.2, 0.3],
      'original query',
      'Hello world!',
      JSON.stringify(baseParams.sources),
      'msg-1',
      [],
    );
  });

  it('skips cache store when partial is true', async () => {
    await saveAndEmitResult({ ...baseParams, partial: true });

    expect(storeCache).not.toHaveBeenCalled();
  });

  it('links context references in answer text before saving', async () => {
    const params: SaveResultParams = {
      ...baseParams,
      answerText: 'See [Context 1] for details.',
      ragChunks: [{ title: 'Post', text: '...', score: 0.1, slug: 'my-post', type: 'post' }],
    };

    await saveAndEmitResult(params);

    expect(getDbService().updateMessage).toHaveBeenCalledWith(
      'msg-1',
      expect.objectContaining({
        content: 'See [Context 1](/posts/my-post) for details.',
      }),
    );
  });

  it('links experience context references (parens stripped by regex)', async () => {
    const params: SaveResultParams = {
      ...baseParams,
      answerText: 'See ([Context 1]) for details.',
      ragChunks: [{ title: 'Exp', text: '...', score: 0.1, slug: 'my-exp', type: 'experience' }],
    };

    await saveAndEmitResult(params);

    expect(getDbService().updateMessage).toHaveBeenCalledWith(
      'msg-1',
      expect.objectContaining({
        content: 'See [Context 1](/experience/my-exp) for details.',
      }),
    );
  });

  it('does not link context references when no chunks', async () => {
    const params: SaveResultParams = {
      ...baseParams,
      answerText: 'See [Context 1] for details.',
      ragChunks: [],
    };

    await saveAndEmitResult(params);

    expect(getDbService().updateMessage).toHaveBeenCalledWith(
      'msg-1',
      expect.objectContaining({
        content: 'See [Context 1] for details.',
      }),
    );
  });

  // =======================================================================
  // Error path (lastError && !partial)
  // =======================================================================

  it('calls updateMessage with error fields when lastError set and not partial', async () => {
    const params: SaveResultParams = {
      ...baseParams,
      lastError: new Error('API error'),
      partial: false,
      answerText: 'Partial answer',
    };

    await saveAndEmitResult(params);

    expect(getDbService().updateMessage).toHaveBeenCalledWith('msg-1', {
      content: 'Partial answer',
      reasoning: 'Thinking...',
      error: 'Failed to generate answer after retries',
    });
    expect(publishPersistent).toHaveBeenCalledWith('chat-1', 'error', {
      message: 'Failed to generate answer after retries',
      messageId: 'msg-1',
      irrecoverable: false,
    });
  });

  it('uses fallback text when answerText is empty in error path', async () => {
    const params: SaveResultParams = {
      ...baseParams,
      lastError: new Error('API error'),
      partial: false,
      answerText: '',
    };

    await saveAndEmitResult(params);

    expect(getDbService().updateMessage).toHaveBeenCalledWith('msg-1', {
      content: "I'm sorry, I wasn't able to generate a response. Please try rephrasing your question.",
      reasoning: 'Thinking...',
      error: 'Failed to generate answer after retries',
    });
  });

  it('does NOT enter error path when lastError is null (success path runs)', async () => {
    await saveAndEmitResult(baseParams);

    expect(getDbService().updateMessage).toHaveBeenCalledWith(
      'msg-1',
      expect.objectContaining({
        content: 'Hello world!',
        sources: expect.any(String),
      }),
    );
    // Should NOT have error field in success path
    const callArgs = vi.mocked(getDbService().updateMessage).mock.calls[0][1];
    expect(callArgs).not.toHaveProperty('error');
  });

  // =======================================================================
  // irrecoverable flag
  // =======================================================================

  it('sets irrecoverable flag on error SSE event when irrecoverable=true', async () => {
    const params: SaveResultParams = {
      ...baseParams,
      lastError: new Error('Fatal'),
      partial: false,
      answerText: '',
      irrecoverable: true,
    };

    await saveAndEmitResult(params);

    expect(publishPersistent).toHaveBeenCalledWith('chat-1', 'error', {
      message: 'Failed to generate answer after retries',
      messageId: 'msg-1',
      irrecoverable: true,
    });
  });
});
