import { browser } from '$app/environment';
import { SvelteSet, SvelteDate } from 'svelte/reactivity';

/* ─── Types ─── */

export interface SSECallbacks {
  onToken: (token: string) => void;
  onDone: (data: {
    messageId: string;
    answer: string;
    queryType: string;
    sources: unknown[];
    usage: { tokensIn: number; tokensOut: number; durationMs: number };
    completedToolCalls: Array<{
      id: string;
      name: string;
      serverId: string;
      startedAt: string;
      finishedAt: string | null;
      durationMs: number | null;
    }>;
  }) => void;
  onError: (data: { messageId?: string; message: string; irrecoverable?: boolean; attemptsLeft?: number }) => void;
  onContactIntent: () => void;
  onTimeout: () => void;
}

/* ─── Reactive State ─── */

class ChatSSEState {
  streamingToolCalls = $state<
    Record<string, { id: string; name: string; serverId: string; startedAt: number; finishedAt?: number }>
  >({});
  currentStatus = $state<string>('');
}
export const sseState = new ChatSSEState();

/* ─── Non-reactive State ─── */

export const seenErrorMsgIds = new SvelteSet<string>();
let sseTimeout: ReturnType<typeof setTimeout> | undefined;
let es: EventSource | null = null;
let generation = 0;

/* ─── Derived (getters — no $derived in module exports) ─── */

export function getStreamingToolValues() {
  return Object.values(sseState.streamingToolCalls);
}
export function getActiveToolCount() {
  return getStreamingToolValues().filter((t: { finishedAt?: number }) => !t.finishedAt).length;
}
export function getCompletedToolCount() {
  return getStreamingToolValues().filter((t: { finishedAt?: number }) => t.finishedAt).length;
}

/* ─── Reset ─── */

export function resetStreamingState(): void {
  sseState.streamingToolCalls = {};
  sseState.currentStatus = '';
}

/* ─── Disconnect ─── */

export function disconnectSSE(): void {
  clearTimeout(sseTimeout);
  if (es) {
    es.close();
    es = null;
  }
  resetStreamingState();
}

/* ─── Connect ─── */

export function connectSSE(chatId: string, callbacks: SSECallbacks): () => void {
  if (!browser) return () => {};

  const currentGen = ++generation;
  es = new EventSource(`/api/ask/${chatId}`);

  const resetSseTimeout = () => {
    clearTimeout(sseTimeout);
    sseTimeout = setTimeout(() => {
      es?.close();
      callbacks.onTimeout();
    }, 120000);
  };
  resetSseTimeout();

  es.addEventListener('token', (e: MessageEvent) => {
    if (currentGen !== generation) return;
    resetSseTimeout();
    if (typeof e.data !== 'string') return;
    const data = (() => {
      try {
        return JSON.parse(e.data);
      } catch {
        return {};
      }
    })();
    callbacks.onToken(data.token);
  });

  es.addEventListener('done', (e: MessageEvent) => {
    if (currentGen !== generation) return;
    clearTimeout(sseTimeout);
    if (typeof e.data !== 'string') return;
    const data = (() => {
      try {
        return JSON.parse(e.data);
      } catch {
        return {};
      }
    })();
    if (typeof data.messageId !== 'string') return;

    const completedToolCalls = Object.values(sseState.streamingToolCalls).map((tc) => ({
      id: tc.id,
      name: tc.name,
      serverId: tc.serverId,
      startedAt: new SvelteDate(tc.startedAt).toISOString(),
      finishedAt: tc.finishedAt ? new SvelteDate(tc.finishedAt).toISOString() : null,
      durationMs: tc.finishedAt ? tc.finishedAt - tc.startedAt : null,
    }));

    callbacks.onDone({
      messageId: data.messageId,
      answer: data.answer || '',
      queryType: data.queryType || '',
      sources: data.sources || [],
      usage: data.usage || { tokensIn: 0, tokensOut: 0, durationMs: 0 },
      completedToolCalls,
    });
  });

  es.addEventListener('contact_intent', () => {
    if (currentGen !== generation) return;
    callbacks.onContactIntent();
  });

  es.addEventListener('tool_call_start', (e: MessageEvent) => {
    if (currentGen !== generation) return;
    resetSseTimeout();
    if (typeof e.data !== 'string') return;
    const data = (() => {
      try {
        return JSON.parse(e.data);
      } catch {
        return {};
      }
    })();
    sseState.streamingToolCalls = {
      ...sseState.streamingToolCalls,
      [data.id]: {
        id: data.id,
        name: data.name,
        serverId: data.serverId,
        startedAt: data.startedAt ?? Date.now(),
      },
    };
  });

  es.addEventListener('tool_call_end', (e: MessageEvent) => {
    if (currentGen !== generation) return;
    resetSseTimeout();
    if (typeof e.data !== 'string') return;
    const data = (() => {
      try {
        return JSON.parse(e.data);
      } catch {
        return {};
      }
    })();
    const existing = sseState.streamingToolCalls[data.id];
    if (existing) {
      sseState.streamingToolCalls = {
        ...sseState.streamingToolCalls,
        [data.id]: { ...existing, finishedAt: Date.now() },
      };
    }
  });

  es.addEventListener('status', (e: MessageEvent) => {
    if (currentGen !== generation) return;
    if (typeof e.data !== 'string') return;
    const data = (() => {
      try {
        return JSON.parse(e.data);
      } catch {
        return {};
      }
    })();
    sseState.currentStatus = data.step || '';
  });

  es.addEventListener('error', (e: MessageEvent) => {
    if (currentGen !== generation) return;
    clearTimeout(sseTimeout);
    if (typeof e.data !== 'string') return;
    const data = (() => {
      try {
        return JSON.parse(e.data);
      } catch {
        return {};
      }
    })();

    if (typeof data.messageId === 'string') {
      if (seenErrorMsgIds.has(data.messageId)) return;
      seenErrorMsgIds.add(data.messageId);
    }

    callbacks.onError({
      messageId: data.messageId,
      message: data.message || 'An error occurred',
      irrecoverable: data.irrecoverable === true,
      attemptsLeft: data.attemptsLeft,
    });
  });

  es.onerror = () => {
    console.error('EventSource connection error, will auto-reconnect');
  };

  return () => {
    clearTimeout(sseTimeout);
    if (es) {
      es.close();
      es = null;
    }
  };
}
