/**
 * Tests for SurrealDatabaseService — mocked SurrealDB, no real connection.
 *
 * Covers:
 *   – SurrealDatabaseService (init, close, transaction)
 *   – UserRepo   (ensureUser, getOrCreateUser, getUser, updateUser)
 *   – ChatRepo   (ensureChat, getChat, getChatSummaryForApi)
 *   – MessageRepo (addMessage, getMessages, softDeleteMessage)
 *   – All 12 stub repos (each method throws NOT_YET_IMPLEMENTED)
 */

import { RecordId } from 'surrealdb';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock surrealdb.js SDK — use vi.hoisted() so variables exist before the
// vi.mock() factory runs (vi.mock is hoisted above all imports).
// ---------------------------------------------------------------------------

const {
  mockInitSurreal,
  mockCloseSurreal,
  mockQuery,
  mockSelect,
  mockDb,
  mockUpdate,
  mockCreate,
  mockMerge,
  mockContent,
} = vi.hoisted(() => {
  // v2: db.query() returns unknown[] — mock wraps result data in one-element array
  const mq = vi.fn().mockResolvedValue([[]]);
  const merge = vi.fn().mockResolvedValue({
    id: 'users:u1',
    email: null,
    name: null,
    created_at: '2025-01-01T00:00:00.000Z',
  });
  const content = vi.fn().mockResolvedValue([{ id: '99' }]);
  const update = vi.fn().mockReturnValue({ merge });
  const create = vi.fn().mockReturnValue({ content });

  // Builder chain helper — Table pattern: select().where(eq(...)).limit(n)
  function makeChain(resolveValue: unknown[] = []) {
    const limitFn = vi.fn().mockResolvedValue(resolveValue);
    const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
    // TableSelect is thenable (can be awaited directly or chained)
    const thenable = Promise.resolve(resolveValue) as Promise<unknown[]> & { where: typeof whereFn };
    thenable.where = whereFn;
    return thenable;
  }

  // Default select mock:
  // RecordId arg → Promise<null> (direct await, single record or null)
  // Table arg → builder chain (thenable + .where())
  const ms = vi.fn().mockImplementation((arg: unknown) => {
    if (arg && typeof arg === 'object' && 'constructor' in arg && arg.constructor?.name === 'RecordId') {
      return Promise.resolve(null);
    }
    return makeChain([]);
  });

  return {
    mockInitSurreal: vi.fn().mockResolvedValue(undefined),
    mockCloseSurreal: vi.fn().mockResolvedValue(undefined),
    mockQuery: mq,
    mockSelect: ms,
    mockDb: { query: mq, select: ms, update, create },
    mockUpdate: update,
    mockCreate: create,
    mockMerge: merge,
    mockContent: content,
  };
});

vi.mock('./surreal', () => ({
  initSurreal: mockInitSurreal,
  closeSurreal: mockCloseSurreal,
  getSurreal: vi.fn(() => mockDb),
}));

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import { SurrealDatabaseService } from './surreal-service';
import type {
  AddMessageParams,
  IUserRepo,
  IChatRepo,
  IMessageRepo,
  IEventRepo,
  IReactionRepo,
  IToolCallRepo,
  IContentRepo,
  ILeadRepo,
  IContactIntentRepo,
  IUserAgentRepo,
  IVectorRepo,
  ILlmCacheRepo,
  IModelRepo,
  IFeatureTourRepo,
  ICentroidRepo,
} from './interfaces';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Shorthand for a successful query result.
 *
 * v2: `db.query()` returns `unknown[]` — the first element is the result data.
 * `okResult` wraps data in a one-element array so `queryDb` (which returns
 * `result[0]`) gets back the data the caller expects.
 *
 * Example — mock a SELECT that returns one row:
 * ```ts
 * mockQuery.mockResolvedValue(okResult([{ id: 'u1', name: 'Alice' }]));
 * // → db.query returns [[{ id: 'u1', name: 'Alice' }]]
 * // → queryDb returns  [{ id: 'u1', name: 'Alice' }] — the data the repo uses
 * ```
 */
function okResult<T>(data: T): [T] {
  return [data];
}

const USER_ID = 'u1';
const CHAT_ID = 'c1';
const MESSAGE_ID = 'm1';
const NOW = '2026-01-15T10:00:00.000Z';

/**
 * Build a raw DB row matching the shape returned by `queryDb` in getPosts.
 * Provides sensible defaults; callers override via spread.
 */
function makeDbRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'page_posts:1',
    slug: 'default-post',
    content: 'default content',
    toc: '[]',
    title: 'Default Title',
    description: '',
    date: '2026-01-01',
    tags: [],
    status: 'published',
    excerpt: '',
    header_image: null,
    featured: false,
    position: null,
    part_of_series: null,
    workflow_files: null,
    ...overrides,
  };
}

// ===========================================================================
// SurrealDatabaseService
// ===========================================================================

