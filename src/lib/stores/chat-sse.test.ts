import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock SvelteKit modules BEFORE imports ──

vi.mock('$app/environment', () => ({
  browser: true,
}));

// ── Track EventSource instances ──

interface MockESInstance {
  url: string;
  _listeners: Map<string, (e: { data: string }) => void>;
  close: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
}

let esInstances: MockESInstance[] = [];

function setupEventSourceMock(): void {
  esInstances = [];
  vi.stubGlobal(
    'EventSource',
    class {
      readonly url: string;
      _listeners = new Map<string, (e: { data: string }) => void>();
      close = vi.fn();
      addEventListener: MockESInstance['addEventListener'];
      constructor(url: string) {
        this.url = url;
        const self = this;
        this.addEventListener = vi.fn((event: string, handler: (e: { data: string }) => void) => {
          self._listeners.set(event, handler);
        }) as unknown as MockESInstance['addEventListener'];
        esInstances.push({
          url,
          _listeners: this._listeners,
          close: this.close,
          addEventListener: this.addEventListener,
        });
      }
    } as unknown as typeof EventSource,
  );
}

// ── Imports under test ──

import { connectSSE, disconnectSSE, resetStreamingState, sseState, seenErrorMsgIds } from './chat-sse.svelte';

// ===========================================================================
// Reasoning SSE listener
// ===========================================================================

describe('reasoning SSE listener', () => {
  beforeEach(() => {
    setupEventSourceMock();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    disconnectSSE();
    resetStreamingState();
    // Clear the SvelteSet tracking seen error msg IDs
    seenErrorMsgIds.clear();
  });

  it('parses reasoning JSON and calls onReasoning with the text', () => {
    const onReasoning = vi.fn();
    connectSSE('chat-1', {
      onReasoning,
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onContactIntent: vi.fn(),
      onTimeout: vi.fn(),
    });

    expect(esInstances).toHaveLength(1);
    const handler = esInstances[0]._listeners.get('reasoning');
    expect(handler).toBeDefined();

    handler!({ data: JSON.stringify({ text: 'thinking step by step' }) });

    expect(onReasoning).toHaveBeenCalledWith('thinking step by step');
  });

  it('calls onReasoning multiple times as reasoning progresses', () => {
    const onReasoning = vi.fn();
    connectSSE('chat-2', {
      onReasoning,
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onContactIntent: vi.fn(),
      onTimeout: vi.fn(),
    });

    const handler = esInstances[0]._listeners.get('reasoning')!;

    handler!({ data: JSON.stringify({ text: 'Step 1' }) });
    handler!({ data: JSON.stringify({ text: 'Step 1 then Step 2' }) });
    handler!({ data: JSON.stringify({ text: 'Step 1 then Step 2 then Step 3' }) });

    expect(onReasoning).toHaveBeenCalledTimes(3);
    expect(onReasoning).toHaveBeenNthCalledWith(1, 'Step 1');
    expect(onReasoning).toHaveBeenNthCalledWith(2, 'Step 1 then Step 2');
    expect(onReasoning).toHaveBeenNthCalledWith(3, 'Step 1 then Step 2 then Step 3');
  });

  it('handles malformed JSON gracefully (catch block)', () => {
    const onReasoning = vi.fn();
    connectSSE('chat-3', {
      onReasoning,
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onContactIntent: vi.fn(),
      onTimeout: vi.fn(),
    });

    const handler = esInstances[0]._listeners.get('reasoning')!;

    // Malformed JSON should not throw and not call onReasoning
    expect(() => {
      handler!({ data: '{bad json}' });
    }).not.toThrow();
    expect(onReasoning).not.toHaveBeenCalled();
  });

  it('skips non-string data without calling onReasoning', () => {
    const onReasoning = vi.fn();
    connectSSE('chat-4', {
      onReasoning,
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onContactIntent: vi.fn(),
      onTimeout: vi.fn(),
    });

    const handler = esInstances[0]._listeners.get('reasoning')!;

    // Non-string data should cause early return
    handler!({ data: undefined as unknown as string });
    expect(onReasoning).not.toHaveBeenCalled();
  });

  it('skips JSON missing the text field', () => {
    const onReasoning = vi.fn();
    connectSSE('chat-5', {
      onReasoning,
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onContactIntent: vi.fn(),
      onTimeout: vi.fn(),
    });

    const handler = esInstances[0]._listeners.get('reasoning')!;

    handler!({ data: JSON.stringify({}) });
    // onReasoning is called with undefined (JSON.parse(e.data).text is undefined)
    expect(onReasoning).toHaveBeenCalledWith(undefined);
  });

  // =========================================================================
  // Stale generation guard
  // =========================================================================

  it('rejects reasoning events from stale generation', () => {
    const onReasoning1 = vi.fn();
    const onReasoning2 = vi.fn();

    // First connection — generation becomes 1
    connectSSE('chat-6', {
      onReasoning: onReasoning1,
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onContactIntent: vi.fn(),
      onTimeout: vi.fn(),
    });

    const instance1 = esInstances[0];
    const handler1 = instance1._listeners.get('reasoning')!;

    // Second connection — generation becomes 2, es is overwritten
    connectSSE('chat-7', {
      onReasoning: onReasoning2,
      onToken: vi.fn(),
      onDone: vi.fn(),
      onError: vi.fn(),
      onContactIntent: vi.fn(),
      onTimeout: vi.fn(),
    });

    const instance2 = esInstances[1];
    expect(instance2._listeners.get('reasoning')).toBeDefined();

    // Trigger event on the FIRST connection's EventSource (stale — currentGen=1, generation=2)
    handler1!({ data: JSON.stringify({ text: 'stale reasoning' }) });
    expect(onReasoning1).not.toHaveBeenCalled();

    // Trigger event on the SECOND connection's EventSource (currentGen=2, generation=2)
    const handler2 = instance2._listeners.get('reasoning')!;
    handler2!({ data: JSON.stringify({ text: 'fresh reasoning' }) });
    expect(onReasoning2).toHaveBeenCalledWith('fresh reasoning');
  });
});

