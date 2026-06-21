import { describe, it, expect, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ALL external dependencies BEFORE imports
// ---------------------------------------------------------------------------

vi.mock('$lib/server/openai-provider', () => ({
  chatStreamWithTools: vi.fn(),
  buildRagPrompt: vi.fn().mockReturnValue([{ role: 'system', content: 'test' }]),
}));

vi.mock('$lib/server/chat-events', () => ({
  publishLive: vi.fn(),
  publishPersistent: vi.fn(),
}));

vi.mock('$lib/server/db', () => ({
  ensureModel: vi.fn().mockReturnValue(42),
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      run: vi.fn(),
      all: vi.fn(() => []),
      get: vi.fn(),
      iterate: vi.fn(function* () {}),
    })),
    transaction: vi.fn((fn: (rows: unknown[]) => void) => fn),
  })),
}));

vi.mock('$lib/server/llm-cache', () => ({
  checkCache: vi.fn(),
  storeCache: vi.fn(),
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
    },
    mcp: { servers: [] },
    llmCache: { enabled: false },
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

vi.mock('../prompts', () => ({
  getDoomLoopRecoveryPrompt: vi.fn(() => 'MANDATORY INSTRUCTION: DO NOT call tools. Write text.'),
  getToolClassifierUserPrompt: vi.fn(),
}));

vi.mock('$lib/utils/random-uuid', () => ({
  randomUUID: vi.fn(() => 'test-msg-id'),
}));

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import { ToolCallXmlStripper, streamWithRetry } from './stream';
import type { McpToolDef } from '$lib/server/mcp/tools';
import { chatStreamWithTools } from '$lib/server/openai-provider';
import { publishLive } from '$lib/server/chat-events';
import { Stream } from 'effect';
import type { LLMEvent } from '$lib/server/llm/types';

// ===========================================================================
// ToolCallXmlStripper
// ===========================================================================

describe('ToolCallXmlStripper', () => {
  it('passes normal text through unchanged', () => {
    const s = new ToolCallXmlStripper();
    expect(s.next('Hello world')).toBe('Hello world');
    expect(s.isInside).toBe(false);
  });

  it('strips simple <tool_calls> block', () => {
    const s = new ToolCallXmlStripper();
    const input = 'Before<tool_calls><invoke name="foo"></invoke></tool_calls>After';
    expect(s.next(input)).toBe('BeforeAfter');
    expect(s.isInside).toBe(false);
  });

  it('handles opening tag in one chunk, closing in next', () => {
    const s = new ToolCallXmlStripper();
    expect(s.next('Before<tool_calls>')).toBe('Before');
    expect(s.isInside).toBe(true);
    expect(s.next('still inside')).toBe('');
    expect(s.isInside).toBe(true);
    expect(s.next('</tool_calls>After')).toBe('After');
    expect(s.isInside).toBe(false);
  });

  it('handles both tags in the same chunk', () => {
    const s = new ToolCallXmlStripper();
    const result = s.next('start<tool_calls>data</tool_calls>end');
    expect(result).toBe('startend');
    expect(s.isInside).toBe(false);
  });

  it('drains until end when closing tag is never found', () => {
    const s = new ToolCallXmlStripper();
    expect(s.next('Before<tool_calls>')).toBe('Before');
    expect(s.isInside).toBe(true);
    expect(s.next('more data')).toBe('');
    expect(s.next('even more')).toBe('');
    expect(s.isInside).toBe(true);
  });

  it('handles prefixed variants like <||DMSL||tool_calls>', () => {
    const s = new ToolCallXmlStripper();
    const input = 'text<||DMSL||tool_calls>stuff</||DMSL||tool_calls>more';
    expect(s.next(input)).toBe('textmore');
    expect(s.isInside).toBe(false);
  });

  it('handles empty string', () => {
    const s = new ToolCallXmlStripper();
    expect(s.next('')).toBe('');
    expect(s.isInside).toBe(false);
  });

  it('handles prefixed opening tag in one chunk, prefixed closing in next', () => {
    const s = new ToolCallXmlStripper();
    expect(s.next('start<||EXTRA||tool_calls>')).toBe('start');
    expect(s.isInside).toBe(true);
    expect(s.next('inner')).toBe('');
    expect(s.next('</||EXTRA||tool_calls>end')).toBe('end');
    expect(s.isInside).toBe(false);
  });

  it('isInside returns false for fresh instance', () => {
    const s = new ToolCallXmlStripper();
    expect(s.isInside).toBe(false);
  });

  it('isInside returns true while inside a block', () => {
    const s = new ToolCallXmlStripper();
    s.next('<tool_calls>');
    expect(s.isInside).toBe(true);
    s.next('</tool_calls>');
    expect(s.isInside).toBe(false);
  });
});

// ===========================================================================
// streamWithRetry — success paths
// ===========================================================================

describe('streamWithRetry', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns a successful StreamResult from text-delta events', async () => {
    const events: LLMEvent[] = [
      { type: 'text-delta', text: 'Hello' },
      { type: 'text-delta', text: ' world' },
      { type: 'step-finish', reason: 'stop', toolCalls: 0, textProduced: true },
      {
        type: 'finish',
        reason: 'stop',
        modelName: 'test-model',
        actualModelName: 'test-model-42',
        provider: 'https://api.test.com/v1',
        maxTokens: 4096,
      },
    ];
    vi.mocked(chatStreamWithTools).mockReturnValue(Stream.fromIterable(events));

    const result = await streamWithRetry(
      [{ role: 'user', content: 'Hello' }],
      null,
      'chat-1',
      new AbortController(),
      new Map(),
    );

    expect(result.answerText).toBe('Hello world');
    expect(result.lastError).toBeNull();
    expect(result.partial).toBe(false);
    expect(result.irrecoverable).toBe(false);
    expect(result.anyStepHadToolCalls).toBe(false);
    expect(result.toolLoopDetected).toBe(false);
    expect(result.msgId).toBe('test-msg-id');
    expect(publishLive).toHaveBeenCalledWith('chat-1', 'status', { step: 'generating' });
  });

  it('tracks tool calls when step-finish has toolCalls > 0', async () => {
    // answer text must exceed TINY_TEXT_THRESHOLD (171) to avoid isTinyText retry
    const longLead = 'Let me search. ' + 'x'.repeat(165);
    const events: LLMEvent[] = [
      { type: 'text-delta', text: longLead },
      { type: 'tool-call', id: 'call-1', name: 'search_files', input: { query: 'test' } },
      { type: 'tool-result', id: 'call-1', name: 'search_files', result: 'Results!' },
      { type: 'step-finish', reason: 'tool-calls', toolCalls: 1, textProduced: true },
      { type: 'text-delta', text: 'Found it' },
      { type: 'step-finish', reason: 'stop', toolCalls: 0, textProduced: true },
      {
        type: 'finish',
        reason: 'stop',
        modelName: 'test-model',
        actualModelName: 'test-model-42',
        provider: 'https://api.test.com/v1',
        maxTokens: 4096,
      },
    ];
    vi.mocked(chatStreamWithTools).mockReturnValue(Stream.fromIterable(events));

    const result = await streamWithRetry(
      [{ role: 'user', content: 'Search' }],
      null,
      'chat-1',
      new AbortController(),
      new Map(),
    );

    expect(result.answerText).toContain('Let me search');
    expect(result.answerText).toContain('Found it');
    expect(result.anyStepHadToolCalls).toBe(true);
    expect(result.lastError).toBeNull();
  });

  it('triggers retry on empty answer (Doom loop — tools called, no text)', async () => {
    // First attempt: empty text with tool calls
    const doomEvents: LLMEvent[] = [
      { type: 'tool-call', id: 'call-1', name: 'search', input: {} },
      { type: 'tool-result', id: 'call-1', name: 'search', result: 'data' },
      { type: 'step-finish', reason: 'tool-calls', toolCalls: 1, textProduced: false },
      {
        type: 'finish',
        reason: 'stop',
        modelName: 'test-model',
        actualModelName: 'test-model',
        provider: 'https://api.test.com/v1',
        maxTokens: 4096,
      },
    ];
    // text must exceed TINY_TEXT_THRESHOLD (171) to avoid isTinyText on retry
    const longAnswer = 'Here is the answer. ' + 'x'.repeat(160);
    const okEvents: LLMEvent[] = [
      { type: 'text-delta', text: longAnswer },
      { type: 'step-finish', reason: 'stop', toolCalls: 0, textProduced: true },
      {
        type: 'finish',
        reason: 'stop',
        modelName: 'test-model',
        actualModelName: 'test-model',
        provider: 'https://api.test.com/v1',
        maxTokens: 4096,
      },
    ];

    // With mcpToolDefs set, attempts use chatStreamWithTools with tools.
    // On retry, mcpToolDefs is null → chatStreamWithTools with empty tools.
    vi.mocked(chatStreamWithTools).mockImplementation(
      (_messages: unknown, tools: { length: number } | null | undefined) =>
        (tools?.length ?? 0) > 0 ? Stream.fromIterable(doomEvents) : Stream.fromIterable(okEvents),
    );

    const result = await streamWithRetry(
      [
        { role: 'system', content: 'Answer' },
        { role: 'user', content: 'Question?' },
      ],
      ['tool1'] as unknown as McpToolDef[],
      'chat-2',
      new AbortController(),
      new Map(),
    );

    expect(result.answerText).toContain('Here is the answer');
    // First 2 attempts with tools → doom loop → eventually tools disabled
    expect(chatStreamWithTools).toHaveBeenCalled();
    expect(chatStreamWithTools).toHaveBeenCalled();
  });

  it('detects hallucinated Macula URLs when tools available but not used', async () => {
    const events: LLMEvent[] = [
      { type: 'text-delta', text: 'Check out https://u.macula.link/@woss/photo' },
      { type: 'step-finish', reason: 'stop', toolCalls: 0, textProduced: true },
      {
        type: 'finish',
        reason: 'stop',
        modelName: 'test-model',
        actualModelName: 'test-model',
        provider: 'https://api.test.com/v1',
        maxTokens: 4096,
      },
    ];
    const retryEvents: LLMEvent[] = [
      { type: 'text-delta', text: 'I need to call tools first' },
      { type: 'step-finish', reason: 'stop', toolCalls: 0, textProduced: true },
      {
        type: 'finish',
        reason: 'stop',
        modelName: 'test-model',
        actualModelName: 'test-model',
        provider: 'https://api.test.com/v1',
        maxTokens: 4096,
      },
    ];

    // With mcpToolDefs set, first attempts use chatStreamWithTools with tools.
    // After mcpToolDefs is disabled, chatStreamWithTools with empty tools.
    vi.mocked(chatStreamWithTools).mockImplementation(
      (_messages: unknown, tools: { length: number } | null | undefined) =>
        (tools?.length ?? 0) > 0 ? Stream.fromIterable(events) : Stream.fromIterable(retryEvents),
    );

    const result = await streamWithRetry(
      [
        { role: 'system', content: 'Answer' },
        { role: 'user', content: 'Show photos' },
      ],
      [
        { name: 'traverse', serverId: 'macula', description: 'Macula traverse', inputSchema: {} },
      ] as unknown as McpToolDef[],
      'chat-3',
      new AbortController(),
      new Map([['traverse', 'macula']]),
    );

    // answerText accumulates across retries (including failed hallucination attempts)
    expect(result.answerText).toContain('I need to call tools first');
    expect(result.answerText).toContain('macula.link');
    // Retry succeeded — lastError is reset to null on the successful attempt
    expect(result.lastError).toBeNull();
  });

  it('breaks on non-recoverable error and sets irrecoverable', async () => {
    vi.mocked(chatStreamWithTools).mockImplementation(() => {
      throw new Error('Rate limit exceeded');
    });

    const result = await streamWithRetry(
      [{ role: 'user', content: 'Hello' }],
      null,
      'chat-4',
      new AbortController(),
      new Map(),
    );

    expect(result.irrecoverable).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.lastError).not.toBeNull();
    expect(result.lastError!.message).toContain('Rate limit');
  });

  it('post-processes GitHub references into markdown links', async () => {
    // Regex [a-zA-Z0-9_-]+ doesn't allow dots in repo name
    const events: LLMEvent[] = [
      { type: 'text-delta', text: 'Check out woss/woss-io (#123) for details' },
      { type: 'step-finish', reason: 'stop', toolCalls: 0, textProduced: true },
      {
        type: 'finish',
        reason: 'stop',
        modelName: 'test-model',
        actualModelName: 'test-model',
        provider: 'https://api.test.com/v1',
        maxTokens: 4096,
      },
    ];
    vi.mocked(chatStreamWithTools).mockReturnValue(Stream.fromIterable(events));

    const result = await streamWithRetry(
      [{ role: 'user', content: 'Show PRs' }],
      null,
      'chat-5',
      new AbortController(),
      new Map(),
    );

    expect(result.answerText).toContain('[woss/woss-io#123](https://github.com/woss/woss-io/pull/123)');
  });

  it('detects interim text (3+ transitional phrases, no structural content)', async () => {
    const interimEvents: LLMEvent[] = [
      { type: 'text-delta', text: 'Let me search. Let me check. Let me also look. ' },
      { type: 'step-finish', reason: 'stop', toolCalls: 0, textProduced: true },
      {
        type: 'finish',
        reason: 'stop',
        modelName: 'test-model',
        actualModelName: 'test-model',
        provider: 'https://api.test.com/v1',
        maxTokens: 4096,
      },
    ];
    const okEvents: LLMEvent[] = [
      { type: 'text-delta', text: 'Here are the PRs I found. Open: 3, Closed: 10.' },
      { type: 'step-finish', reason: 'stop', toolCalls: 0, textProduced: true },
      {
        type: 'finish',
        reason: 'stop',
        modelName: 'test-model',
        actualModelName: 'test-model',
        provider: 'https://api.test.com/v1',
        maxTokens: 4096,
      },
    ];

    vi.mocked(chatStreamWithTools).mockImplementation(
      (_messages: unknown, tools: { length: number } | null | undefined) =>
        (tools?.length ?? 0) > 0 ? Stream.fromIterable(interimEvents) : Stream.fromIterable(okEvents),
    );

    const result = await streamWithRetry(
      [
        { role: 'system', content: 'Answer' },
        { role: 'user', content: 'Question?' },
      ],
      ['tool1'] as unknown as McpToolDef[],
      'chat-6',
      new AbortController(),
      new Map(),
    );

    expect(result.answerText).toContain('Here are the PRs');
    // Must have tried with tools first, then retried without tools
    expect(chatStreamWithTools).toHaveBeenCalled();
    expect(chatStreamWithTools).toHaveBeenCalled();
  });

  it('passes through legitimate text with transitional intro', async () => {
    const events: LLMEvent[] = [
      {
        type: 'text-delta',
        text: 'Let me explain how the data flows work. The system processes requests asynchronously.',
      },
      { type: 'step-finish', reason: 'stop', toolCalls: 0, textProduced: true },
      {
        type: 'finish',
        reason: 'stop',
        modelName: 'test-model',
        actualModelName: 'test-model',
        provider: 'https://api.test.com/v1',
        maxTokens: 4096,
      },
    ];
    vi.mocked(chatStreamWithTools).mockReturnValue(Stream.fromIterable(events));

    const result = await streamWithRetry(
      [{ role: 'user', content: 'Explain' }],
      null,
      'chat-7',
      new AbortController(),
      new Map(),
    );

    expect(result.answerText).toContain('Let me explain');
    expect(result.lastError).toBeNull();
    expect(result.partial).toBe(false);
  });

  it('passes through text with structural content despite transitional phrases', async () => {
    const events: LLMEvent[] = [
      {
        type: 'text-delta',
        text: 'Let me search. Let me check. Let me also look. Here are results:\n| Type | Count |\n|------|-------|\n| Open | 3 |',
      },
      { type: 'step-finish', reason: 'stop', toolCalls: 0, textProduced: true },
      {
        type: 'finish',
        reason: 'stop',
        modelName: 'test-model',
        actualModelName: 'test-model',
        provider: 'https://api.test.com/v1',
        maxTokens: 4096,
      },
    ];
    vi.mocked(chatStreamWithTools).mockReturnValue(Stream.fromIterable(events));

    const result = await streamWithRetry(
      [{ role: 'user', content: 'Show PRs' }],
      null,
      'chat-8',
      new AbortController(),
      new Map(),
    );

    expect(result.answerText).toContain('Type | Count');
    expect(result.lastError).toBeNull();
  });
});
