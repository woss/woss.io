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

import { mergeSameRole, buildRagPrompt, mapFinishReason, isAvailable } from './openai-provider';
import type { ChatMessage } from './openai-provider';

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
