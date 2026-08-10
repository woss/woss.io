// @vitest-environment happy-dom

// Polyfill for svelte transitions in happy-dom
// Svelte 5 uses requestAnimationFrame for transition驱动的 animations
if (typeof globalThis.requestAnimationFrame === 'function') {
  const origRAF = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const rv = origRAF(cb);
    // Also fire synchronously so transition completion callbacks are invoked
    cb(performance.now());
    return rv;
  };
}
// Polyfill element.animate for happy-dom
if (typeof Element !== 'undefined' && !Element.prototype.animate) {
  Element.prototype.animate = () =>
    ({
      finished: Promise.resolve(),
      play: () => {},
      cancel: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      playbackRate: 1,
    }) as unknown as Animation;
}

import { describe, it, expect, vi, afterEach } from 'vitest';

// Mock _both_ svelte and the svelte-version module to force modern Svelte 5 path
vi.mock('svelte', async () => {
  const client = await import('svelte/internal/client');
  // Import server for shared exports
  const server = await import('svelte');
  return {
    // Spread server for shared exports like getAbortSignal, context fns, etc
    ...server,
    // Override browser-only APIs from client build
    mount: client.mount,
    unmount: client.unmount,
    flushSync: client.flush ?? client.flushSync,
    tick: client.tick,
    hydrate: client.hydrate,
    settled: client.settled,
    onMount: server.onMount,
    onDestroy: server.onDestroy,
  };
});

vi.mock('@testing-library/svelte-core/svelte-version', () => ({
  IS_MODERN_SVELTE: true,
}));

// Mock svelte/transition to be instant (0 duration) so
// happy-dom doesn't need a CSS engine to fire transitionend
vi.mock('svelte/transition', () => ({
  slide: () => ({ duration: 0, css: () => '' }),
}));

// Mock $app/state for SvelteKit page store
vi.mock('$app/state', () => ({
  page: {
    data: { queryParams: {} },
  },
}));

// Mock sv5ui components to avoid mode-watcher .svelte resolution issue
vi.mock('sv5ui', () => ({
  Button: (props: any) => props.children?.(),
  Input: () => '',
  Tooltip: (props: any) => props.children?.(),
  AvatarGroup: () => '',
}));

import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import ChatMessage from './ChatMessage.svelte';
import type { ChatMessage as ChatMessageType } from '$lib/chat/types';

function createMessage(overrides: Partial<ChatMessageType> = {}): ChatMessageType {
  return {
    id: 'msg-1',
    role: 'assistant',
    text: 'Hello world',
    reasoning: undefined,
    timestamp: Date.now(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('ChatMessage reasoning accordion', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not render reasoning section when message.reasoning is undefined', () => {
    render(ChatMessage, {
      props: {
        message: createMessage({ reasoning: undefined }),
      },
    });

    expect(screen.queryByText(/Show reasoning/i)).toBeNull();
    expect(screen.queryByText(/Hide reasoning/i)).toBeNull();
    expect(screen.queryByText(/chars/i)).toBeNull();
  });

  it('does not render reasoning section when message.reasoning is empty string', () => {
    render(ChatMessage, {
      props: {
        message: createMessage({ reasoning: '' }),
      },
    });

    expect(screen.queryByText(/Show reasoning/i)).toBeNull();
    expect(screen.queryByText(/Hide reasoning/i)).toBeNull();
  });

  it('renders reasoning toggle button when message.reasoning is present', () => {
    render(ChatMessage, {
      props: {
        message: createMessage({ reasoning: 'Step 1: Think about the problem' }),
      },
    });

    expect(screen.getByText(/Show reasoning/i)).toBeTruthy();
  });

  it('shows reasoning content after clicking toggle', async () => {
    render(ChatMessage, {
      props: {
        message: createMessage({ reasoning: 'Step 1: Think about the problem\nStep 2: Solve it' }),
      },
    });

    const toggle = screen.getByText(/Show reasoning/i);
    await fireEvent.click(toggle);

    expect(screen.getByText(/Hide reasoning/i)).toBeTruthy();
    expect(screen.getByText(/Step 1: Think about the problem/)).toBeTruthy();
    expect(screen.getByText(/Step 2: Solve it/)).toBeTruthy();
  });

  it('hides reasoning content after clicking toggle twice', async () => {
    render(ChatMessage, {
      props: {
        message: createMessage({ reasoning: 'Step 1: Think' }),
      },
    });

    const toggle = screen.getByText(/Show reasoning/i);

    await fireEvent.click(toggle);
    expect(screen.getByText(/Hide reasoning/i)).toBeTruthy();
    expect(screen.getByText(/Step 1: Think/)).toBeTruthy();

    await fireEvent.click(toggle);
    expect(screen.getByText(/Show reasoning/i)).toBeTruthy();
    expect(screen.queryByText(/Step 1: Think/)).toBeNull();
  });

  it('formats char count as "N chars" for reasoning under 1000 chars', () => {
    const reasoning = 'a'.repeat(42);
    render(ChatMessage, {
      props: {
        message: createMessage({ reasoning }),
      },
    });

    expect(screen.getByText(/42 chars/)).toBeTruthy();
  });

  it('formats char count as "N.Nk chars" for reasoning >= 1000 chars', () => {
    const reasoning = 'a'.repeat(1500);
    render(ChatMessage, {
      props: {
        message: createMessage({ reasoning }),
      },
    });

    expect(screen.getByText(/1\.5k chars/)).toBeTruthy();
  });

  it('formats char count as "N.Nk chars" at exactly 1000 chars', () => {
    const reasoning = 'a'.repeat(1000);
    render(ChatMessage, {
      props: {
        message: createMessage({ reasoning }),
      },
    });

    expect(screen.getByText(/1\.0k chars/)).toBeTruthy();
  });

  it('renders reasoning text with monospace styling', async () => {
    render(ChatMessage, {
      props: {
        message: createMessage({ reasoning: 'monospace text here' }),
      },
    });

    const toggle = screen.getByText(/Show reasoning/i);
    await fireEvent.click(toggle);

    const el = screen.getByText(/monospace text here/);
    expect(el.className).toContain('font-mono');
  });

  it('renders toggle button with font-mono class', () => {
    render(ChatMessage, {
      props: {
        message: createMessage({ reasoning: 'test' }),
      },
    });

    const button = screen.getByText(/Show reasoning/i).closest('button')!;
    expect(button.className).toContain('font-mono');
  });

  it('does not show reasoning for user role even if reasoning present', () => {
    render(ChatMessage, {
      props: {
        message: createMessage({ role: 'user', reasoning: 'user reasoning' }),
      },
    });

    expect(screen.queryByText(/Show reasoning/i)).toBeNull();
  });

  it('shows char count formatting in parenthetical after button text', () => {
    const reasoning = 'a'.repeat(42);
    render(ChatMessage, {
      props: {
        message: createMessage({ reasoning }),
      },
    });

    const btn = screen.getByText(/Show reasoning/i).closest('button')!;
    expect(btn.textContent).toContain('(42 chars)');
  });
});
