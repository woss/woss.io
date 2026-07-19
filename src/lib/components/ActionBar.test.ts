/**
 * Tests for the downvote → soft-delete feedback submission logic.
 *
 * The logic under test is extracted from ActionBar.svelte `handleFeedbackSubmit`.
 * It lives here (not in a separate module) because the test_engineer scope
 * cannot create new source files under src/.
 *
 * If ActionBar.svelte's handleFeedbackSubmit changes, these tests MUST be
 * updated to stay in sync — they serve as the contract specification.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── System Under Test ───────────────────────────────────────────────
// Copied verbatim from ActionBar.svelte handleFeedbackSubmit.
// Keep in sync with the source.

interface FeedbackContext {
  msgId: string;
  reactionType: 'up' | 'down' | 'heart';
  reason: string;
  userId: string;
  chatId: string;
}

interface FeedbackDeps {
  fetch: typeof globalThis.fetch;
  onreport: (messageId: string, reason: string) => void;
  toast: { success: (msg: string) => void; error: (msg: string) => void };
  setMessageReaction: (messageId: string, type: string, reason: string) => Promise<void>;
}

async function executeFeedbackSubmit(ctx: FeedbackContext, deps: FeedbackDeps): Promise<void> {
  const { msgId, reactionType, reason, userId, chatId } = ctx;
  const { fetch: fetchFn, onreport, toast, setMessageReaction } = deps;

  if (reactionType === 'down' && reason) {
    try {
      const formData = new FormData();
      formData.set('messageId', msgId);
      formData.set('userId', userId);
      formData.set('reason', reason);
      const res = await fetchFn(`/chat/${chatId}?/report`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('Server error');
      onreport(msgId, reason);
      toast.success('Feedback submitted');
    } catch {
      toast.error('Failed to submit feedback');
    }
  } else {
    await setMessageReaction(msgId, reactionType, reason);
    if (reason) toast.success('Thanks for the feedback!');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<FeedbackDeps> = {}): FeedbackDeps & {
  fetchMock: ReturnType<typeof vi.fn>;
  setMessageReactionMock: ReturnType<typeof vi.fn>;
  onreportMock: ReturnType<typeof vi.fn>;
  toastSuccessMock: ReturnType<typeof vi.fn>;
  toastErrorMock: ReturnType<typeof vi.fn>;
} {
  const fetchMock = vi.fn();
  const setMessageReactionMock = vi.fn().mockResolvedValue(undefined);
  const onreportMock = vi.fn();
  const toastSuccessMock = vi.fn();
  const toastErrorMock = vi.fn();

  return {
    fetch: fetchMock as unknown as typeof globalThis.fetch,
    setMessageReaction: setMessageReactionMock,
    onreport: onreportMock,
    toast: { success: toastSuccessMock, error: toastErrorMock },
    fetchMock,
    setMessageReactionMock,
    onreportMock,
    toastSuccessMock,
    toastErrorMock,
    ...overrides,
  };
}

function okResponse(): Response {
  return new Response(null, { status: 200, statusText: 'OK' });
}

function errorResponse(status = 500): Response {
  return new Response(null, { status, statusText: 'Internal Server Error' });
}

// ─── Tests ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('executeFeedbackSubmit', () => {
  // ── Happy path: downvote with reason ──
  describe('downvote with reason (happy path)', () => {
    it('calls ?/report with correct FormData fields', async () => {
      const deps = makeDeps();
      deps.fetchMock.mockResolvedValue(okResponse());

      await executeFeedbackSubmit(
        {
          msgId: 'msg-abc',
          reactionType: 'down',
          reason: 'Wrong answer',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = deps.fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/chat/chat-99?/report');
      expect(init.method).toBe('POST');

      const body = init.body as FormData;
      expect(body.get('messageId')).toBe('msg-abc');
      expect(body.get('userId')).toBe('user-42');
      expect(body.get('reason')).toBe('Wrong answer');
    });

    it('calls onreport with (messageId, reason)', async () => {
      const deps = makeDeps();
      deps.fetchMock.mockResolvedValue(okResponse());

      await executeFeedbackSubmit(
        {
          msgId: 'msg-abc',
          reactionType: 'down',
          reason: 'Wrong answer',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.onreportMock).toHaveBeenCalledTimes(1);
      expect(deps.onreportMock).toHaveBeenCalledWith('msg-abc', 'Wrong answer');
    });

    it('shows success toast', async () => {
      const deps = makeDeps();
      deps.fetchMock.mockResolvedValue(okResponse());

      await executeFeedbackSubmit(
        {
          msgId: 'msg-abc',
          reactionType: 'down',
          reason: 'Wrong answer',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.toastSuccessMock).toHaveBeenCalledTimes(1);
      expect(deps.toastSuccessMock).toHaveBeenCalledWith('Feedback submitted');
    });

    it('does NOT call setMessageReaction', async () => {
      const deps = makeDeps();
      deps.fetchMock.mockResolvedValue(okResponse());

      await executeFeedbackSubmit(
        {
          msgId: 'msg-abc',
          reactionType: 'down',
          reason: 'Wrong answer',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.setMessageReactionMock).not.toHaveBeenCalled();
    });
  });

  // ── Error path: server error on report ──
  describe('downvote with reason — server error', () => {
    it('shows error toast when response.ok is false', async () => {
      const deps = makeDeps();
      deps.fetchMock.mockResolvedValue(errorResponse(500));

      await executeFeedbackSubmit(
        {
          msgId: 'msg-abc',
          reactionType: 'down',
          reason: 'Wrong answer',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.toastErrorMock).toHaveBeenCalledTimes(1);
      expect(deps.toastErrorMock).toHaveBeenCalledWith('Failed to submit feedback');
    });

    it('does NOT call onreport on server error', async () => {
      const deps = makeDeps();
      deps.fetchMock.mockResolvedValue(errorResponse(500));

      await executeFeedbackSubmit(
        {
          msgId: 'msg-abc',
          reactionType: 'down',
          reason: 'Wrong answer',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.onreportMock).not.toHaveBeenCalled();
    });

    it('does NOT show success toast on server error', async () => {
      const deps = makeDeps();
      deps.fetchMock.mockResolvedValue(errorResponse(500));

      await executeFeedbackSubmit(
        {
          msgId: 'msg-abc',
          reactionType: 'down',
          reason: 'Wrong answer',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.toastSuccessMock).not.toHaveBeenCalled();
    });
  });

  // ── Error path: network error ──
  describe('downvote with reason — network error', () => {
    it('shows error toast on fetch rejection', async () => {
      const deps = makeDeps();
      deps.fetchMock.mockRejectedValue(new Error('Network error'));

      await executeFeedbackSubmit(
        {
          msgId: 'msg-abc',
          reactionType: 'down',
          reason: 'Wrong answer',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.toastErrorMock).toHaveBeenCalledTimes(1);
      expect(deps.toastErrorMock).toHaveBeenCalledWith('Failed to submit feedback');
    });

    it('does NOT call onreport on network error', async () => {
      const deps = makeDeps();
      deps.fetchMock.mockRejectedValue(new Error('Network error'));

      await executeFeedbackSubmit(
        {
          msgId: 'msg-abc',
          reactionType: 'down',
          reason: 'Wrong answer',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.onreportMock).not.toHaveBeenCalled();
    });

    it('does NOT throw — error is swallowed', async () => {
      const deps = makeDeps();
      deps.fetchMock.mockRejectedValue(new Error('Network error'));

      await expect(
        executeFeedbackSubmit(
          {
            msgId: 'msg-abc',
            reactionType: 'down',
            reason: 'Wrong answer',
            userId: 'user-42',
            chatId: 'chat-99',
          },
          deps,
        ),
      ).resolves.toBeUndefined();
    });
  });

  // ── Boundary: downvote without reason → reaction-only path ──
  describe('downvote without reason (reaction-only path)', () => {
    it('calls setMessageReaction instead of ?/report', async () => {
      const deps = makeDeps();

      await executeFeedbackSubmit(
        {
          msgId: 'msg-abc',
          reactionType: 'down',
          reason: '',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.setMessageReactionMock).toHaveBeenCalledTimes(1);
      expect(deps.setMessageReactionMock).toHaveBeenCalledWith('msg-abc', 'down', '');
    });

    it('does NOT call fetch for ?/report', async () => {
      const deps = makeDeps();

      await executeFeedbackSubmit(
        {
          msgId: 'msg-abc',
          reactionType: 'down',
          reason: '',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.fetchMock).not.toHaveBeenCalled();
    });

    it('does NOT call onreport', async () => {
      const deps = makeDeps();

      await executeFeedbackSubmit(
        {
          msgId: 'msg-abc',
          reactionType: 'down',
          reason: '',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.onreportMock).not.toHaveBeenCalled();
    });

    it('does NOT show any toast when reason is empty', async () => {
      const deps = makeDeps();

      await executeFeedbackSubmit(
        {
          msgId: 'msg-abc',
          reactionType: 'down',
          reason: '',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.toastSuccessMock).not.toHaveBeenCalled();
      expect(deps.toastErrorMock).not.toHaveBeenCalled();
    });
  });

  // ── Upvote with reason → reaction-only, no ?/report ──
  describe('upvote with reason', () => {
    it('calls setMessageReaction with up type', async () => {
      const deps = makeDeps();

      await executeFeedbackSubmit(
        {
          msgId: 'msg-xyz',
          reactionType: 'up',
          reason: 'Great answer',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.setMessageReactionMock).toHaveBeenCalledTimes(1);
      expect(deps.setMessageReactionMock).toHaveBeenCalledWith('msg-xyz', 'up', 'Great answer');
    });

    it('does NOT call fetch for ?/report', async () => {
      const deps = makeDeps();

      await executeFeedbackSubmit(
        {
          msgId: 'msg-xyz',
          reactionType: 'up',
          reason: 'Great answer',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.fetchMock).not.toHaveBeenCalled();
    });

    it('shows "Thanks for the feedback!" toast', async () => {
      const deps = makeDeps();

      await executeFeedbackSubmit(
        {
          msgId: 'msg-xyz',
          reactionType: 'up',
          reason: 'Great answer',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.toastSuccessMock).toHaveBeenCalledTimes(1);
      expect(deps.toastSuccessMock).toHaveBeenCalledWith('Thanks for the feedback!');
    });

    it('does NOT call onreport', async () => {
      const deps = makeDeps();

      await executeFeedbackSubmit(
        {
          msgId: 'msg-xyz',
          reactionType: 'up',
          reason: 'Great answer',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.onreportMock).not.toHaveBeenCalled();
    });
  });

  // ── Heart reaction ──
  describe('heart reaction', () => {
    it('calls setMessageReaction with heart type', async () => {
      const deps = makeDeps();

      await executeFeedbackSubmit(
        {
          msgId: 'msg-h1',
          reactionType: 'heart',
          reason: 'Love it',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.setMessageReactionMock).toHaveBeenCalledWith('msg-h1', 'heart', 'Love it');
    });

    it('does NOT call fetch for ?/report', async () => {
      const deps = makeDeps();

      await executeFeedbackSubmit(
        {
          msgId: 'msg-h1',
          reactionType: 'heart',
          reason: 'Love it',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.fetchMock).not.toHaveBeenCalled();
    });
  });

  // ── Edge cases ──
  describe('edge cases', () => {
    it('handles Unicode reason in report payload', async () => {
      const deps = makeDeps();
      deps.fetchMock.mockResolvedValue(okResponse());

      await executeFeedbackSubmit(
        {
          msgId: 'msg-u1',
          reactionType: 'down',
          reason: '非 ascii 回复 — émojis 🎉',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      const body = deps.fetchMock.mock.calls[0][1].body as FormData;
      expect(body.get('reason')).toBe('非 ascii 回复 — émojis 🎉');
    });

    it('handles 4xx server error (429 rate limit)', async () => {
      const deps = makeDeps();
      deps.fetchMock.mockResolvedValue(errorResponse(429));

      await executeFeedbackSubmit(
        {
          msgId: 'msg-r1',
          reactionType: 'down',
          reason: 'Rate limited',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.toastErrorMock).toHaveBeenCalledWith('Failed to submit feedback');
      expect(deps.onreportMock).not.toHaveBeenCalled();
    });

    it('handles 204 No Content as ok (res.ok = true)', async () => {
      const deps = makeDeps();
      deps.fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

      await executeFeedbackSubmit(
        {
          msgId: 'msg-n1',
          reactionType: 'down',
          reason: 'Accepted',
          userId: 'user-42',
          chatId: 'chat-99',
        },
        deps,
      );

      expect(deps.onreportMock).toHaveBeenCalledWith('msg-n1', 'Accepted');
      expect(deps.toastSuccessMock).toHaveBeenCalledWith('Feedback submitted');
    });

    it('handles setMessageReaction failure in reaction-only path', async () => {
      const deps = makeDeps();
      deps.setMessageReactionMock.mockRejectedValue(new Error('DB error'));

      await expect(
        executeFeedbackSubmit(
          {
            msgId: 'msg-e1',
            reactionType: 'up',
            reason: '',
            userId: 'user-42',
            chatId: 'chat-99',
          },
          deps,
        ),
      ).rejects.toThrow('DB error');
    });

    it('sends correct chatId in report URL', async () => {
      const deps = makeDeps();
      deps.fetchMock.mockResolvedValue(okResponse());

      await executeFeedbackSubmit(
        {
          msgId: 'msg-c1',
          reactionType: 'down',
          reason: 'Wrong',
          userId: 'user-42',
          chatId: 'chat-custom-id-xyz',
        },
        deps,
      );

      const url = deps.fetchMock.mock.calls[0][0] as string;
      expect(url).toBe('/chat/chat-custom-id-xyz?/report');
    });
  });
});
