import { describe, it, expect, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock external dependencies BEFORE imports
// ---------------------------------------------------------------------------

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

vi.mock('./logger', () => ({
  CAT: { llm: 'llm', chat: 'chat', search: 'search', content: 'content', db: 'db', api: 'api' },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('./llm/provider', () => ({
  provider: vi.fn(() => ({})),
  modelName: 'test-model',
}));

vi.mock('$lib/server/prompts', () => ({
  getSystemPrompt: vi.fn(() => 'You are a helpful test assistant.'),
}));

vi.mock('$lib/server/sanitize', () => ({
  sanitizeText: vi.fn((x: string) => x),
}));

vi.mock('ai', () => ({
  jsonSchema: vi.fn(),
  streamText: vi.fn(),
}));

import {
  mergeSameRole,
  buildRagPrompt,
  mapFinishReason,
  isAvailable,
  toModelMessages,
  chatStreamWithTools,
} from './openai-provider';
import type { ChatMessage } from './openai-provider';
import { Effect, Stream } from 'effect';
import { streamText } from 'ai';

describe('mergeSameRole', () => {
  it('leaves alternating roles unchanged', () => {
    const input: ChatMessage[] = [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'What is your name?' },
    ];
    const result = mergeSameRole(input);
    expect(result).toEqual(input);
  });

  it('returns input unchanged (merge disabled for DeepSeek V4 Flash compatibility)', () => {
    const input: ChatMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'First question' },
      { role: 'user', content: 'Second question' },
    ];
    const result = mergeSameRole(input);
    expect(result).toEqual(input);
  });

  it('returns input unchanged for consecutive assistant messages', () => {
    const input: ChatMessage[] = [
      { role: 'assistant', content: 'Part one' },
      { role: 'assistant', content: 'Part two' },
    ];
    const result = mergeSameRole(input);
    expect(result).toEqual(input);
  });

  it('returns input unchanged for multiple same-role messages', () => {
    const input: ChatMessage[] = [
      { role: 'user', content: 'A' },
      { role: 'user', content: 'B' },
      { role: 'user', content: 'C' },
    ];
    const result = mergeSameRole(input);
    expect(result).toEqual(input);
  });

  it('does not merge consecutive system messages (system is excluded)', () => {
    const input: ChatMessage[] = [
      { role: 'system', content: 'System one' },
      { role: 'system', content: 'System two' },
      { role: 'user', content: 'User message' },
    ];
    const result = mergeSameRole(input);
    // system messages are NOT merged (because msg.role !== 'system' check)
    expect(result).toEqual([
      { role: 'system', content: 'System one' },
      { role: 'system', content: 'System two' },
      { role: 'user', content: 'User message' },
    ]);
  });

  it('handles empty array', () => {
    const input: ChatMessage[] = [];
    const result = mergeSameRole(input);
    expect(result).toEqual([]);
  });

  it('handles single message', () => {
    const input: ChatMessage[] = [{ role: 'user', content: 'Only one' }];
    const result = mergeSameRole(input);
    expect(result).toEqual(input);
  });

  it('real-world scenario: system + consecutive user messages returned as-is', () => {
    // This is the exact scenario that broke Mistral 14B:
    // system → user(history) → user(new question)
    const input: ChatMessage[] = [
      { role: 'system', content: 'System with RAG context...' },
      { role: 'user', content: 'What does Daniel do?' },
      { role: 'user', content: 'Tell me more about his experience' },
    ];
    const result = mergeSameRole(input);
    expect(result).toEqual(input);
  });

  it('does not mutate original array', () => {
    const input: ChatMessage[] = [
      { role: 'user', content: 'A' },
      { role: 'user', content: 'B' },
      { role: 'assistant', content: 'C' },
    ];
    const copy = [...input];
    mergeSameRole(input);
    expect(input).toEqual(copy);
  });
});

// ===========================================================================
// mapFinishReason
// ===========================================================================

describe('mapFinishReason', () => {
  it('maps "stop" to "stop"', () => {
    expect(mapFinishReason('stop')).toBe('stop');
  });

  it('maps "tool-calls" to "tool-calls"', () => {
    expect(mapFinishReason('tool-calls')).toBe('tool-calls');
  });

  it('maps "error" to "error"', () => {
    expect(mapFinishReason('error')).toBe('error');
  });

  it('maps "length" to "length"', () => {
    expect(mapFinishReason('length')).toBe('length');
  });

  it('maps "unknown" to "unknown"', () => {
    expect(mapFinishReason('unknown')).toBe('unknown');
  });

  it('maps arbitrary string to "unknown"', () => {
    expect(mapFinishReason('some_other_reason')).toBe('unknown');
  });

  it('maps empty string to "unknown"', () => {
    expect(mapFinishReason('')).toBe('unknown');
  });
});

// ===========================================================================
// buildRagPrompt
// ===========================================================================

describe('buildRagPrompt', () => {
  it('builds a prompt with question only (no chunks, no history)', () => {
    const messages = buildRagPrompt('What is your name?', []);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('test assistant');
    expect(messages[1]).toEqual({ role: 'user', content: 'What is your name?' });
  });

  it('includes RAG chunks as context when provided', () => {
    const chunks = [
      { title: 'About', text: 'Daniel is a developer.', score: 0.95 },
      { title: 'Projects', text: 'He built woss.io.', score: 0.85 },
    ];
    const messages = buildRagPrompt('Tell me about Daniel', chunks);
    expect(messages).toHaveLength(2);
    expect(messages[0].content).toContain('Context:');
    expect(messages[0].content).toContain('[1] From "About"');
    expect(messages[0].content).toContain('[2] From "Projects"');
    expect(messages[0].content).toContain('Daniel is a developer.');
    expect(messages[0].content).toContain('He built woss.io.');
  });

  it('includes chat history when provided', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: 'Previous question' },
      { role: 'assistant', content: 'Previous answer' },
    ];
    const messages = buildRagPrompt('Follow-up question', [], history);
    expect(messages).toHaveLength(4);
    expect(messages[1]).toEqual({ role: 'user', content: 'Previous question' });
    expect(messages[2]).toEqual({ role: 'assistant', content: 'Previous answer' });
    expect(messages[3]).toEqual({ role: 'user', content: 'Follow-up question' });
  });

  it('filters out system and tool messages from history', () => {
    const history: ChatMessage[] = [
      { role: 'system', content: 'System message' },
      { role: 'user', content: 'Real question' },
      { role: 'assistant', content: 'Real answer' },
      { role: 'tool', content: 'Tool result' },
    ];
    const messages = buildRagPrompt('New question', [], history);
    // system prompt + user + assistant + user = 4
    expect(messages).toHaveLength(4);
    expect(messages[0].role).toBe('system');
    expect(messages[1]).toEqual({ role: 'user', content: 'Real question' });
    expect(messages[2]).toEqual({ role: 'assistant', content: 'Real answer' });
    expect(messages[3]).toEqual({ role: 'user', content: 'New question' });
  });

  it('merges same role messages (delegates to mergeSameRole)', () => {
    // Two consecutive user messages should remain as-is per current implementation
    const history: ChatMessage[] = [
      { role: 'user', content: 'First' },
      { role: 'user', content: 'Second' },
    ];
    const messages = buildRagPrompt('Third', [], history);
    // system + user + user + user = 4 messages
    expect(messages).toHaveLength(4);
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toBe('First');
    expect(messages[2].role).toBe('user');
    expect(messages[2].content).toBe('Second');
  });

  it('handles empty chunks array', () => {
    const messages = buildRagPrompt('Hello', []);
    expect(messages[0].content).not.toContain('Context:');
  });

  it('truncates history to last MAX_HISTORY_MESSAGES (10) when overflow', () => {
    const history: ChatMessage[] = [];
    for (let i = 0; i < 15; i++) {
      history.push({ role: 'user', content: `User message ${i}` });
      history.push({ role: 'assistant', content: `Assistant message ${i}` });
    }
    // 15 pairs = 30 messages, only last 10 kept via slice(-10): indices 20-29
    const messages = buildRagPrompt('Final question', [], history);
    // system + 10 history + user = 12 messages
    expect(messages).toHaveLength(12);
    // First history message (index 20 of 30): User message 10
    expect(messages[1].content).toBe('User message 10');
    expect(messages[2].content).toBe('Assistant message 10');
    // Last history message (index 29 of 30): Assistant message 14
    expect(messages[10].content).toBe('Assistant message 14');
    expect(messages[11]).toEqual({ role: 'user', content: 'Final question' });
  });
});