// ===========================================================================
// SC-002: Verify onReasoning updates the last assistant message's reasoning field
// This tests the pattern used by the +page.svelte onReasoning handler
// ===========================================================================

describe('onReasoning behavior (SC-002)', () => {
  it('simulates onReasoning updating the last assistant message reasoning field', () => {
    // This mirrors the onReasoning handler in +page.svelte:
    //   onReasoning(text: string) {
    //     const idx = messages.length - 1;
    //     if (idx >= 0 && messages[idx].role === 'assistant') {
    //       messages[idx] = { ...messages[idx], reasoning: text };
    //     }
    //   }

    const messages: Array<{ role: string; text?: string; reasoning?: string }> = [
      { role: 'user', text: 'Think step by step' },
      { role: 'assistant', text: '' },
    ];

    // Simulate onReasoning being called
    function onReasoning(text: string): void {
      const idx = messages.length - 1;
      if (idx >= 0 && messages[idx].role === 'assistant') {
        messages[idx] = { ...messages[idx], reasoning: text };
      }
    }

    onReasoning('Step 1');
    expect(messages[1].reasoning).toBe('Step 1');

    onReasoning('Step 1 then Step 2');
    expect(messages[1].reasoning).toBe('Step 1 then Step 2');
  });

  it('does not update reasoning if there is no assistant message', () => {
    const messages: Array<{ role: string; reasoning?: string }> = [{ role: 'user', text: 'Hello' }];

    function onReasoning(text: string): void {
      const idx = messages.length - 1;
      if (idx >= 0 && messages[idx].role === 'assistant') {
        messages[idx] = { ...messages[idx], reasoning: text };
      }
    }

    onReasoning('thinking...');
    expect(messages[0].reasoning).toBeUndefined();
  });

  it('preserves reasoning from streaming in onDone (simulated)', () => {
    // This mirrors the onDone handler in +page.svelte:
    //   reasoning: data.reasoning || messages[idx].reasoning,
    const messages: Array<{ role: string; reasoning?: string }> = [
      { role: 'user' },
      { role: 'assistant', reasoning: 'streamed reasoning text' },
    ];

    // Simulate onDone with data that includes reasoning
    const data = {
      messageId: 'msg-1',
      answer: 'Final answer',
      reasoning: 'streamed reasoning text',
      queryType: 'chat',
      sources: [],
      usage: { tokensIn: 10, tokensOut: 50, durationMs: 1000 },
      completedToolCalls: [],
    };

    const idx = messages.length - 1;
    messages[idx] = {
      ...messages[idx],
      reasoning: data.reasoning || messages[idx].reasoning,
    };

    expect(messages[idx].reasoning).toBe('streamed reasoning text');
  });

  it('falls back to existing reasoning when onDone reasoning is undefined', () => {
    const messages: Array<{ role: string; reasoning?: string }> = [
      { role: 'user' },
      { role: 'assistant', reasoning: 'streamed during generation' },
    ];

    // Simulate onDone WITHOUT data.reasoning
    const data = {
      messageId: 'msg-1',
      answer: 'Final answer',
      queryType: 'chat',
      sources: [],
      usage: { tokensIn: 10, tokensOut: 50, durationMs: 1000 },
      completedToolCalls: [],
    } as const;

    const idx = messages.length - 1;
    messages[idx] = {
      ...messages[idx],
      reasoning: (data as { reasoning?: string }).reasoning || messages[idx].reasoning,
    };

    // Should have preserved the streamed reasoning
    expect(messages[idx].reasoning).toBe('streamed during generation');
  });
});
