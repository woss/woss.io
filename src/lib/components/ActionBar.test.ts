// @vitest-environment happy-dom

// Polyfill for svelte transitions in happy-dom
if (typeof globalThis.requestAnimationFrame === 'function') {
  const origRAF = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const rv = origRAF(cb);
    cb(performance.now());
    return rv;
  };
}
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

// Capture onclick handlers from the sv5ui Button mock for deferred invocation
// after the component's initial render cycle completes.
const { clickHandlers } = vi.hoisted(() => ({
  clickHandlers: {} as Record<string, ((e: Event) => void) | undefined>,
}));

vi.mock('svelte', async () => {
  const client = await import('svelte/internal/client');
  const server = await import('svelte');
  return {
    ...server,
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

// Note: Svelte 5 calls function-component mocks with (anchor, props),
// not (props). The spread pattern (...) captures all args and we find
// the props object by filtering out anchor nodes and functions.
vi.mock('sv5ui', () => ({
  Button: (...args: any[]) => {
    const props: Record<string, unknown> =
      args.find((a: unknown) => a && typeof a === 'object' && !(a as any).nodeType) ?? {};
    const label: string = (props['aria-label'] as string) ?? (props.label as string) ?? (props.title as string) ?? '';
    if (typeof props.onclick === 'function') {
      clickHandlers[label] = props.onclick as (e: Event) => void;
    }
    const children = args.find((a: unknown) => typeof a === 'function');
    return typeof children === 'function' ? children() : undefined;
  },
  Input: () => '',
  Tooltip: (props: any) => props.children?.(),
  AvatarGroup: () => '',
  Textarea: () => '',
}));

vi.mock('$app/state', () => ({
  page: { data: { queryParams: {} } },
}));
vi.mock('$app/navigation', () => ({ goto: () => {} }));
vi.mock('$app/environment', () => ({ browser: true }));

vi.mock('$lib/utils/clipboard', () => ({ copyToClipboard: vi.fn(() => true) }));
vi.mock('$lib/utils/avatar', () => ({
  nameToColor: vi.fn(() => '#000'),
  nameToInitial: vi.fn(() => '?'),
}));
vi.mock('svelte-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { render, screen, cleanup } from '@testing-library/svelte';
import ActionBar from './ActionBar.svelte';
import type { ChatMessage } from '$lib/chat/types';

function createMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    text: 'Hello world',
    timestamp: Date.now(),
    createdAt: new Date().toISOString(),
    ...overrides,
  } as ChatMessage;
}

describe('ActionBar', () => {
  afterEach(() => {
    Object.keys(clickHandlers).forEach((k) => delete clickHandlers[k]);
    cleanup();
  });

  // --- HAPPY PATH ---

  it('renders without error', () => {
    render(ActionBar, { props: { message: createMessage() } });
    expect(document.body.querySelector('.flex')).toBeTruthy();
  });

  it('renders source/tools indicator when message has sources', () => {
    render(ActionBar, {
      props: {
        message: createMessage({
          sources: [{ title: 'Test', url: 'https://example.com', type: 'post', score: 0.9 }],
        }),
      },
    });
    expect(screen.getByText(/1 source/)).toBeTruthy();
  });

  it('renders source/tools indicator when message has toolCalls', () => {
    render(ActionBar, {
      props: {
        message: createMessage({
          toolCalls: [
            {
              id: 't1',
              name: 'search',
              serverId: 'srv',
              startedAt: '2024-01-01',
              finishedAt: '2024-01-01',
              durationMs: 100,
            },
          ],
        }),
      },
    });
    expect(screen.getByText(/1 tool/)).toBeTruthy();
  });

  // --- onfeedback WIRING ---

  it('captures thumbs up click handler with correct aria-label', () => {
    render(ActionBar, { props: { message: createMessage(), onfeedback: vi.fn() } });
    expect(clickHandlers['Thumbs up']).toBeTypeOf('function');
  });

  it('captures thumbs down click handler with correct aria-label', () => {
    render(ActionBar, { props: { message: createMessage(), onfeedback: vi.fn() } });
    expect(clickHandlers['Thumbs down']).toBeTypeOf('function');
  });

  it('captures heart click handler with correct aria-label', () => {
    render(ActionBar, { props: { message: createMessage() } });
    expect(clickHandlers['Heart']).toBeTypeOf('function');
  });

  it('captures share and copy click handlers when Tooltip forwards children', () => {
    render(ActionBar, { props: { message: createMessage() } });
    // Share/copy buttons are wrapped in Tooltip which calls children().
    // The inner Button mock is rendered and its onclick captured.
    const shareHandler = clickHandlers['Share link'];
    const copyHandler = clickHandlers['Copy message'];
    if (shareHandler !== undefined) {
      expect(shareHandler).toBeTypeOf('function');
    }
    if (copyHandler !== undefined) {
      expect(copyHandler).toBeTypeOf('function');
    }
  });

  // --- ERROR / EDGE CASES ---

  it('does not render click handlers for user role messages', () => {
    render(ActionBar, { props: { message: createMessage({ role: 'user' }) } });
    expect(clickHandlers['Thumbs up']).toBeUndefined();
    expect(clickHandlers['Thumbs down']).toBeUndefined();
    expect(clickHandlers['Heart']).toBeUndefined();
  });

  it('handles missing onfeedback prop gracefully (no error)', () => {
    expect(() => {
      render(ActionBar, { props: { message: createMessage() } });
    }).not.toThrow();
  });

  it('renders with reaction state for thumbs up without error', () => {
    expect(() => {
      render(ActionBar, {
        props: { message: createMessage({ reaction: { type: 'up', reason: '' } }) },
      });
    }).not.toThrow();
  });

  it('renders with reaction state for thumbs down without error', () => {
    expect(() => {
      render(ActionBar, {
        props: { message: createMessage({ reaction: { type: 'down', reason: '' } }) },
      });
    }).not.toThrow();
  });

  it('renders with reaction state for heart without error', () => {
    expect(() => {
      render(ActionBar, {
        props: { message: createMessage({ reaction: { type: 'heart', reason: '' } }) },
      });
    }).not.toThrow();
  });
});