// ===========================================================================
// isAvailable
// ===========================================================================

describe('isAvailable', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns true when API responds OK', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ data: [{ id: 'test-model' }] }),
      }),
    );
    const result = await isAvailable();
    expect(result).toBe(true);
  });

  it('returns false when API responds with error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    const result = await isAvailable();
    expect(result).toBe(false);
  });

  it('returns false when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
    const result = await isAvailable();
    expect(result).toBe(false);
  });
});

// ===========================================================================
// toModelMessages
// ===========================================================================

describe('toModelMessages', () => {
  it('maps assistant message with reasoning to reasoning + text content array', () => {
    const messages: ChatMessage[] = [{ role: 'assistant', content: 'Answer text', reasoning: 'Reasoning trace' }];
    const result = toModelMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Reasoning trace' },
        { type: 'text', text: 'Answer text' },
      ],
    });
  });

  it('maps assistant message without reasoning to plain content string', () => {
    const messages: ChatMessage[] = [{ role: 'assistant', content: 'Plain answer' }];
    const result = toModelMessages(messages);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ role: 'assistant', content: 'Plain answer' });
  });

  it('maps user, system, and tool messages unchanged', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Hello' },
      { role: 'tool', content: 'Tool output', tool_call_id: 'call_1' },
    ];
    const result = toModelMessages(messages);
    expect(result).toEqual([
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'Hello' },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call_1',
            toolName: '',
            output: { type: 'text', value: 'Tool output' },
          },
        ],
      },
    ]);
  });

  it('keeps plain string content when reasoning is an empty string (falsy)', () => {
    const messages: ChatMessage[] = [{ role: 'assistant', content: 'Answer text', reasoning: '' }];
    const result = toModelMessages(messages);
    expect(result).toEqual([{ role: 'assistant', content: 'Answer text' }]);
  });

  it('maps assistant with reasoning and empty text content to reasoning + empty text parts', () => {
    const messages: ChatMessage[] = [{ role: 'assistant', content: '', reasoning: 'Reasoning only' }];
    const result = toModelMessages(messages);
    expect(result).toEqual([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'Reasoning only' },
          { type: 'text', text: '' },
        ],
      },
    ]);
  });

  it('ignores the reasoning field on non-assistant roles', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Hello', reasoning: 'Should be ignored' },
      { role: 'system', content: 'System', reasoning: 'Should be ignored' },
    ];
    const result = toModelMessages(messages);
    expect(result).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'system', content: 'System' },
    ]);
  });
});