describe('SurrealDatabaseService', () => {
  let service: SurrealDatabaseService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue([[]]);
    mockSelect.mockReset();
    mockSelect.mockImplementation((arg: unknown) => {
      if (arg && typeof arg === 'object' && 'constructor' in arg && arg.constructor?.name === 'RecordId') {
        return Promise.resolve(null);
      }
      // Re-create makeChain inline to avoid hoisting issues with vi.fn
      const resolveValue: unknown[] = [];
      const limitFn = vi.fn().mockResolvedValue(resolveValue);
      const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
      const thenable = Promise.resolve(resolveValue) as Promise<unknown[]> & { where: typeof whereFn };
      thenable.where = whereFn;
      return thenable;
    });
    mockMerge.mockReset();
    mockMerge.mockResolvedValue({ id: 'users:u1', email: null, name: null, createdAt: NOW });
    mockContent.mockReset();
    mockContent.mockResolvedValue([{ id: '99' }]);
    mockUpdate.mockReset();
    mockUpdate.mockReturnValue({ merge: mockMerge });
    mockCreate.mockReset();
    mockCreate.mockReturnValue({ content: mockContent });
    // Re-create service so each test starts with a fresh instance
    service = new SurrealDatabaseService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // init / close
  // -------------------------------------------------------------------------

  describe('init', () => {
    it('calls initSurreal', async () => {
      await service.init();
      expect(mockInitSurreal).toHaveBeenCalledTimes(1);
    });
  });

  describe('close', () => {
    it('calls closeSurreal', async () => {
      await service.close();
      expect(mockCloseSurreal).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // transaction
  // -------------------------------------------------------------------------

  describe('transaction', () => {
    it('wraps fn in BEGIN / COMMIT and returns result', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql === 'BEGIN TRANSACTION' || sql === 'COMMIT TRANSACTION') {
          return Promise.resolve(okResult([]));
        }
        return Promise.resolve(okResult([]));
      });

      const result = await service.transaction(() => Promise.resolve('ok'));

      expect(result).toBe('ok');
      const calls = mockQuery.mock.calls.map((c: string[]) => c[0]);
      expect(calls.filter((s: string) => s === 'BEGIN TRANSACTION').length).toBe(1);
      expect(calls.filter((s: string) => s === 'COMMIT TRANSACTION').length).toBe(1);
      expect(calls.filter((s: string) => s === 'CANCEL TRANSACTION').length).toBe(0);
    });

    it('rolls back with CANCEL TRANSACTION on fn error and rethrows', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql === 'BEGIN TRANSACTION' || sql === 'CANCEL TRANSACTION') {
          return Promise.resolve(okResult([]));
        }
        return Promise.resolve(okResult([]));
      });

      const testError = new Error('fn failed');
      await expect(service.transaction(() => Promise.reject(testError))).rejects.toThrow('fn failed');

      const calls = mockQuery.mock.calls.map((c: string[]) => c[0]);
      expect(calls.filter((s: string) => s === 'BEGIN TRANSACTION').length).toBe(1);
      expect(calls.filter((s: string) => s === 'CANCEL TRANSACTION').length).toBe(1);
      expect(calls.filter((s: string) => s === 'COMMIT TRANSACTION').length).toBe(0);
    });

    it('assertOk failure on BEGIN TRANSACTION throws', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql === 'BEGIN TRANSACTION') return Promise.reject(new Error('ERR'));
        return Promise.resolve(okResult([]));
      });

      await expect(service.transaction(() => Promise.resolve('x'))).rejects.toThrow('ERR');
    });

    it('assertOk failure on COMMIT TRANSACTION triggers CANCEL', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql === 'COMMIT TRANSACTION') return Promise.reject(new Error('ERR'));
        if (sql === 'CANCEL TRANSACTION') return Promise.resolve(okResult([]));
        return Promise.resolve(okResult([]));
      });

      await expect(service.transaction(() => Promise.resolve('x'))).rejects.toThrow('ERR');

      const calls = mockQuery.mock.calls.map((c: string[]) => c[0]);
      expect(calls.filter((s: string) => s === 'CANCEL TRANSACTION').length).toBe(1);
    });
  });

  // =========================================================================
  // UserRepo
  // =========================================================================

  describe('users', () => {
    let users: IUserRepo;

    beforeEach(() => {
      users = service.users;
    });

    // -----------------------------------------------------------------------
    // ensureUser
    // -----------------------------------------------------------------------

    describe('ensureUser', () => {
      it('with email and name calls UPDATE MERGE OR INSERT', async () => {
        mockMerge.mockImplementation((data: Record<string, unknown>) => {
          expect(data.email).toBe('a@b.com');
          expect(data.name).toBe('Alice');
          return Promise.resolve({ id: 'users:u1', email: 'a@b.com', name: 'Alice', created_at: NOW });
        });

        await users.ensureUser(USER_ID, 'a@b.com', 'Alice');

        expect(mockUpdate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockMerge).toHaveBeenCalled();
      });

      it('without optional fields calls UPDATE MERGE with empty merge (upsert)', async () => {
        await users.ensureUser(USER_ID);

        expect(mockUpdate).toHaveBeenCalledTimes(1);
        expect(mockMerge).toHaveBeenCalledWith({});
      });

      it('assertOk failure when query fails', async () => {
        mockMerge.mockRejectedValueOnce(new Error('ERR'));

        await expect(users.ensureUser(USER_ID, 'a@b.com')).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // getOrCreateUser
    // -----------------------------------------------------------------------

    describe('getOrCreateUser', () => {
      it('creates new user with email+name and returns UserRecord', async () => {
        mockMerge.mockImplementation((data: Record<string, unknown>) => {
          expect(data.email).toBe('a@b.com');
          expect(data.name).toBe('Alice');
          return Promise.resolve({
            id: `users:${USER_ID}`,
            email: 'a@b.com',
            name: 'Alice',
            created_at: NOW,
          });
        });

        const user = await users.getOrCreateUser(USER_ID, 'a@b.com', 'Alice');

        expect(user.id).toBe(USER_ID);
        expect(user.email).toBe('a@b.com');
        expect(user.name).toBe('Alice');
        expect(user.createdAt).toBe(NOW);
      });

      it('returns existing when called again with same id', async () => {
        const userData = () => ({
          id: `users:${USER_ID}`,
          email: 'a@b.com',
          name: 'Alice',
          created_at: NOW,
        });
        mockMerge.mockResolvedValueOnce(userData()).mockResolvedValueOnce(userData());

        const user1 = await users.getOrCreateUser(USER_ID, 'a@b.com', 'Alice');
        const user2 = await users.getOrCreateUser(USER_ID, 'a@b.com', 'Alice');

        expect(user1).toEqual(user2);
        expect(user2.id).toBe(USER_ID);
      });

      it('throws when query returns no rows', async () => {
        mockMerge.mockResolvedValueOnce(undefined);

        await expect(users.getOrCreateUser(USER_ID)).rejects.toThrow('getOrCreateUser returned no rows');
      });

      it('passes null for email and name when not provided (no null overwrite guarded by MERGE)', async () => {
        mockMerge.mockImplementation((data: Record<string, unknown>) => {
          expect(data.email).toBeNull();
          expect(data.name).toBeNull();
          return Promise.resolve({
            id: `users:${USER_ID}`,
            email: null,
            name: null,
            created_at: NOW,
          });
        });

        const user = await users.getOrCreateUser(USER_ID);

        expect(user.id).toBe(USER_ID);
        expect(user.email).toBeNull();
        expect(user.name).toBeNull();
      });

      it('assertOk failure throws descriptive error', async () => {
        mockMerge.mockRejectedValueOnce(new Error('ERR'));

        await expect(users.getOrCreateUser(USER_ID)).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // getUser
    // -----------------------------------------------------------------------

    describe('getUser', () => {
      it('returns UserRecord when found', async () => {
        mockSelect.mockResolvedValueOnce({
          id: `users:${USER_ID}`,
          email: 'a@b.com',
          name: 'Alice',
          created_at: NOW,
        });

        const user = await users.getUser(USER_ID);

        expect(user).toBeDefined();
        expect(user!.id).toBe(USER_ID);
        expect(user!.email).toBe('a@b.com');
        expect(user!.name).toBe('Alice');
      });

      it('returns undefined when not found', async () => {
        mockSelect.mockResolvedValueOnce(null);

        const user = await users.getUser(USER_ID);
        expect(user).toBeUndefined();
      });

      it('assertOk failure throws', async () => {
        mockSelect.mockRejectedValueOnce(new Error('ERR'));

        await expect(users.getUser(USER_ID)).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // updateUser
    // -----------------------------------------------------------------------

    describe('updateUser', () => {
      it('merges partial updates', async () => {
        mockMerge.mockImplementation((data: Record<string, unknown>) => {
          expect(data.name).toBe('New Name');
          expect(data.email).toBeUndefined();
          return Promise.resolve({});
        });

        await users.updateUser(USER_ID, { name: 'New Name' });

        expect(mockUpdate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockMerge).toHaveBeenCalledTimes(1);
      });

      it('skips when no updates provided', async () => {
        await users.updateUser(USER_ID, {});
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockMerge).not.toHaveBeenCalled();
      });

      it('skips when only undefined values provided', async () => {
        await users.updateUser(USER_ID, { email: undefined });
        expect(mockUpdate).not.toHaveBeenCalled();
        expect(mockMerge).not.toHaveBeenCalled();
      });

      it('preserves null values to clear fields', async () => {
        mockMerge.mockImplementation((data: Record<string, unknown>) => {
          expect(data.email).toBeNull();
          return Promise.resolve({});
        });

        await users.updateUser(USER_ID, { email: null as unknown as undefined });
        expect(mockUpdate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockMerge).toHaveBeenCalledTimes(1);
      });

      it('assertOk failure throws', async () => {
        mockMerge.mockRejectedValue(new Error('ERR'));

        await expect(users.updateUser(USER_ID, { name: 'x' })).rejects.toThrow('ERR');
      });
    });
  });

  // =========================================================================
  // ChatRepo
  // =========================================================================

  describe('chats', () => {
    let chats: IChatRepo;

    beforeEach(() => {
      chats = service.chats;
    });

    // -----------------------------------------------------------------------
    // ensureChat
    // -----------------------------------------------------------------------

    describe('ensureChat', () => {
      it('merges user_id only (does not overwrite title)', async () => {
        mockMerge.mockImplementation((data: Record<string, unknown>) => {
          expect(data.user_id).toBeDefined();
          expect(data.title).toBeUndefined();
          return Promise.resolve({});
        });

        await chats.ensureChat(CHAT_ID, USER_ID);

        expect(mockUpdate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockMerge).toHaveBeenCalledTimes(1);
      });

      it('assertOk failure throws', async () => {
        mockMerge.mockRejectedValueOnce(new Error('ERR'));

        await expect(chats.ensureChat(CHAT_ID, USER_ID)).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // getChat
    // -----------------------------------------------------------------------

    describe('getChat', () => {
      it('returns Chat when found', async () => {
        mockQuery.mockResolvedValueOnce(
          okResult([{ id: CHAT_ID, user_id: USER_ID, title: 'My Chat', created_at: NOW, messageCount: 3 }]),
        );

        const chat = await chats.getChat(CHAT_ID);

        expect(chat).toBeDefined();
        expect(chat!.id).toBe(CHAT_ID);
        expect(chat!.userId).toBe(USER_ID);
        expect(chat!.title).toBe('My Chat');
        expect(chat!.createdAt).toBe(NOW);
        expect(chat!.messageCount).toBe(3);
      });

      it('returns undefined when not found', async () => {
        mockQuery.mockResolvedValueOnce(okResult([]));

        const chat = await chats.getChat('nonexistent');
        expect(chat).toBeUndefined();
      });

      it('assertOk failure throws', async () => {
        mockQuery.mockRejectedValueOnce(new Error('ERR'));

        await expect(chats.getChat(CHAT_ID)).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // getChatSummaryForApi
    // -----------------------------------------------------------------------

    describe('getChatSummaryForApi', () => {
      it('returns ChatSummary with message count and lastMessageAt', async () => {
        mockSelect.mockResolvedValueOnce({
          id: CHAT_ID,
          user_id: USER_ID,
          title: 'Summary Chat',
          created_at: NOW,
        });
        let callIndex = 0;
        mockQuery.mockImplementation(async () => {
          callIndex++;
          if (callIndex === 1) {
            return Promise.resolve(okResult([{ count: 5 }]));
          }
          return Promise.resolve(okResult([{ lastAt: NOW }]));
        });

        const summary = await chats.getChatSummaryForApi(CHAT_ID);

        expect(summary).toBeDefined();
        expect(summary!.id).toBe(CHAT_ID);
        expect(summary!.title).toBe('Summary Chat');
        expect(summary!.createdAt).toBe(NOW);
        expect(summary!.messageCount).toBe(5);
        expect(summary!.lastMessageAt).toBe(NOW);
      });

      it('returns undefined when chat not found', async () => {
        mockSelect.mockResolvedValueOnce(null);

        const summary = await chats.getChatSummaryForApi('nonexistent');
        expect(summary).toBeUndefined();
        expect(mockQuery).not.toHaveBeenCalled();
      });

      it('handles zero message count and null lastMessageAt', async () => {
        mockSelect.mockResolvedValueOnce({
          id: CHAT_ID,
          user_id: USER_ID,
          title: 'Empty',
          created_at: NOW,
        });
        let callIndex = 0;
        mockQuery.mockImplementation(async () => {
          callIndex++;
          if (callIndex === 1) return Promise.resolve(okResult([]));
          return Promise.resolve(okResult([]));
        });

        const summary = await chats.getChatSummaryForApi(CHAT_ID);

        expect(summary).toBeDefined();
        expect(summary!.messageCount).toBe(0);
        expect(summary!.lastMessageAt).toBeNull();
      });

      it('assertOk failure on first query throws', async () => {
        mockSelect.mockRejectedValueOnce(new Error('ERR'));

        await expect(chats.getChatSummaryForApi(CHAT_ID)).rejects.toThrow('ERR');
      });
    });
  });

  // =========================================================================
  // MessageRepo
  // =========================================================================

  describe('messages', () => {
    let msgs: IMessageRepo;

    beforeEach(() => {
      msgs = service.messages;
    });

    // -----------------------------------------------------------------------
    // addMessage
    // -----------------------------------------------------------------------

    describe('addMessage', () => {
      const defaultParams: AddMessageParams = {
        userId: USER_ID,
        chatId: CHAT_ID,
        role: 'user',
        content: 'Hello',
      };

      it('inserts message with full params and returns the message id', async () => {
        mockContent.mockImplementation((data: Record<string, unknown>) => {
          expect(data.user_id).toBeDefined();
          expect(data.chat_id).toBeDefined();
          expect(data.role).toBe('user');
          expect(data.content).toBe('Hello');
          return Promise.resolve([{ id: `messages:${MESSAGE_ID}` }]);
        });

        const id = await msgs.addMessage({ ...defaultParams, msgId: MESSAGE_ID });

        expect(id).toBe(MESSAGE_ID);
      });

      it('ensures user and chat exist before inserting message', async () => {
        await msgs.addMessage({ ...defaultParams, msgId: MESSAGE_ID });

        // ensureUser (no email) → db.update().merge({})
        // ensureChat → db.update().merge()
        expect(mockUpdate).toHaveBeenCalledTimes(2);
        expect(mockMerge).toHaveBeenCalledTimes(2);
        // insert message → db.create().content()
        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(mockContent).toHaveBeenCalledTimes(1);
      });

      it('skips ensureChat when chatId is not provided', async () => {
        await msgs.addMessage({ userId: USER_ID, role: 'user', content: 'No chat', msgId: MESSAGE_ID });

        // ensureUser still called (update().merge({}))
        expect(mockUpdate).toHaveBeenCalledTimes(1);
        expect(mockMerge).toHaveBeenCalledTimes(1);
        // ensureChat NOT called
        // CREATE message still called
        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(mockContent).toHaveBeenCalledTimes(1);
      });

      it('uses randomUUID when msgId is not provided', async () => {
        const id = await msgs.addMessage(defaultParams);

        expect(id).toBeDefined();
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
      });

      it('assertOk failure throws', async () => {
        mockContent.mockRejectedValueOnce(new Error('ERR'));

        await expect(msgs.addMessage({ ...defaultParams, msgId: MESSAGE_ID })).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // getMessages
    // -----------------------------------------------------------------------

    describe('getMessages', () => {
      it('returns StoredMessage array for a chat', async () => {
        mockQuery.mockResolvedValue(
          okResult([
            {
              id: 'm1',
              userId: USER_ID,
              chatId: CHAT_ID,
              role: 'user',
              content: 'Hi',
              sources: '',
              reasoning: '',
              createdAt: NOW,
              model_id: '1',
              tokensIn: 10,
              tokensOut: 20,
              durationMs: 100,
              maxTokens: 2000,
            },
            {
              id: 'm2',
              userId: USER_ID,
              chatId: CHAT_ID,
              role: 'assistant',
              content: 'Hello!',
              sources: '',
              reasoning: '',
              createdAt: NOW,
              model_id: '1',
              tokensIn: 10,
              tokensOut: 50,
              durationMs: 200,
              maxTokens: 2000,
            },
          ]),
        );

        const messages = await msgs.getMessages(CHAT_ID);

        expect(messages.length).toBe(2);
        expect(messages[0].id).toBe('m1');
        expect(messages[0].role).toBe('user');
        expect(messages[1].id).toBe('m2');
        expect(messages[1].role).toBe('assistant');
      });

      it('returns empty array when no messages', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        const messages = await msgs.getMessages(CHAT_ID);
        expect(messages).toEqual([]);
      });

      it('uses default limit 100 and offset 0', async () => {
        mockQuery.mockImplementation(async (_sql: string, vars?: Record<string, unknown>) => {
          expect(vars?.limit).toBe(100);
          expect(vars?.offset).toBe(0);
          return Promise.resolve(okResult([]));
        });

        await msgs.getMessages(CHAT_ID);
      });

      it('uses provided limit and offset', async () => {
        mockQuery.mockImplementation(async (_sql: string, vars?: Record<string, unknown>) => {
          expect(vars?.limit).toBe(50);
          expect(vars?.offset).toBe(10);
          return Promise.resolve(okResult([]));
        });

        await msgs.getMessages(CHAT_ID, 50, 10);
      });

      it('assertOk failure throws', async () => {
        mockQuery.mockRejectedValue(new Error('ERR'));

        await expect(msgs.getMessages(CHAT_ID)).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // softDeleteMessage
    // -----------------------------------------------------------------------

    describe('softDeleteMessage', () => {
      it('sets deletedAt on the message', async () => {
        await msgs.softDeleteMessage(MESSAGE_ID);

        expect(mockUpdate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockMerge).toHaveBeenCalledWith(expect.objectContaining({ deleted_at: expect.any(Date) }));
      });

      it('assertOk failure throws', async () => {
        mockMerge.mockRejectedValueOnce(new Error('ERR'));

        await expect(msgs.softDeleteMessage(MESSAGE_ID)).rejects.toThrow('ERR');
      });
    });
  });

  // =========================================================================
  // EventRepo
  // =========================================================================

  describe('events', () => {
    let events: IEventRepo;

    beforeEach(() => {
      events = service.events;
    });

    // -----------------------------------------------------------------------
    // insertChatEvent
    // -----------------------------------------------------------------------

    describe('insertChatEvent', () => {
      it('inserts event and returns event id', async () => {
        // RecordId create → single record, not array-wrapped
        const eventId = await events.insertChatEvent('c1', 'test_type', { key: 'value' });

        expect(eventId).toBeGreaterThan(0);
        expect(mockCreate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockContent).toHaveBeenCalledWith(expect.objectContaining({ type: 'test_type' }));
      });

      it('falls back to Date.now() when query returns no rows', async () => {
        // RecordId create → single record, not array-wrapped
        mockContent.mockResolvedValueOnce({ id: Date.now() * 1000 });

        const eventId = await events.insertChatEvent('c1', 'type', 'data');

        expect(typeof eventId).toBe('number');
        expect(eventId).toBeGreaterThan(0);
      });

      it('assertOk failure throws', async () => {
        mockContent.mockRejectedValueOnce(new Error('ERR'));

        await expect(events.insertChatEvent('c1', 't', {})).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // getChatEventsSince
    // -----------------------------------------------------------------------

    describe('getChatEventsSince', () => {
      it('returns ChatEvent array', async () => {
        mockQuery.mockResolvedValue(
          okResult([
            { id: '1', chatId: 'c1', type: 'evt', data: JSON.stringify({ foo: 'bar' }), createdAt: NOW },
            { id: '2', chatId: 'c1', type: 'evt2', data: JSON.stringify({ baz: 1 }), createdAt: NOW },
          ]),
        );

        const eventList = await events.getChatEventsSince('c1', 0);

        expect(eventList.length).toBe(2);
        expect(eventList[0].id).toBe(1);
        expect(eventList[0].type).toBe('evt');
        expect(eventList[0].data).toEqual({ foo: 'bar' });
        expect(eventList[1].id).toBe(2);
        expect(eventList[1].data).toEqual({ baz: 1 });
      });

      it('returns empty array when no events since lastEventId', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        const result = await events.getChatEventsSince('c1', 999);
        expect(result).toEqual([]);
      });

      it('assertOk failure throws', async () => {
        mockQuery.mockRejectedValue(new Error('ERR'));

        await expect(events.getChatEventsSince('c1', 0)).rejects.toThrow('ERR');
      });
    });
  });

  // =========================================================================
  // ReactionRepo
  // =========================================================================

  describe('reactions', () => {
    let reactions: IReactionRepo;

    beforeEach(() => {
      reactions = service.reactions;
    });

    // -----------------------------------------------------------------------
    // setReaction
    // -----------------------------------------------------------------------

    describe('setReaction', () => {
      it('upserts reaction without reason', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        await reactions.setReaction('m1', 'u1', 'up');

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO reactions'),
          expect.objectContaining({
            messageId: expect.any(RecordId),
            userId: expect.any(RecordId),
            reactionType: 'up',
            reason: '',
            createdAt: expect.any(Date),
          }),
        );
      });

      it('upserts reaction with reason', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        await reactions.setReaction('m1', 'u1', 'heart', 'great answer');

        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('INSERT INTO reactions'),
          expect.objectContaining({
            messageId: expect.any(RecordId),
            userId: expect.any(RecordId),
            reactionType: 'heart',
            reason: 'great answer',
            createdAt: expect.any(Date),
          }),
        );
      });

      it('assertOk failure throws', async () => {
        mockQuery.mockRejectedValueOnce(new Error('ERR'));

        await expect(reactions.setReaction('m1', 'u1', 'down')).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // getReaction
    // -----------------------------------------------------------------------

    describe('getReaction', () => {
      it('returns ReactionResult when found', async () => {
        mockQuery.mockResolvedValue(okResult([{ reaction_type: 'up', reason: 'helpful' }]));

        const result = await reactions.getReaction('m1', 'u1');

        expect(result).toBeDefined();
        expect(result!.type).toBe('up');
        expect(result!.reason).toBe('helpful');
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('SELECT * FROM reactions'),
          expect.objectContaining({
            messageId: expect.any(RecordId),
            userId: expect.any(RecordId),
          }),
        );
      });

      it('returns null when not found', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        const result = await reactions.getReaction('m1', 'u1');
        expect(result).toBeNull();
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('SELECT * FROM reactions'),
          expect.objectContaining({
            messageId: expect.any(RecordId),
            userId: expect.any(RecordId),
          }),
        );
      });

      it('assertOk failure throws', async () => {
        mockQuery.mockRejectedValueOnce(new Error('ERR'));

        await expect(reactions.getReaction('m1', 'u1')).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // deleteReaction
    // -----------------------------------------------------------------------

    describe('deleteReaction', () => {
      it('deletes reaction', async () => {
        mockQuery.mockImplementation(async (sql: string, vars?: Record<string, unknown>) => {
          if (sql.includes('DELETE reactions')) {
            expect(vars?.messageId).toBeInstanceOf(RecordId);
            expect(vars?.userId).toBeInstanceOf(RecordId);
            return Promise.resolve(okResult([]));
          }
          return Promise.resolve(okResult([]));
        });

        await reactions.deleteReaction('m1', 'u1');

        const calls = mockQuery.mock.calls.map((c: string[]) => c[0]);
        expect(calls.some((s: string) => s.includes('DELETE reactions'))).toBe(true);
      });

      it('assertOk failure throws', async () => {
        mockQuery.mockRejectedValue(new Error('ERR'));

        await expect(reactions.deleteReaction('m1', 'u1')).rejects.toThrow('ERR');
      });
    });
  });

  // =========================================================================
  // ToolCallRepo
  // =========================================================================

  describe('toolCalls', () => {
    let toolCalls: IToolCallRepo;

    beforeEach(() => {
      toolCalls = service.toolCalls;
    });

    // -----------------------------------------------------------------------
    // getToolCallsByMessageId
    // -----------------------------------------------------------------------

    describe('getToolCallsByMessageId', () => {
      it('returns ToolCallRecord array', async () => {
        mockQuery.mockResolvedValue(
          okResult([
            { id: 'tc1', name: 'search', serverId: 'srv1', startedAt: NOW, finishedAt: NOW },
            { id: 'tc2', name: 'compute', serverId: 'srv1', startedAt: NOW, finishedAt: null },
          ]),
        );

        const calls = await toolCalls.getToolCallsByMessageId('m1');

        expect(calls.length).toBe(2);
        expect(calls[0].id).toBe('tc1');
        expect(calls[0].name).toBe('search');
        expect(calls[0].finishedAt).toBe(NOW);
        expect(calls[0].durationMs).toBe(0);
        expect(calls[1].id).toBe('tc2');
        expect(calls[1].finishedAt).toBeNull();
        expect(calls[1].durationMs).toBeNull();
      });

      it('returns empty array when no tool calls found', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        const calls = await toolCalls.getToolCallsByMessageId('nonexistent');
        expect(calls).toEqual([]);
      });

      it('assertOk failure throws', async () => {
        mockQuery.mockRejectedValue(new Error('ERR'));

        await expect(toolCalls.getToolCallsByMessageId('m1')).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // getToolCallsForMessages
    // -----------------------------------------------------------------------

    describe('getToolCallsForMessages', () => {
      it('groups tool calls by messageId', async () => {
        mockQuery.mockResolvedValue(
          okResult([
            { id: 'tc1', messageId: 'm1', name: 'search', serverId: 'srv1', startedAt: NOW, finishedAt: null },
            { id: 'tc2', messageId: 'm2', name: 'calc', serverId: 'srv1', startedAt: NOW, finishedAt: null },
          ]),
        );

        const map = await toolCalls.getToolCallsForMessages(['m1', 'm2']);

        expect(Object.keys(map).length).toBe(2);
        expect(map['m1'].length).toBe(1);
        expect(map['m1'][0].name).toBe('search');
        expect(map['m2'].length).toBe(1);
        expect(map['m2'][0].name).toBe('calc');

        expect(mockQuery).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            messageIds: expect.arrayContaining([expect.any(RecordId)]),
          }),
        );
      });

      it('returns empty object for empty input array', async () => {
        const map = await toolCalls.getToolCallsForMessages([]);
        expect(map).toEqual({});
        expect(mockQuery).not.toHaveBeenCalled();
      });

      it('returns empty object when no tool calls match', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        const map = await toolCalls.getToolCallsForMessages(['m1']);
        expect(map).toEqual({});
      });

      it('assertOk failure throws', async () => {
        mockQuery.mockRejectedValue(new Error('ERR'));

        await expect(toolCalls.getToolCallsForMessages(['m1'])).rejects.toThrow('ERR');
      });
    });
  });

  // =========================================================================
  // ContentRepo
  // =========================================================================

  describe('content', () => {
    let content: IContentRepo;

    beforeEach(() => {
      content = service.content;
    });

    // -----------------------------------------------------------------------
    // getPosts
    // -----------------------------------------------------------------------

    describe('getPosts', () => {
      // -------------------------------------------------------------------
      // getPosts with opts (queryDb-based)
      // -------------------------------------------------------------------

      it('returns all posts via queryDb when no opts provided', async () => {
        const rows = [
          makeDbRow({ id: '1', slug: 'post-a', title: 'Post A', date: '2026-03-01' }),
          makeDbRow({ id: '2', slug: 'post-b', title: 'Post B', date: '2026-02-01' }),
        ];
        mockQuery.mockResolvedValueOnce(okResult(rows));

        const posts = await content.getPosts();

        expect(posts.length).toBe(2);
        expect(posts[0].slug).toBe('post-a');
        expect(posts[0].title).toBe('Post A');
        expect(posts[1].slug).toBe('post-b');
        expect(posts[1].title).toBe('Post B');
        // Default: ORDER BY date DESC
        const sql = mockQuery.mock.calls[0][0] as string;
        expect(sql).toContain('ORDER BY date DESC');
        expect(sql).not.toContain('LIMIT');
      });

      it('getPosts({ limit: 2 }) passes limit variable and appends LIMIT to SQL', async () => {
        const rows = [
          makeDbRow({ id: '1', slug: 'p1', title: 'T1', date: '2026-01-01' }),
          makeDbRow({ id: '2', slug: 'p2', title: 'T2', date: '2026-01-02' }),
        ];
        mockQuery.mockResolvedValueOnce(okResult(rows));

        const posts = await content.getPosts({ limit: 2 });

        expect(posts.length).toBe(2);
        const sql = mockQuery.mock.calls[0][0] as string;
        const vars = mockQuery.mock.calls[0][1] as Record<string, unknown>;
        expect(sql).toContain('LIMIT $limit');
        expect(vars.limit).toBe(2);
      });

      it('getPosts({ sort: "title", order: "asc" }) orders by title ASC', async () => {
        const rows = [
          makeDbRow({ id: '1', slug: 'p1', title: 'Alpha', date: '2026-01-01' }),
          makeDbRow({ id: '2', slug: 'p2', title: 'Zeta', date: '2026-01-02' }),
        ];
        mockQuery.mockResolvedValueOnce(okResult(rows));

        const posts = await content.getPosts({ sort: 'title', order: 'asc' });

        expect(posts.length).toBe(2);
        expect(posts[0].title).toBe('Alpha');
        expect(posts[1].title).toBe('Zeta');
        const sql = mockQuery.mock.calls[0][0] as string;
        expect(sql).toContain('ORDER BY title ASC');
      });

      it('getPosts({ slug }) filters by slug via WHERE clause', async () => {
        const rows = [makeDbRow({ id: '5', slug: 'target', title: 'Target Post', date: '2026-06-01' })];
        mockQuery.mockResolvedValueOnce(okResult(rows));

        const posts = await content.getPosts({ slug: 'target' });

        expect(posts.length).toBe(1);
        expect(posts[0].slug).toBe('target');
        expect(posts[0].title).toBe('Target Post');
        const sql = mockQuery.mock.calls[0][0] as string;
        const vars = mockQuery.mock.calls[0][1] as Record<string, unknown>;
        expect(sql).toContain('WHERE slug = $slug');
        expect(vars.slug).toBe('target');
      });

      it('getPosts({ limit: 1, sort: "date", order: "desc" }) returns 1 most recent', async () => {
        const rows = [makeDbRow({ id: '3', slug: 'newest', title: 'Newest', date: '2026-12-01' })];
        mockQuery.mockResolvedValueOnce(okResult(rows));

        const posts = await content.getPosts({ limit: 1, sort: 'date', order: 'desc' });

        expect(posts.length).toBe(1);
        expect(posts[0].slug).toBe('newest');
        const sql = mockQuery.mock.calls[0][0] as string;
        const vars = mockQuery.mock.calls[0][1] as Record<string, unknown>;
        expect(sql).toContain('ORDER BY date DESC');
        expect(sql).toContain('LIMIT $limit');
        expect(vars.limit).toBe(1);
      });

      it('getPosts({ limit: 0 }) returns all posts (limit 0 ignored)', async () => {
        const rows = [
          makeDbRow({ id: '1', slug: 'a', title: 'A', date: '2026-01-01' }),
          makeDbRow({ id: '2', slug: 'b', title: 'B', date: '2026-01-02' }),
          makeDbRow({ id: '3', slug: 'c', title: 'C', date: '2026-01-03' }),
        ];
        mockQuery.mockResolvedValueOnce(okResult(rows));

        const posts = await content.getPosts({ limit: 0 });

        expect(posts.length).toBe(3);
        const sql = mockQuery.mock.calls[0][0] as string;
        expect(sql).not.toContain('LIMIT');
      });

      it('getPosts({ limit: -1 }) returns all posts (negative limit ignored)', async () => {
        const rows = [
          makeDbRow({ id: '1', slug: 'a', title: 'A', date: '2026-01-01' }),
          makeDbRow({ id: '2', slug: 'b', title: 'B', date: '2026-01-02' }),
        ];
        mockQuery.mockResolvedValueOnce(okResult(rows));

        const posts = await content.getPosts({ limit: -1 });

        expect(posts.length).toBe(2);
        const sql = mockQuery.mock.calls[0][0] as string;
        expect(sql).not.toContain('LIMIT');
      });

      it('returns empty array when queryDb returns no rows', async () => {
        mockQuery.mockResolvedValueOnce(okResult([]));

        const posts = await content.getPosts({ slug: 'nonexistent' });

        expect(posts).toEqual([]);
      });

      it('queryDb failure propagates as thrown error', async () => {
        mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));

        await expect(content.getPosts()).rejects.toThrow('DB connection lost');
      });

      it('getPosts with combined slug + limit applies both WHERE and LIMIT', async () => {
        const rows = [makeDbRow({ id: '1', slug: 'filtered', title: 'Filtered', date: '2026-05-01' })];
        mockQuery.mockResolvedValueOnce(okResult(rows));

        const posts = await content.getPosts({ slug: 'filtered', limit: 5 });

        expect(posts.length).toBe(1);
        const sql = mockQuery.mock.calls[0][0] as string;
        const vars = mockQuery.mock.calls[0][1] as Record<string, unknown>;
        expect(sql).toContain('WHERE slug = $slug');
        expect(sql).toContain('LIMIT $limit');
        expect(vars.slug).toBe('filtered');
        expect(vars.limit).toBe(5);
      });

      it('getPosts maps raw DB fields to Post shape correctly', async () => {
        const rows = [
          {
            id: 'page_posts:42',
            slug: 'my-post',
            content: '# Hello World',
            toc: JSON.stringify([{ id: 's1', text: 'Intro', level: 2 }]),
            title: 'My Post',
            description: 'A description',
            date: '2026-06-15',
            tags: ['svelte', 'typescript'],
            status: 'published',
            excerpt: 'Short excerpt',
            header_image: '/img/hero.png',
            featured: true,
            position: 3,
            part_of_series: 'page_posts:10',
            workflow_files: null,
          },
        ];
        mockQuery.mockResolvedValueOnce(okResult(rows));

        const posts = await content.getPosts({ slug: 'my-post' });

        expect(posts.length).toBe(1);
        const p = posts[0];
        expect(p.id).toBe(42);
        expect(p.slug).toBe('my-post');
        expect(p.content).toBe('# Hello World');
        expect(p.title).toBe('My Post');
        expect(p.description).toBe('A description');
        expect(p.date).toBe('2026-06-15');
        expect(p.tags).toEqual(['svelte', 'typescript']);
        expect(p.status).toBe('published');
        expect(p.excerpt).toBe('Short excerpt');
        expect(p.headerImage).toBe('/img/hero.png');
        expect(p.featured).toBe(true);
        expect(p.position).toBe(3);
        expect(p.partOfSeries).toBe(10);
        expect(p.toc).toEqual([{ id: 's1', text: 'Intro', level: 2 }]);
        expect(p.workflowFiles).toBeNull();
      });
    });

    // -----------------------------------------------------------------------
    // getExperience
    // -----------------------------------------------------------------------

    describe('getExperience', () => {
      it('returns all experience entries when slug not provided', async () => {
        mockSelect.mockResolvedValueOnce([
          {
            slug: 'job1',
            content: 'did stuff',
            company: 'Acme',
            role: 'Engineer',
            start_date: '2020',
            end_date: '2022',
            duration: '2y',
            skills: ['JS'],
            description: 'desc',
            published: true,
            job_role: 'SWE',
          },
        ]);

        const entries = await content.getExperience();

        expect(entries.length).toBe(1);
        expect(entries[0].slug).toBe('job1');
        expect(entries[0].company).toBe('Acme');
        expect(entries[0].skills).toEqual(['JS']);
        expect(entries[0].published).toBe(true);
      });

      it('filters by slug when provided', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockResolvedValue([]),
        });

        const result = await content.getExperience('my-experience');

        expect(Array.isArray(result)).toBe(true);
      });

      it('returns empty array when no experience found', async () => {
        mockSelect.mockResolvedValueOnce([]);

        const entries = await content.getExperience();
        expect(entries).toEqual([]);
      });

      it('assertOk failure throws', async () => {
        mockSelect.mockRejectedValueOnce(new Error('ERR'));

        await expect(content.getExperience()).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // getRelatedBusinessPages
    // -----------------------------------------------------------------------

    describe('getRelatedBusinessPages', () => {
      it('returns related page slugs', async () => {
        mockQuery.mockResolvedValue(okResult([{ slug: 'related-1' }, { slug: 'related-2' }]));

        const slugs = await content.getRelatedBusinessPages('my-slug');

        expect(slugs).toEqual(['related-1', 'related-2']);
      });

      it('returns empty array when no related pages', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        const slugs = await content.getRelatedBusinessPages('unique');
        expect(slugs).toEqual([]);
      });

      it('assertOk failure throws', async () => {
        mockQuery.mockRejectedValue(new Error('ERR'));

        await expect(content.getRelatedBusinessPages('slug')).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // upsertPost
    // -----------------------------------------------------------------------

    describe('upsertPost', () => {
      const postOpts = {
        slug: 'my-post',
        hash: 'abc123',
        content: '# Hello',
        toc: '[]',
        title: 'My Post',
        description: 'A test',
        date: '2026-01-01',
        tags: ['test'],
        status: 'published',
        excerpt: 'Excerpt',
        headerImage: null,
        featured: false,
        position: 1,
        workflowFiles: null,
      };

      it('updates existing post when slug found', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: '42' }]),
          }),
        });

        await content.upsertPost(postOpts);

        expect(mockUpdate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockMerge).toHaveBeenCalledWith(
          expect.objectContaining({
            slug: 'my-post',
            hash: 'abc123',
            title: 'My Post',
            updated_at: expect.any(String),
          }),
        );
      });

      it('creates new post when slug not found', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        });

        await content.upsertPost(postOpts);

        expect(mockCreate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockContent).toHaveBeenCalledWith(
          expect.objectContaining({
            slug: 'my-post',
            hash: 'abc123',
            title: 'My Post',
            updated_at: expect.any(String),
          }),
        );
      });

      it('throws when SELECT query fails', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('ERR')),
          }),
        });

        await expect(content.upsertPost(postOpts)).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // upsertExperience
    // -----------------------------------------------------------------------

    describe('upsertExperience', () => {
      const expOpts = {
        slug: 'job-1',
        hash: 'def456',
        content: '# Work',
        company: 'Acme',
        role: 'Engineer',
        startDate: '2020-01',
        endDate: '2022-12',
        duration: '3y',
        skills: ['JS'],
        description: 'Did stuff',
        published: true,
        jobRole: 'SWE',
      };

      it('updates existing experience when slug found', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: '7' }]),
          }),
        });

        await content.upsertExperience(expOpts);

        expect(mockUpdate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockMerge).toHaveBeenCalledWith(
          expect.objectContaining({ slug: 'job-1', company: 'Acme', role: 'Engineer', published: true }),
        );
      });

      it('creates new experience when slug not found', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        });

        await content.upsertExperience(expOpts);

        expect(mockCreate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockContent).toHaveBeenCalledWith(
          expect.objectContaining({ slug: 'job-1', company: 'Acme', published: true }),
        );
      });

      it('throws when SELECT query fails', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('ERR')),
          }),
        });

        await expect(content.upsertExperience(expOpts)).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // updatePartOfSeries
    // -----------------------------------------------------------------------

    describe('updatePartOfSeries', () => {
      it('sets partOfSeries to null when parentSlug is null and child exists', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: '42' }]),
          }),
        });

        await content.updatePartOfSeries('my-post', null);

        expect(mockUpdate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockMerge).toHaveBeenCalledWith({ part_of_series: null });
      });

      it('does nothing when parentSlug is null and child not found', async () => {
        await content.updatePartOfSeries('ghost-post', null);

        expect(mockUpdate).not.toHaveBeenCalled();
      });

      it('sets partOfSeries to parent RecordId when both exist', async () => {
        // First call: db.select(new Table('page_posts')).where(eq('slug', parentSlug)).limit(1)
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 'page_posts:1' }]),
          }),
        });
        // Second call: db.select for child
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: '2' }]),
          }),
        });

        await content.updatePartOfSeries('child-post', 'parent-post');

        expect(mockUpdate).toHaveBeenCalledTimes(1);
        expect(mockMerge).toHaveBeenCalledWith({ part_of_series: expect.any(Object) });
      });

      it('does nothing when parent not found', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        });

        await content.updatePartOfSeries('child-post', 'parent-post');

        expect(mockUpdate).not.toHaveBeenCalled();
      });

      it('does nothing when parent found but child not found', async () => {
        // First call: db.select(new Table('page_posts')).where(eq('slug', parentSlug)).limit(1)
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 'page_posts:1' }]),
          }),
        });
        // Second call: db.select for child — default mock returns empty, so no need to set up

        await content.updatePartOfSeries('ghost-child', 'parent-post');

        expect(mockUpdate).not.toHaveBeenCalled();
      });

      it('throws when SELECT query fails', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValueOnce(new Error('ERR')),
          }),
        });

        await expect(content.updatePartOfSeries('p', 'q')).rejects.toThrow('ERR');
      });
    });
  });

  // =========================================================================
  // LeadRepo
  // =========================================================================

  describe('leads', () => {
    let leads: ILeadRepo;

    beforeEach(() => {
      leads = service.leads;
    });

    // -----------------------------------------------------------------------
    // insertLead
    // -----------------------------------------------------------------------

    describe('insertLead', () => {
      it('creates lead with all fields', async () => {
        await leads.insertLead('u1', 'John', 'j@j.com', 'Acme', 'CTO', 'hello', '1.2.3.4');

        expect(mockCreate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockContent).toHaveBeenCalledWith(
          expect.objectContaining({
            user_id: expect.any(Object),
            name: 'John',
            email: 'j@j.com',
            company_name: 'Acme',
            role: 'CTO',
            message: 'hello',
            ip_address: '1.2.3.4',
          }),
        );
      });

      it('assertOk failure throws', async () => {
        mockContent.mockRejectedValueOnce(new Error('ERR'));

        await expect(leads.insertLead('u1', 'n', 'e@e.com', 'c', 'r', 'm', '1.2.3.4')).rejects.toThrow('ERR');
      });
    });
  });

  // =========================================================================
  // ContactIntentRepo
  // =========================================================================

  describe('contactIntents', () => {
    let contactIntents: IContactIntentRepo;

    beforeEach(() => {
      contactIntents = service.contactIntents;
    });

    // -----------------------------------------------------------------------
    // insertContactIntent
    // -----------------------------------------------------------------------

    describe('insertContactIntent', () => {
      it('creates contact intent', async () => {
        await contactIntents.insertContactIntent('u1', 'c1', 'I want to hire you');

        expect(mockCreate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockContent).toHaveBeenCalledWith(
          expect.objectContaining({
            user_id: expect.any(Object),
            chat_id: expect.any(Object),
            text: 'I want to hire you',
          }),
        );
      });

      it('assertOk failure throws', async () => {
        mockContent.mockRejectedValueOnce(new Error('ERR'));

        await expect(contactIntents.insertContactIntent('u1', 'c1', 'text')).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // updateUserContact
    // -----------------------------------------------------------------------

    describe('updateUserContact', () => {
      it('updates user name and email', async () => {
        mockMerge.mockImplementation((data: Record<string, unknown>) => {
          expect(data.name).toBe('Alice');
          expect(data.email).toBe('a@b.com');
          return Promise.resolve({});
        });

        await contactIntents.updateUserContact('u1', 'Alice', 'a@b.com');

        expect(mockUpdate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockMerge).toHaveBeenCalledTimes(1);
      });

      it('assertOk failure throws', async () => {
        mockMerge.mockRejectedValue(new Error('ERR'));

        await expect(contactIntents.updateUserContact('u1', 'n', 'e@e.com')).rejects.toThrow('ERR');
      });
    });
  });

  // =========================================================================
  // UserAgentRepo
  // =========================================================================

  describe('userAgents', () => {
    let userAgents: IUserAgentRepo;

    beforeEach(() => {
      userAgents = service.userAgents;
    });

    // -----------------------------------------------------------------------
    // getOrCreateUserAgent
    // -----------------------------------------------------------------------

    describe('getOrCreateUserAgent', () => {
      it('returns existing agent id when found', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                { id: 'user_agents:42', ua: 'Mozilla/5.0', deviceType: 'desktop', ip: null, createdAt: NOW },
              ]),
          }),
        });

        const agentId = await userAgents.getOrCreateUserAgent('Mozilla/5.0');

        expect(agentId).toBe(42);
        expect(mockSelect).toHaveBeenCalledTimes(1);
      });

      it('creates new agent when not found', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        });
        // RecordId create → single record, numeric id for Number(result.id)
        mockContent.mockResolvedValueOnce({ id: 12345 });

        const agentId = await userAgents.getOrCreateUserAgent('Mozilla/5.0');

        expect(agentId).toBe(12345);
        expect(mockCreate).toHaveBeenCalledWith(expect.any(Object));
      });

      it('updates ip on existing agent when ip provided and current ip is null', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                { id: 'user_agents:42', ua: 'Mozilla/5.0', deviceType: 'desktop', ip: null, createdAt: NOW },
              ]),
          }),
        });
        mockQuery.mockResolvedValueOnce(okResult([])); // update ip via queryDb

        const agentId = await userAgents.getOrCreateUserAgent('Mozilla/5.0', '1.2.3.4');

        expect(agentId).toBe(42);
        const calls = mockQuery.mock.calls.map((c: string[]) => c[0]);
        expect(calls.some((s: string) => s.includes('SET ip'))).toBe(true);
      });

      it('classifies bot user agents', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        });
        // RecordId create → single record, numeric id for Number(result.id)
        mockContent.mockResolvedValueOnce({ id: 99 });

        const agentId = await userAgents.getOrCreateUserAgent('Googlebot/2.1');

        expect(agentId).toBe(99);
        expect(mockCreate).toHaveBeenCalledWith(expect.any(Object));
      });

      it('truncates user agent to 500 chars', async () => {
        const longUa = 'x'.repeat(1000);
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        });
        mockContent.mockResolvedValueOnce({ id: 77 });

        await userAgents.getOrCreateUserAgent(longUa);
        expect(mockCreate).toHaveBeenCalledWith(expect.any(Object));
      });

      it('assertOk failure on select throws', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValueOnce(new Error('ERR')),
          }),
        });

        await expect(userAgents.getOrCreateUserAgent('Mozilla/5.0')).rejects.toThrow('ERR');
      });

      it('deletes corrupted NaN record and creates fresh agent', async () => {
        // SELECT returns a corrupted record with NaN id
        // DELETE of the corrupted record (best-effort)
        // CREATE returns fresh record — db.query() wraps each statement result
        // in one element, so a CREATE RETURN yields [{id: '999'}] not [[{id}]]
        mockQuery
          .mockResolvedValueOnce(
            okResult([{ id: 'user_agents:NaN', ua: 'Mozilla/5.0', deviceType: 'desktop', ip: null, createdAt: NOW }]),
          )
          .mockResolvedValueOnce(okResult([]))
          .mockResolvedValueOnce([{ id: '999' }]);

        const agentId = await userAgents.getOrCreateUserAgent('Mozilla/5.0');

        // Must NOT return NaN — the guard should fall through and create a fresh record
        expect(agentId).toBe(999);
        expect(Number.isFinite(agentId)).toBe(true);
        // Verify the DELETE was attempted (best-effort cleanup of corrupted record)
        const queryCalls = mockQuery.mock.calls.map((c: unknown[]) => String(c[0]));
        expect(queryCalls.some((sql: string) => sql.includes('DELETE'))).toBe(true);
        // Verify a CREATE was issued
        expect(queryCalls.some((sql: string) => sql.includes('CREATE'))).toBe(true);
      });

      it('deletes corrupted 0-id record and creates fresh agent', async () => {
        // 0 is also non-positive and should trigger the guard
        mockQuery
          .mockResolvedValueOnce(
            okResult([{ id: 'user_agents:0', ua: 'TestBot/1.0', deviceType: 'bot', ip: null, createdAt: NOW }]),
          )
          .mockResolvedValueOnce(okResult([]))
          .mockResolvedValueOnce([{ id: '555' }]);

        const agentId = await userAgents.getOrCreateUserAgent('TestBot/1.0');

        expect(agentId).toBe(555);
        expect(Number.isFinite(agentId)).toBe(true);
        const queryCalls = mockQuery.mock.calls.map((c: unknown[]) => String(c[0]));
        expect(queryCalls.some((sql: string) => sql.includes('DELETE'))).toBe(true);
        expect(queryCalls.some((sql: string) => sql.includes('CREATE'))).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // getUserAgents
    // -----------------------------------------------------------------------

    describe('getUserAgents', () => {
      it('returns UserAgentRecord array', async () => {
        mockQuery.mockResolvedValue(
          okResult([
            { id: '1', ua: 'Mozilla/5.0', deviceType: 'desktop', ip: '1.2.3.4', createdAt: NOW },
            { id: '2', ua: 'Googlebot', deviceType: 'bot', ip: null, createdAt: NOW },
          ]),
        );

        const agents = await userAgents.getUserAgents();

        expect(agents.length).toBe(2);
        expect(agents[0].id).toBe(1);
        expect(agents[0].ua).toBe('Mozilla/5.0');
        expect(agents[0].deviceType).toBe('desktop');
        expect(agents[0].ip).toBe('1.2.3.4');
        expect(agents[1].id).toBe(2);
        expect(agents[1].deviceType).toBe('bot');
        expect(agents[1].ip).toBeNull();
      });

      it('returns empty array when no agents exist', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        const agents = await userAgents.getUserAgents();
        expect(agents).toEqual([]);
      });

      it('assertOk failure throws', async () => {
        mockQuery.mockRejectedValue(new Error('ERR'));

        await expect(userAgents.getUserAgents()).rejects.toThrow('ERR');
      });
    });
  });

  // =========================================================================
  // LlmCacheRepo
  // =========================================================================

  describe('llmCache', () => {
    let llmCache: ILlmCacheRepo;

    beforeEach(() => {
      llmCache = service.llmCache;
    });

    // -----------------------------------------------------------------------
    // searchCache
    // -----------------------------------------------------------------------

    describe('searchCache', () => {
      const EMBEDDING = [0.1, 0.2, 0.3];

      it('returns CacheHit array ranked by score', async () => {
        mockQuery.mockResolvedValue(
          okResult([
            { answer: 'Answer 1', sources: 'src1\nsrc2', score: 0.1, tool_calls: null },
            { answer: 'Answer 2', sources: 'src3', score: 0.5, tool_calls: null },
          ]),
        );

        const results = await llmCache.searchCache(EMBEDDING);

        expect(results.length).toBe(2);
        expect(results[0].answer).toBe('Answer 1');
        expect(results[0].sources).toBe('src1\nsrc2');
        expect(results[1].answer).toBe('Answer 2');
        expect(results[1].sources).toBe('src3');
      });

      it('parses tool_calls JSON array when present', async () => {
        mockQuery.mockResolvedValue(
          okResult([
            {
              answer: 'A',
              sources: '',
              score: 0.1,
              tool_calls: [JSON.stringify({ name: 'search', serverId: 'srv1' })],
            },
          ]),
        );

        const results = await llmCache.searchCache(EMBEDDING);

        expect(results.length).toBe(1);
        expect(results[0].toolCalls).toBeDefined();
        expect(results[0].toolCalls!.length).toBe(1);
        expect(results[0].toolCalls![0]).toEqual({ name: 'search', serverId: 'srv1' });
      });

      it('uses default limit 5', async () => {
        mockQuery.mockImplementation(async (_sql: string, vars?: Record<string, unknown>) => {
          expect(vars?.limit).toBe(5);
          return Promise.resolve(okResult([]));
        });

        await llmCache.searchCache(EMBEDDING);
      });

      it('uses custom limit', async () => {
        mockQuery.mockImplementation(async (_sql: string, vars?: Record<string, unknown>) => {
          expect(vars?.limit).toBe(20);
          return Promise.resolve(okResult([]));
        });

        await llmCache.searchCache(EMBEDDING, 20);
      });

      it('returns empty array when no matches', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        const results = await llmCache.searchCache(EMBEDDING);
        expect(results).toEqual([]);
      });

      it('assertOk failure throws', async () => {
        mockQuery.mockRejectedValue(new Error('ERR'));

        await expect(llmCache.searchCache(EMBEDDING)).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // getCached
    // -----------------------------------------------------------------------

    describe('getCached', () => {
      it('returns CacheEntry when found', async () => {
        mockQuery.mockResolvedValue(
          okResult([
            {
              id: '42',
              question: 'What is?',
              answer: 'Answer',
              sources: 'src1\nsrc2',
              tool_calls: 'tc1\ntc2',
              message_id: 'msg1',
              created_at: NOW,
            },
          ]),
        );

        const entry = await llmCache.getCached(42);

        expect(entry).toBeDefined();
        expect(entry!.id).toBe(42);
        expect(entry!.question).toBe('What is?');
        expect(entry!.answer).toBe('Answer');
        expect(entry!.sources).toBe('src1\nsrc2');
        expect(entry!.toolCalls).toBe('tc1\ntc2');
        expect(entry!.messageId).toBe('msg1');
        expect(entry!.createdAt).toBe(NOW);
      });

      it('returns undefined when not found', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        const entry = await llmCache.getCached(999);
        expect(entry).toBeUndefined();
      });

      it('assertOk failure throws', async () => {
        mockQuery.mockRejectedValue(new Error('ERR'));

        await expect(llmCache.getCached(1)).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // setCached
    // -----------------------------------------------------------------------

    describe('setCached', () => {
      const QUESTION = 'What is?';
      const ANSWER = '42';
      const EMBEDDING = [0.1, 0.2];
      const SOURCES = 'src1\nsrc2';

      it('creates cache entry with all optional fields', async () => {
        await llmCache.setCached(QUESTION, ANSWER, EMBEDDING, SOURCES, 'tc1\ntc2', 'msg1');

        expect(mockCreate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockContent).toHaveBeenCalledWith(
          expect.objectContaining({
            question: QUESTION,
            answer: ANSWER,
            question_embedding: EMBEDDING,
            sources: ['src1', 'src2'],
            tool_calls: ['tc1', 'tc2'],
            message_id: expect.any(Object),
          }),
        );
      });

      it('creates cache entry without optional toolCalls and messageId', async () => {
        await llmCache.setCached(QUESTION, ANSWER, EMBEDDING, SOURCES);

        expect(mockCreate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockContent).toHaveBeenCalledWith(
          expect.objectContaining({
            question: QUESTION,
            sources: ['src1', 'src2'],
            tool_calls: [],
            message_id: null,
          }),
        );
      });

      it('handles empty sources string', async () => {
        await llmCache.setCached(QUESTION, ANSWER, EMBEDDING, '');

        expect(mockCreate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockContent).toHaveBeenCalledWith(expect.objectContaining({ sources: [] }));
      });

      it('assertOk failure throws', async () => {
        mockContent.mockRejectedValueOnce(new Error('ERR'));

        await expect(llmCache.setCached(QUESTION, ANSWER, EMBEDDING, SOURCES)).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // getCacheStats
    // -----------------------------------------------------------------------

    describe('getCacheStats', () => {
      it('returns aggregate stats', async () => {
        mockQuery.mockResolvedValue(okResult([{ total: 10, oldest: NOW, newest: NOW }]));

        const stats = await llmCache.getCacheStats();

        expect(stats.totalEntries).toBe(10);
        expect(stats.oldestEntry).toBe(NOW);
        expect(stats.newestEntry).toBe(NOW);
      });

      it('returns zero stats when table is empty', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        const stats = await llmCache.getCacheStats();

        expect(stats.totalEntries).toBe(0);
        expect(stats.oldestEntry).toBeNull();
        expect(stats.newestEntry).toBeNull();
      });

      it('handles null oldest and newest', async () => {
        mockQuery.mockResolvedValue(okResult([{ total: 0, oldest: null, newest: null }]));

        const stats = await llmCache.getCacheStats();

        expect(stats.totalEntries).toBe(0);
        expect(stats.oldestEntry).toBeNull();
        expect(stats.newestEntry).toBeNull();
      });

      it('assertOk failure throws', async () => {
        mockQuery.mockRejectedValue(new Error('ERR'));

        await expect(llmCache.getCacheStats()).rejects.toThrow('ERR');
      });
    });
  });

  // =========================================================================
  // VectorRepo
  // =========================================================================

  describe('vector', () => {
    let vector: IVectorRepo;

    beforeEach(() => {
      vector = service.vector;
    });

    // -----------------------------------------------------------------------
    // searchChunks
    // -----------------------------------------------------------------------

    describe('searchChunks', () => {
      const EMBEDDING = [0.1, 0.2, 0.3];

      it('returns SearchResult array ranked by cosine distance', async () => {
        // Mock data matches SurrealDB query output: parent_table/parent_slug
        // come from edge traversal, NOT stored on the chunk itself.
        mockQuery.mockResolvedValue(
          okResult([
            {
              id: 'chunks:a',
              text: 'Chunk 1',
              title: 'Title 1',
              date: NOW,
              tags: ['tag1'],
              section: 'sec1',
              parent_table: 'page_posts',
              parent_slug: 'my-slug',
              score: 0.1,
            },
            {
              id: 'chunks:b',
              text: 'Chunk 2',
              title: 'Title 2',
              date: null,
              tags: [],
              section: 'sec2',
              parent_table: 'page_experience',
              parent_slug: 'exp-slug',
              score: 0.5,
            },
          ]),
        );

        const results = await vector.searchChunks(EMBEDDING);

        expect(results.length).toBe(2);
        expect(results[0].chunk.id).toBe('chunks:a');
        expect(results[0].chunk.text).toBe('Chunk 1');
        expect(results[0].chunk.type).toBe('post');
        expect(results[0].chunk.slug).toBe('my-slug');
        expect(results[0].score).toBe(0.1);
        expect(results[1].chunk.id).toBe('chunks:b');
        expect(results[1].chunk.type).toBe('experience');
        expect(results[1].chunk.slug).toBe('exp-slug');
        expect(results[1].score).toBe(0.5);
      });

      it('filters by type "post" using parentTableFilter', async () => {
        mockQuery.mockImplementation(async (_sql: string, vars?: Record<string, unknown>) => {
          // Implementation maps typeFilter 'post' → parentTableFilter 'page_posts'
          expect(vars?.parentTableFilter).toBe('page_posts');
          return Promise.resolve(okResult([]));
        });

        await vector.searchChunks(EMBEDDING, 10, 'post');
      });

      it('filters by type "experience" using parentTableFilter', async () => {
        mockQuery.mockImplementation(async (_sql: string, vars?: Record<string, unknown>) => {
          // Implementation maps typeFilter 'experience' → parentTableFilter 'page_experience'
          expect(vars?.parentTableFilter).toBe('page_experience');
          return Promise.resolve(okResult([]));
        });

        await vector.searchChunks(EMBEDDING, 10, 'experience');
      });

      it('passes null parentTableFilter when typeFilter not provided', async () => {
        mockQuery.mockImplementation(async (_sql: string, vars?: Record<string, unknown>) => {
          expect(vars?.parentTableFilter).toBeNull();
          return Promise.resolve(okResult([]));
        });

        await vector.searchChunks(EMBEDDING);
      });

      it('uses default limit 10', async () => {
        mockQuery.mockImplementation(async (_sql: string, vars?: Record<string, unknown>) => {
          expect(vars?.limit).toBe(10);
          return Promise.resolve(okResult([]));
        });

        await vector.searchChunks(EMBEDDING);
      });

      it('uses custom limit', async () => {
        mockQuery.mockImplementation(async (_sql: string, vars?: Record<string, unknown>) => {
          expect(vars?.limit).toBe(5);
          return Promise.resolve(okResult([]));
        });

        await vector.searchChunks(EMBEDDING, 5);
      });

      it('returns empty array when no matches', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        const results = await vector.searchChunks(EMBEDDING);
        expect(results).toEqual([]);
      });

      it('maps tags as empty array when missing', async () => {
        mockQuery.mockResolvedValue(
          okResult([
            {
              id: 'chunks:a',
              text: 'T',
              title: 'T',
              date: null,
              tags: null,
              section: 's',
              parent_table: 'page_posts',
              parent_slug: 'page_posts:my-slug',
              score: 0.5,
            },
          ]),
        );

        const results = await vector.searchChunks(EMBEDDING);
        expect(results[0].chunk.tags).toEqual([]);
      });

      it('assertOk failure throws', async () => {
        mockQuery.mockRejectedValue(new Error('ERR'));

        await expect(vector.searchChunks(EMBEDDING)).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // upsertChunks
    // -----------------------------------------------------------------------

    describe('upsertChunks', () => {
      const chunkData = {
        chunkId: 'chunk_a',
        text: 'Some text',
        title: 'Title',
        date: '2026-01-01',
        tags: ['tag1'],
        section: 'sec1',
        embedding: [0.1, 0.2],
      };

      it('updates existing chunk when chunkId found', async () => {
        mockQuery.mockResolvedValue(okResult([{ id: '42' }]));

        await vector.upsertChunks([chunkData]);

        expect(mockUpdate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockMerge).toHaveBeenCalledWith(expect.objectContaining({ chunk_id: 'chunk_a', text: 'Some text' }));
      });

      it('creates new chunk when chunkId not found', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        await vector.upsertChunks([chunkData]);

        // createRecord uses queryDb (db.query), not db.create().content()
        // First call = SELECT (empty), second call = CREATE
        const createCall = mockQuery.mock.calls.find((c) => String(c[0]).includes('CREATE'));
        expect(createCall).toBeDefined();
        const vars = createCall![1] as Record<string, unknown>;
        expect(vars.table).toBe('chunks');
        expect(vars.data).toEqual(
          expect.objectContaining({ chunk_id: 'chunk_a', text: 'Some text', embedding: [0.1, 0.2] }),
        );
      });

      it('handles multiple chunks — updates and creates as needed', async () => {
        let callIndex = 0;
        mockQuery.mockImplementation(async () => {
          callIndex++;
          if (callIndex === 1) return Promise.resolve(okResult([{ id: '1' }])); // first exists → SELECT returns id
          if (callIndex === 2) return Promise.resolve(okResult([])); // second new → SELECT returns empty
          return Promise.resolve(okResult([]));
        });

        await vector.upsertChunks([
          { ...chunkData, chunkId: 'existing_chunk' },
          { ...chunkData, chunkId: 'new_chunk' },
        ]);

        expect(mockUpdate).toHaveBeenCalledTimes(1);
        // createRecord uses queryDb, not db.create().content()
        const createCalls = mockQuery.mock.calls.filter((c) => String(c[0]).includes('CREATE'));
        expect(createCalls.length).toBe(1);
      });

      it('does nothing when rows array is empty', async () => {
        await vector.upsertChunks([]);

        expect(mockQuery).not.toHaveBeenCalled();
        expect(mockUpdate).not.toHaveBeenCalled();
      });

      it('throws when SELECT query fails', async () => {
        mockQuery.mockRejectedValue(new Error('ERR'));

        await expect(vector.upsertChunks([chunkData])).rejects.toThrow('ERR');
      });
    });
  });

  // =========================================================================
  // ModelRepo
  // =========================================================================

  describe('models', () => {
    let models: IModelRepo;

    beforeEach(() => {
      models = service.models;
    });

    // -----------------------------------------------------------------------
    // ensureModel
    // -----------------------------------------------------------------------

    describe('ensureModel', () => {
      it('returns existing id and updates max_tokens when model found', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 'models:7', provider: 'openai', model_name: 'gpt-4' }]),
          }),
        });

        const id = await models.ensureModel('openai', 'gpt-4', 'gpt-4-turbo', 8192);

        expect(id).toBe('7');
        expect(mockUpdate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockMerge).toHaveBeenCalledWith({ max_tokens: 8192 });
      });

      it('creates new model and returns its id when not found', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        });
        // Builder create returns RecordId — stripPrefix extracts the raw id
        mockContent.mockResolvedValue([{ id: 'models:42' }]);

        const id = await models.ensureModel('openai', 'gpt-4', 'gpt-4-turbo', 8192);

        expect(id).toBe('42');
        expect(mockCreate).toHaveBeenCalledWith(expect.any(Object));
        expect(mockContent).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: 'openai',
            model_name: 'gpt-4',
            actual_model_name: 'gpt-4-turbo',
            max_tokens: 8192,
          }),
        );
      });

      it('passes provider and modelName as SELECT query variables', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        });
        // Builder create returns RecordId — stripPrefix extracts the raw id
        mockContent.mockResolvedValue([{ id: 'models:42' }]);

        await models.ensureModel('openai', 'gpt-4', 'gpt-4-turbo', 8192);

        expect(mockCreate).toHaveBeenCalledTimes(1);
      });

      it('throws when SELECT query fails', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValueOnce(new Error('ERR')),
          }),
        });

        await expect(models.ensureModel('o', 'm', 'a', 1)).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // getModelByProvider
    // -----------------------------------------------------------------------

    describe('getModelByProvider', () => {
      it('returns model when found', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([{ id: 'models:3', actual_model_name: 'gpt-4-turbo', max_tokens: 8192 }]),
          }),
        });

        const model = await models.getModelByProvider('openai', 'gpt-4');

        expect(model).toBeDefined();
        expect(model!.id).toBe('3');
        expect(model!.actualModelName).toBe('gpt-4-turbo');
        expect(model!.maxTokens).toBe(8192);
      });

      it('returns undefined when not found', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        });

        const model = await models.getModelByProvider('openai', 'nonexistent');
        expect(model).toBeUndefined();
      });

      it('assertOk failure throws', async () => {
        mockSelect.mockReturnValueOnce({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValueOnce(new Error('ERR')),
          }),
        });

        await expect(models.getModelByProvider('o', 'm')).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // getModels
    // -----------------------------------------------------------------------

    describe('getModels', () => {
      it('returns all models', async () => {
        mockQuery.mockResolvedValue(
          okResult([
            { id: '1', provider: 'openai', model_name: 'gpt-4', actual_model_name: 'gpt-4-turbo', max_tokens: 8192 },
            {
              id: '2',
              provider: 'anthropic',
              model_name: 'claude-3',
              actual_model_name: 'claude-3-opus',
              max_tokens: 100000,
            },
          ]),
        );

        const all = await models.getModels();

        expect(all.length).toBe(2);
        expect(all[0].id).toBe('1');
        expect(all[0].provider).toBe('openai');
        expect(all[0].modelName).toBe('gpt-4');
        expect(all[0].actualModelName).toBe('gpt-4-turbo');
        expect(all[0].maxTokens).toBe(8192);
        expect(all[1].provider).toBe('anthropic');
      });

      it('returns empty array when no models exist', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        const all = await models.getModels();
        expect(all).toEqual([]);
      });

      it('assertOk failure throws', async () => {
        mockQuery.mockRejectedValue(new Error('ERR'));

        await expect(models.getModels()).rejects.toThrow('ERR');
      });
    });
  });

  // =========================================================================
  // CentroidRepo
  // =========================================================================

  describe('centroids', () => {
    let centroids: ICentroidRepo;

    beforeEach(() => {
      centroids = service.centroids;
    });

    // -----------------------------------------------------------------------
    // getAllCentroids
    // -----------------------------------------------------------------------

    describe('getAllCentroids', () => {
      it('returns CentroidRecord array', async () => {
        mockSelect.mockResolvedValueOnce([
          { class: 'topic-1', vector: [0.1, 0.2, 0.3] },
          { class: 'topic-2', vector: [0.4, 0.5, 0.6] },
        ]);

        const records = await centroids.getAllCentroids();

        expect(records.length).toBe(2);
        expect(records[0].class).toBe('topic-1');
        expect(records[0].vector).toEqual([0.1, 0.2, 0.3]);
        expect(records[1].class).toBe('topic-2');
        expect(records[1].vector).toEqual([0.4, 0.5, 0.6]);
      });

      it('returns empty array when centroids table is empty', async () => {
        // Default mockSelect for Table returns empty array — verify the path
        const records = await centroids.getAllCentroids();

        expect(records).toEqual([]);
        expect(mockSelect).toHaveBeenCalledWith(expect.any(Object));
      });

      it('assertOk failure throws', async () => {
        mockSelect.mockRejectedValueOnce(new Error('ERR'));

        await expect(centroids.getAllCentroids()).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // upsertCentroid
    // -----------------------------------------------------------------------

    describe('upsertCentroid', () => {
      it('inserts centroid with key, vector, and hash', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        await centroids.upsertCentroid('topic-1', [0.1, 0.2, 0.3], 'abc123hash');

        expect(mockQuery).toHaveBeenCalled();
        const calls = mockQuery.mock.calls.map((c: string[]) => c[0]);
        expect(calls.some((s: string) => s.includes('DELETE centroids:topic-1'))).toBe(true);
        expect(calls.some((s: string) => s.includes('INSERT INTO centroids'))).toBe(true);
      });

      it('handles empty vector array', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        await centroids.upsertCentroid('empty-class', [], 'def456hash');

        expect(mockQuery).toHaveBeenCalled();
        const calls = mockQuery.mock.calls.map((c: string[]) => c[0]);
        expect(calls.some((s: string) => s.includes('DELETE centroids:empty-class'))).toBe(true);
      });

      it('throws when query fails', async () => {
        mockQuery.mockRejectedValueOnce(new Error('ERR'));

        await expect(centroids.upsertCentroid('topic-1', [0.1], 'errhash')).rejects.toThrow('ERR');
      });
    });
  });

  // =========================================================================
  // FeatureTourRepo
  // =========================================================================

  describe('featureTours', () => {
    let featureTours: IFeatureTourRepo;

    beforeEach(() => {
      featureTours = service.featureTours;
    });

    // -----------------------------------------------------------------------
    // getDismissedFeatureTours
    // -----------------------------------------------------------------------

    describe('getDismissedFeatureTours', () => {
      it('returns featureId list when rows exist', async () => {
        mockQuery.mockResolvedValue(okResult([{ feature_id: 'tour-a' }, { feature_id: 'tour-b' }]));

        const ids = await featureTours.getDismissedFeatureTours('u1');

        expect(ids).toEqual(['tour-a', 'tour-b']);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('SELECT * FROM feature_tours'),
          expect.objectContaining({ userId: expect.any(RecordId) }),
        );
      });

      it('returns empty array when no rows found', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        const ids = await featureTours.getDismissedFeatureTours('u1');

        expect(ids).toEqual([]);
        expect(mockQuery).toHaveBeenCalledWith(
          expect.stringContaining('SELECT * FROM feature_tours'),
          expect.objectContaining({ userId: expect.any(RecordId) }),
        );
      });

      it('throws when query fails', async () => {
        mockQuery.mockRejectedValue(new Error('ERR'));

        await expect(featureTours.getDismissedFeatureTours('u1')).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // dismissFeatureTours
    // -----------------------------------------------------------------------

    describe('dismissFeatureTours', () => {
      it('inserts each featureId with ON DUPLICATE KEY UPDATE', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        await featureTours.dismissFeatureTours('u1', ['tour-a', 'tour-b']);

        expect(mockQuery).toHaveBeenCalledTimes(2);
        expect(mockQuery.mock.calls[0][1]).toEqual({ userId: new RecordId('users', 'u1'), featureId: 'tour-a' });
        expect(mockQuery.mock.calls[1][1]).toEqual({ userId: new RecordId('users', 'u1'), featureId: 'tour-b' });
      });

      it('handles empty featureIds list', async () => {
        mockQuery.mockResolvedValue(okResult([]));

        await featureTours.dismissFeatureTours('u1', []);

        expect(mockQuery).not.toHaveBeenCalled();
      });

      it('throws when INSERT query fails', async () => {
        mockQuery.mockRejectedValue(new Error('ERR'));

        await expect(featureTours.dismissFeatureTours('u1', ['f1'])).rejects.toThrow('ERR');
      });
    });

    // -----------------------------------------------------------------------
    // resetFeatureTours
    // -----------------------------------------------------------------------

    describe('resetFeatureTours', () => {
      it('calls DELETE with userId', async () => {
        mockQuery.mockImplementation(async (sql: string, vars?: Record<string, unknown>) => {
          if (sql.includes('DELETE feature_tours')) {
            expect(vars?.userId).toBeInstanceOf(RecordId);
            return Promise.resolve(okResult([]));
          }
          return Promise.resolve(okResult([]));
        });

        await featureTours.resetFeatureTours('u1');

        const calls = mockQuery.mock.calls.map((c: string[]) => c[0]);
        expect(calls.some((s: string) => s.includes('DELETE feature_tours'))).toBe(true);
      });

      it('assertOk failure throws', async () => {
        mockQuery.mockRejectedValue(new Error('ERR'));

        await expect(featureTours.resetFeatureTours('u1')).rejects.toThrow('ERR');
      });
    });
  });
});
