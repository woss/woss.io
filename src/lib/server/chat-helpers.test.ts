import { describe, it, expect, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks declared BEFORE imports (lazy vi.mock) — matches early-gates.test.ts
// ---------------------------------------------------------------------------

const mockDb = {
  getChat: vi.fn(),
  renameChat: vi.fn(),
};

vi.mock('$lib/server/db-service', () => ({
  getDbService: vi.fn(() => mockDb),
}));

vi.mock('$lib/server/config', () => ({
  config: vi.fn(() => ({})),
}));

vi.mock('./prompts.ts', () => ({
  getRelevanceCheckUserPrompt: vi.fn(),
  getRelevanceCheckSystemPrompt: vi.fn(),
  getPoliteResponseSystemPrompt: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
  CAT: { chat: 'chat' },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

// Import under test AFTER mocks (module-level createLogger(CAT.chat) must be mocked)
import { tryRenameChat } from './chat-helpers';

describe('tryRenameChat', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls renameChat with the 40-char-truncated title when the resolved chat title is "New Chat"', async () => {
    mockDb.getChat.mockResolvedValue({ id: 'chat-1', title: 'New Chat' });
    mockDb.renameChat.mockResolvedValue(undefined);

    tryRenameChat('chat-1', 'x'.repeat(60));

    await vi.waitFor(() => {
      expect(mockDb.renameChat).toHaveBeenCalledWith('chat-1', 'x'.repeat(40));
    });
  });

  it('skips rename for a chat that already has a custom title', async () => {
    mockDb.getChat.mockResolvedValue({ id: 'chat-1', title: 'Existing title' });

    tryRenameChat('chat-1', 'Hello');

    await vi.waitFor(() => {
      expect(mockDb.getChat).toHaveBeenCalledWith('chat-1');
    });
    expect(mockDb.renameChat).not.toHaveBeenCalled();
  });

  it('does not throw when getChat rejects', async () => {
    mockDb.getChat.mockRejectedValue(new Error('getChat failed'));

    expect(() => tryRenameChat('chat-1', 'Hello')).not.toThrow();

    await vi.waitFor(() => {
      expect(mockDb.renameChat).not.toHaveBeenCalled();
    });
  });
});