// ===========================================================================
// chatStreamWithTools — reasoning round-trip (runRound reconstruction)
// ===========================================================================

type MockStreamChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-call'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-result'; toolCallId: string; toolName: string; output: unknown };

type MockStreamTextParams = {
  model?: unknown;
  messages?: unknown;
  allowSystemInMessages?: boolean;
  abortSignal?: unknown;
  temperature?: number;
  maxTokens?: number;
  tools?: unknown;
  maxSteps?: number;
  onChunk?: (info: { chunk: MockStreamChunk }) => void;
  onError?: (info: { error: unknown }) => void;
  onFinish?: (event: {
    finishReason?: string;
    usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
    response?: { modelId?: string };
  }) => void;
};

interface MockRoundOptions {
  textDeltas?: string[];
  reasoningDeltas?: string[];
  toolCalls?: Array<{ toolCallId: string; toolName: string; input: unknown }>;
  toolResults?: Array<{ toolCallId: string; toolName: string; output: unknown }>;
  finishReason?: string;
  capture?: (params: MockStreamTextParams) => void;
}

const streamTextMock = vi.mocked(streamText) as unknown as {
  mockImplementationOnce: (impl: (params: MockStreamTextParams) => { text: Promise<string> }) => unknown;
  mockReset: () => unknown;
};

function mockStreamTextRound(options: MockRoundOptions): void {
  streamTextMock.mockImplementationOnce((params) => {
    options.capture?.(params);
    // runRound destructures `({ chunk })` from the onChunk callback argument,
    // matching the real AI SDK contract: onChunk({ chunk: <stream part> })
    for (const text of options.textDeltas ?? []) {
      params.onChunk?.({ chunk: { type: 'text-delta', text } });
    }
    for (const text of options.reasoningDeltas ?? []) {
      params.onChunk?.({ chunk: { type: 'reasoning-delta', text } });
    }
    for (const tc of options.toolCalls ?? []) {
      params.onChunk?.({ chunk: { type: 'tool-call', ...tc } });
    }
    for (const tr of options.toolResults ?? []) {
      params.onChunk?.({ chunk: { type: 'tool-result', ...tr } });
    }
    params.onFinish?.({
      finishReason: options.finishReason ?? 'stop',
      usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
      response: { modelId: 'test-model' },
    });
    return { text: Promise.resolve('') };
  });
}

describe('chatStreamWithTools reasoning round-trip', () => {
  afterEach(() => {
    vi.clearAllMocks();
    streamTextMock.mockReset();
  });

  async function collect(messages: ChatMessage[]): Promise<Array<{ type: string } & Record<string, unknown>>> {
    const stream = chatStreamWithTools(messages, []);
    const chunk = await Effect.runPromise(Stream.runCollect(stream));
    return Array.from(chunk as unknown as Iterable<{ type: string } & Record<string, unknown>>);
  }

  it('accumulates reasoning-delta chunks and carries reasoning onto the continue-with-tools assistant message', async () => {
    let round2Params: MockStreamTextParams | undefined;

    mockStreamTextRound({
      textDeltas: ['Querying the database now.'],
      reasoningDeltas: ['Let me reason', ' about the query'],
      toolCalls: [{ toolCallId: 'call_1', toolName: 'search', input: { q: 'paris' } }],
      toolResults: [{ toolCallId: 'call_1', toolName: 'search', output: { text: 'db result' } }],
      finishReason: 'tool-calls',
    });
    mockStreamTextRound({
      textDeltas: ['Here is the final answer.'],
      finishReason: 'stop',
      capture: (p) => {
        round2Params = p;
      },
    });

    const events = await collect([{ role: 'user', content: 'What is the capital of France?' }]);

    // client reasoning-delta events still emitted, one per chunk (not accumulated)
    const reasoningEvents = events.filter((e) => e.type === 'reasoning-delta');
    expect(reasoningEvents.map((e) => e.text)).toEqual(['Let me reason', ' about the query']);

    // Round 2 received the reconstructed assistant message with reasoning part first
    const round2Messages = round2Params?.messages as Array<Record<string, unknown>>;
    expect(round2Messages).toBeDefined();
    expect(round2Messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Let me reason about the query' },
        { type: 'text', text: 'Querying the database now.' },
        { type: 'tool-call', toolCallId: 'call_1', toolName: 'search', input: { q: 'paris' } },
      ],
    });
    expect(round2Messages[2]).toMatchObject({ role: 'tool' });

    // stream completed normally with a stop finish event
    const finishEvents = events.filter((e) => e.type === 'finish');
    expect(finishEvents).toHaveLength(1);
    expect(finishEvents[0]).toMatchObject({ reason: 'stop' });
  });

  it('carries reasoning onto the forced-final-round assistant message (interim text path, tools dropped)', async () => {
    let round2Params: MockStreamTextParams | undefined;

    mockStreamTextRound({
      // 3+ interim phrases ("let me", "i'll", "i should") without structural content → interim round
      textDeltas: ["Let me search. I'll fetch. I should verify."],
      reasoningDeltas: ['Step through', ' options'],
      toolCalls: [{ toolCallId: 'call_2', toolName: 'lookup', input: { key: 'x' } }],
      toolResults: [{ toolCallId: 'call_2', toolName: 'lookup', output: 'data' }],
      finishReason: 'tool-calls',
    });
    mockStreamTextRound({
      textDeltas: ['Done.'],
      finishReason: 'stop',
      capture: (p) => {
        round2Params = p;
      },
    });

    const events = await collect([{ role: 'user', content: 'Find the answer' }]);

    const round2Messages = round2Params?.messages as Array<Record<string, unknown>>;
    expect(round2Messages[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'reasoning', text: 'Step through options' },
        { type: 'text', text: "Let me search. I'll fetch. I should verify." },
        { type: 'tool-call', toolCallId: 'call_2', toolName: 'lookup', input: { key: 'x' } },
      ],
    });
    // forced final round runs WITHOUT tools
    expect(round2Params?.tools).toBeUndefined();
    expect(events.filter((e) => e.type === 'reasoning-delta').map((e) => e.text)).toEqual(['Step through', ' options']);
  });

  it('hard-stops instead of recursing forever when the forced-final (no-tools) round still emits tool calls', async () => {
    let round2Params: MockStreamTextParams | undefined;
    let callCount = 0;

    // Round 1: interim round (3+ interim phrases) with tool calls → schedules the
    // forced-final round and flips the forcedFinal flag.
    mockStreamTextRound({
      textDeltas: ["Let me search. I'll fetch. I should verify."],
      toolCalls: [{ toolCallId: 'call_1', toolName: 'lookup', input: { key: 'x' } }],
      toolResults: [{ toolCallId: 'call_1', toolName: 'lookup', output: 'data' }],
      finishReason: 'tool-calls',
      capture: () => {
        callCount += 1;
      },
    });
    // Round 2: forced-final round runs WITHOUT tools but the model STILL emits a
    // tool call (the runaway-loop scenario from production logs). The hard-stop
    // guard must resolve the stream instead of recursing forever.
    mockStreamTextRound({
      textDeltas: ["Let me check. I'll retry. I should fetch more."],
      toolCalls: [{ toolCallId: 'call_2', toolName: 'lookup', input: { key: 'y' } }],
      toolResults: [{ toolCallId: 'call_2', toolName: 'lookup', output: 'data2' }],
      finishReason: 'tool-calls',
      capture: (p) => {
        round2Params = p;
        callCount += 1;
      },
    });

    const events = await collect([{ role: 'user', content: 'Find the answer' }]);

    // Only 2 streamText calls happened — no unbounded recursion.
    expect(callCount).toBe(2);
    // The forced-final round was scheduled without tools.
    expect(round2Params?.tools).toBeUndefined();
    // Stream still terminated cleanly with a single finish event.
    const finishEvents = events.filter((e) => e.type === 'finish');
    expect(finishEvents).toHaveLength(1);
  });
});
