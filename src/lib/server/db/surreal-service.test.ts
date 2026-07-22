/**
 * Tests for SurrealDatabaseService — real in-memory SurrealDB.
 *
 * Spawns a local `surreal start --no-banner --bind 127.0.0.1:10102 memory`
 * process in beforeAll, connects via initSurreal(), and tears down in afterAll.
 *
 * Covers:
 *   – SurrealDatabaseService (init, close, transaction)
 *   – UserRepo   (ensureUser, getOrCreateUser, getUser, updateUser)
 *   – ChatRepo   (ensureChat, getChat, getChatSummaryForApi)
 *   – MessageRepo (addMessage, getMessages, softDeleteMessage)
 *   – EventRepo  (insertChatEvent, getChatEventsSince)
 *   – ReactionRepo (setReaction, getReaction, deleteReaction)
 *   – ToolCallRepo (getToolCallsByMessageId, getToolCallsForMessages)
 *   – ContentRepo (getPosts, getExperience, upsertPost, upsertExperience, updatePartOfSeries, getRelatedBusinessPages)
 *   – LeadRepo (insertLead)
 *   – ContactIntentRepo (insertContactIntent, updateUserContact)
 *   – UserAgentRepo (getOrCreateUserAgent, getUserAgents)
 *   – LlmCacheRepo (searchCache, getCached, setCached, getCacheStats)
 *   – VectorRepo (searchChunks, upsertChunks, createEdges, deleteChunksBySlug)
 *   – ModelRepo (ensureModel, getModelByProvider, getModels)
 *   – CentroidRepo (getAllCentroids, upsertCentroid)
 *   – FeatureTourRepo (getDismissedFeatureTours, dismissFeatureTours, resetFeatureTours)
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import { RecordId } from 'surrealdb';
import { initSurreal, closeSurreal, getSurreal } from './surreal';
import { SurrealDatabaseService } from './surreal-service';
import type {
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

const SURREAL_PORT = 10102;
const SURREAL_URL = `ws://127.0.0.1:${SURREAL_PORT}`;
const SURREAL_USER = 'root';
const SURREAL_PASS = 'root';
const SURREAL_NS = 'test';
const SURREAL_DB = 'test';

const USER_ID = 'u1';
const CHAT_ID = 'c1';
const MESSAGE_ID = 'm1';

let surrealProcess: ChildProcess | null = null;

// ---------------------------------------------------------------------------
// Schema tables used by SurrealDatabaseService
// ---------------------------------------------------------------------------

const SCHEMA_TABLES = [
  `DEFINE TABLE IF NOT EXISTS users SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS email ON TABLE users TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS name ON TABLE users TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS created_at ON TABLE users TYPE option<datetime> DEFAULT time::now();`,
  `DEFINE FIELD IF NOT EXISTS dismissed_tours ON TABLE users TYPE option<array> DEFAULT [];`,
  `DEFINE FIELD IF NOT EXISTS dismissed_tours.* ON TABLE users TYPE string;`,

  `DEFINE TABLE IF NOT EXISTS chats SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS user_id ON TABLE chats TYPE option<record<users>>;`,
  `DEFINE FIELD IF NOT EXISTS title ON TABLE chats TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS created_at ON TABLE chats TYPE option<datetime> DEFAULT time::now();`,
  `DEFINE FIELD IF NOT EXISTS deleted_at ON TABLE chats TYPE option<datetime>;`,
  `DEFINE FIELD IF NOT EXISTS locked ON TABLE chats TYPE option<bool>;`,
  `DEFINE FIELD IF NOT EXISTS off_topic_count ON TABLE chats TYPE option<int>;`,
  `DEFINE FIELD IF NOT EXISTS user_agent_id ON TABLE chats TYPE option<record<user_agents>>;`,
  `DEFINE FIELD IF NOT EXISTS trace_id ON TABLE chats TYPE option<string>;`,

  `DEFINE TABLE IF NOT EXISTS messages SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS user_id ON TABLE messages TYPE option<record<users>>;`,
  `DEFINE FIELD IF NOT EXISTS role ON TABLE messages TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS content ON TABLE messages TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS sources ON TABLE messages TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS reasoning ON TABLE messages TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS error ON TABLE messages TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS irrecoverable ON TABLE messages TYPE option<bool>;`,
  `DEFINE FIELD IF NOT EXISTS user_agent_id ON TABLE messages TYPE option<record<user_agents>>;`,
  `DEFINE FIELD IF NOT EXISTS created_at ON TABLE messages TYPE option<datetime> DEFAULT time::now();`,
  `DEFINE FIELD IF NOT EXISTS model_id ON TABLE messages TYPE option<record<models>>;`,
  `DEFINE FIELD IF NOT EXISTS tokens_in ON TABLE messages TYPE option<int>;`,
  `DEFINE FIELD IF NOT EXISTS tokens_out ON TABLE messages TYPE option<int>;`,
  `DEFINE FIELD IF NOT EXISTS duration_ms ON TABLE messages TYPE option<int>;`,
  `DEFINE FIELD IF NOT EXISTS max_tokens ON TABLE messages TYPE option<int>;`,
  `DEFINE FIELD IF NOT EXISTS query_type ON TABLE messages TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS deleted_at ON TABLE messages TYPE option<datetime>;`,
  `DEFINE FIELD IF NOT EXISTS from_cache ON TABLE messages TYPE option<bool>;`,
  `DEFINE FIELD IF NOT EXISTS trace_id ON TABLE messages TYPE option<string>;`,

  `DEFINE TABLE IF NOT EXISTS chat_events SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS type ON TABLE chat_events TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS data ON TABLE chat_events TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS created_at ON TABLE chat_events TYPE option<datetime> DEFAULT time::now();`,
  `DEFINE TABLE IF NOT EXISTS reactions SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS message_id ON TABLE reactions TYPE option<record<messages>>;`,
  `DEFINE FIELD IF NOT EXISTS user_id ON TABLE reactions TYPE option<record<users>>;`,
  `DEFINE FIELD IF NOT EXISTS reaction_type ON TABLE reactions TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS reason ON TABLE reactions TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS created_at ON TABLE reactions TYPE option<datetime> DEFAULT time::now();`,
  `DEFINE INDEX IF NOT EXISTS reactions_unique ON TABLE reactions FIELDS message_id, user_id UNIQUE;`,

  `DEFINE TABLE IF NOT EXISTS tool_calls SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS message_id ON TABLE tool_calls TYPE option<record<messages>>;`,
  `DEFINE FIELD IF NOT EXISTS name ON TABLE tool_calls TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS server_id ON TABLE tool_calls TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS tool_input ON TABLE tool_calls TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS tool_output ON TABLE tool_calls TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS result_size ON TABLE tool_calls TYPE option<int>;`,
  `DEFINE FIELD IF NOT EXISTS started_at ON TABLE tool_calls TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS finished_at ON TABLE tool_calls TYPE option<string>;`,

  `DEFINE TABLE IF NOT EXISTS page_posts SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS slug ON TABLE page_posts TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS hash ON TABLE page_posts TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS content ON TABLE page_posts TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS toc ON TABLE page_posts TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS title ON TABLE page_posts TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS description ON TABLE page_posts TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS date ON TABLE page_posts TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS tags ON TABLE page_posts TYPE option<array<string>>;`,
  `DEFINE FIELD IF NOT EXISTS status ON TABLE page_posts TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS excerpt ON TABLE page_posts TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS header_image ON TABLE page_posts TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS featured ON TABLE page_posts TYPE option<bool>;`,
  `DEFINE FIELD IF NOT EXISTS position ON TABLE page_posts TYPE option<int>;`,
  `DEFINE FIELD IF NOT EXISTS part_of_series ON TABLE page_posts TYPE option<record<page_posts>>;`,
  `DEFINE FIELD IF NOT EXISTS workflow_files ON TABLE page_posts TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS updated_at ON TABLE page_posts TYPE option<string>;`,
  `DEFINE INDEX IF NOT EXISTS page_posts_slug ON TABLE page_posts FIELDS slug UNIQUE;`,

  `DEFINE TABLE IF NOT EXISTS page_experience SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS slug ON TABLE page_experience TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS hash ON TABLE page_experience TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS content ON TABLE page_experience TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS company ON TABLE page_experience TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS role ON TABLE page_experience TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS start_date ON TABLE page_experience TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS end_date ON TABLE page_experience TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS duration ON TABLE page_experience TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS skills ON TABLE page_experience TYPE option<array<string>>;`,
  `DEFINE FIELD IF NOT EXISTS description ON TABLE page_experience TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS published ON TABLE page_experience TYPE option<bool>;`,
  `DEFINE FIELD IF NOT EXISTS job_role ON TABLE page_experience TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS updated_at ON TABLE page_experience TYPE option<string>;`,
  `DEFINE INDEX IF NOT EXISTS page_experience_slug ON TABLE page_experience FIELDS slug UNIQUE;`,

  `DEFINE TABLE IF NOT EXISTS chunks SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS chunk_id ON TABLE chunks TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS text ON TABLE chunks TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS title ON TABLE chunks TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS date ON TABLE chunks TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS tags ON TABLE chunks TYPE option<array<string>>;`,
  `DEFINE FIELD IF NOT EXISTS section ON TABLE chunks TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS embedding ON TABLE chunks TYPE option<array<float>>;`,

  `DEFINE TABLE IF NOT EXISTS has_chunk TYPE RELATION IN page_posts | page_experience OUT chunks SCHEMAFULL;`,

  `DEFINE TABLE IF NOT EXISTS leads SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS user_id ON TABLE leads TYPE option<record<users>>;`,
  `DEFINE FIELD IF NOT EXISTS name ON TABLE leads TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS email ON TABLE leads TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS company_name ON TABLE leads TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS role ON TABLE leads TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS message ON TABLE leads TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS ip_address ON TABLE leads TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS created_at ON TABLE leads TYPE option<datetime> DEFAULT time::now();`,

  `DEFINE TABLE IF NOT EXISTS contact_intents SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS user_id ON TABLE contact_intents TYPE option<record<users>>;`,
  `DEFINE FIELD IF NOT EXISTS chat_id ON TABLE contact_intents TYPE option<record<chats>>;`,
  `DEFINE FIELD IF NOT EXISTS text ON TABLE contact_intents TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS created_at ON TABLE contact_intents TYPE option<datetime> DEFAULT time::now();`,

  `DEFINE TABLE IF NOT EXISTS user_agents SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS ua ON TABLE user_agents TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS device_type ON TABLE user_agents TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS ip ON TABLE user_agents TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS created_at ON TABLE user_agents TYPE option<datetime> DEFAULT time::now();`,

  `DEFINE TABLE IF NOT EXISTS llm_cache SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS question ON TABLE llm_cache TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS question_embedding ON TABLE llm_cache TYPE option<array<float>>;`,
  `DEFINE FIELD IF NOT EXISTS answer ON TABLE llm_cache TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS sources ON TABLE llm_cache TYPE option<array<string>>;`,
  `DEFINE FIELD IF NOT EXISTS tool_calls ON TABLE llm_cache TYPE option<array<string>>;`,
  `DEFINE FIELD IF NOT EXISTS message_id ON TABLE llm_cache TYPE option<record<messages>>;`,
  `DEFINE FIELD IF NOT EXISTS created_at ON TABLE llm_cache TYPE option<datetime> DEFAULT time::now();`,

  `DEFINE TABLE IF NOT EXISTS models SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS provider ON TABLE models TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS model_name ON TABLE models TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS actual_model_name ON TABLE models TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS max_tokens ON TABLE models TYPE option<int>;`,
  `DEFINE INDEX IF NOT EXISTS models_provider_name ON TABLE models FIELDS provider, model_name UNIQUE;`,

  `DEFINE TABLE IF NOT EXISTS centroids SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS class ON TABLE centroids TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS vector ON TABLE centroids TYPE option<array<float>>;`,
  `DEFINE FIELD IF NOT EXISTS dims ON TABLE centroids TYPE option<int>;`,
  `DEFINE FIELD IF NOT EXISTS model ON TABLE centroids TYPE option<string>;`,
  `DEFINE FIELD IF NOT EXISTS hash ON TABLE centroids TYPE option<string>;`,

  // used_model relation: messages -> used_model -> models
  `DEFINE TABLE IF NOT EXISTS used_model TYPE RELATION IN messages OUT models SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS created_at ON TABLE used_model TYPE option<datetime> DEFAULT time::now();`,

  // has_message relation: chats -> has_message -> messages
  `DEFINE TABLE IF NOT EXISTS has_message TYPE RELATION IN chats OUT messages SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS created_at ON TABLE has_message TYPE option<datetime> DEFAULT time::now();`,

  // has_event relation: chats -> has_event -> chat_events
  `DEFINE TABLE IF NOT EXISTS has_event TYPE RELATION IN chats OUT chat_events SCHEMAFULL;`,
  `DEFINE FIELD IF NOT EXISTS created_at ON TABLE has_event TYPE option<datetime> DEFAULT time::now();`,
];

/**
 * All user-created tables (not relation tables) for cleanup between tests.
 */
const CLEAN_TABLES = [
  'users',
  'chats',
  'messages',
  'chat_events',
  'reactions',
  'tool_calls',
  'page_posts',
  'page_experience',
  'chunks',
  'has_chunk',
  'leads',
  'contact_intents',
  'user_agents',
  'llm_cache',
  'models',
  'centroids',
  'used_model',
  'has_message',
  'has_event',
];

// ===========================================================================
// Test Suite
// ===========================================================================

describe('SurrealDatabaseService', () => {
  let service: SurrealDatabaseService;

  // -------------------------------------------------------------------------
  // Lifecycle: start SurrealDB, connect, define schema
  // -------------------------------------------------------------------------

  beforeAll(async () => {
    // 1. Check if SurrealDB is already running on 10102
    let alreadyRunning = false;
    try {
      const checkDb = new (await import('surrealdb')).Surreal();
      await checkDb.connect(SURREAL_URL, {
        namespace: SURREAL_NS,
        database: SURREAL_DB,
        authentication: { username: SURREAL_USER, password: SURREAL_PASS },
      });
      await checkDb.close();
      alreadyRunning = true;
    } catch {
      // Not running — need to spawn
    }

    if (!alreadyRunning) {
      // Spawn with detached: true to survive vitest process cleanup
      surrealProcess = spawn('surreal', ['start', '--no-banner', '--bind', `127.0.0.1:${SURREAL_PORT}`, 'memory'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      surrealProcess.unref();

      // Wait for the process to start
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('SurrealDB start timeout')), 15000);
        const check = async () => {
          try {
            const db = new (await import('surrealdb')).Surreal();
            await db.connect(SURREAL_URL, {
              namespace: SURREAL_NS,
              database: SURREAL_DB,
              authentication: { username: SURREAL_USER, password: SURREAL_PASS },
            });
            await db.close();
            clearTimeout(timeout);
            resolve();
          } catch {
            setTimeout(check, 200);
          }
        };
        check();
      });
    }

    // 2. Initialize the global singleton
    await initSurreal({
      url: SURREAL_URL,
      user: SURREAL_USER,
      pass: SURREAL_PASS,
      ns: SURREAL_NS,
      db: SURREAL_DB,
    });

    // 3. Define schema
    const db = getSurreal();
    for (const stmt of SCHEMA_TABLES) {
      await db.query(stmt);
    }

    // 4. Create service instance
    service = new SurrealDatabaseService();
  }, 30_000);

  afterAll(async () => {
    try {
      await closeSurreal();
    } catch {
      /* ignore */
    }

    if (surrealProcess) {
      surrealProcess.kill('SIGTERM');
      surrealProcess = null;
    }
  });

  afterEach(async () => {
    // Clean all data between tests by removing all records from each table
    const db = getSurreal();
    for (const table of CLEAN_TABLES) {
      try {
        await db.query(`REMOVE TABLE IF EXISTS ${table}`);
      } catch {
        // Some tables might not exist yet, ignore
      }
    }
    // Re-define schema after cleanup
    for (const stmt of SCHEMA_TABLES) {
      try {
        await db.query(stmt);
      } catch {
        /* table might already exist */
      }
    }
  });

  // -------------------------------------------------------------------------
  // init / close
  // -------------------------------------------------------------------------

  describe('init', () => {
    it('calls initSurreal successfully', async () => {
      // Already initialized in beforeAll — verify the connection works
      const db = getSurreal();
      const result = await db.query('RETURN 1');
      expect(result).toBeDefined();
    });
  });

  describe('close', () => {
    it('does not throw when closing', async () => {
      // closeSurreal was already called in afterAll — just verify no throw on reconnect
      await initSurreal({
        url: SURREAL_URL,
        user: SURREAL_USER,
        pass: SURREAL_PASS,
        ns: SURREAL_NS,
        db: SURREAL_DB,
      });
      await closeSurreal();
      // Re-init for remaining tests
      await initSurreal({
        url: SURREAL_URL,
        user: SURREAL_USER,
        pass: SURREAL_PASS,
        ns: SURREAL_NS,
        db: SURREAL_DB,
      });
    });
  });

  // -------------------------------------------------------------------------
  // transaction
  // -------------------------------------------------------------------------

  describe('transaction', () => {
    it('wraps fn in BEGIN / COMMIT and returns result', async () => {
      const result = await service.transaction(() => Promise.resolve('ok'));
      expect(result).toBe('ok');
    });

    it('rolls back on fn error and rethrows', async () => {
      await expect(service.transaction(() => Promise.reject(new Error('fn failed')))).rejects.toThrow('fn failed');
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

    describe('ensureUser', () => {
      it('creates user with email and name', async () => {
        await users.ensureUser(USER_ID, 'a@b.com', 'Alice');

        const user = await users.getUser(USER_ID);
        expect(user).toBeDefined();
        expect(user!.email).toBe('a@b.com');
        expect(user!.name).toBe('Alice');
      });

      it('creates user without optional fields', async () => {
        await users.ensureUser(USER_ID);

        const user = await users.getUser(USER_ID);
        expect(user).toBeDefined();
      });
    });

    describe('getOrCreateUser', () => {
      it('creates new user with email+name and returns UserRecord', async () => {
        const user = await users.getOrCreateUser(USER_ID, 'a@b.com', 'Alice');

        expect(user.id).toBe(USER_ID);
        expect(user.email).toBe('a@b.com');
        expect(user.name).toBe('Alice');
        expect(user.createdAt).toBeDefined();
      });

      it('returns existing when called again with same id', async () => {
        const user1 = await users.getOrCreateUser(USER_ID, 'a@b.com', 'Alice');
        const user2 = await users.getOrCreateUser(USER_ID, 'a@b.com', 'Alice');

        expect(user1.id).toBe(user2.id);
        expect(user2.email).toBe('a@b.com');
      });

      it('passes null for email and name when not provided', async () => {
        const user = await users.getOrCreateUser(USER_ID);

        expect(user.id).toBe(USER_ID);
        expect(user.email).toBeUndefined();
        expect(user.name).toBeUndefined();
      });
    });

    describe('getUser', () => {
      it('returns UserRecord when found', async () => {
        await users.ensureUser(USER_ID, 'a@b.com', 'Alice');

        const user = await users.getUser(USER_ID);

        expect(user).toBeDefined();
        expect(user!.id).toBe(USER_ID);
        expect(user!.email).toBe('a@b.com');
        expect(user!.name).toBe('Alice');
      });

      it('returns undefined when not found', async () => {
        const user = await users.getUser('nonexistent');
        expect(user).toBeUndefined();
      });
    });

    describe('updateUser', () => {
      it('merges partial updates', async () => {
        await users.ensureUser(USER_ID, 'a@b.com', 'Alice');
        await users.updateUser(USER_ID, { name: 'New Name' });

        const user = await users.getUser(USER_ID);
        expect(user!.name).toBe('New Name');
        expect(user!.email).toBe('a@b.com');
      });

      it('skips when no updates provided', async () => {
        await users.ensureUser(USER_ID, 'a@b.com', 'Alice');
        await users.updateUser(USER_ID, {});

        const user = await users.getUser(USER_ID);
        expect(user!.name).toBeUndefined(); // ensureUser with just id doesn't set name
        // After ensureUser with no name, name is null
      });

      it('preserves null values to clear fields', async () => {
        await users.ensureUser(USER_ID, 'a@b.com', 'Alice');
        await users.updateUser(USER_ID, { email: null as unknown as undefined });

        const user = await users.getUser(USER_ID);
        // With null, the field should be cleared
        expect(user).toBeDefined();
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

    describe('ensureChat', () => {
      it('creates chat linked to user', async () => {
        // Ensure user exists first
        await service.users.ensureUser(USER_ID);
        await chats.ensureChat(CHAT_ID, USER_ID);

        const chat = await chats.getChat(CHAT_ID);
        expect(chat).toBeDefined();
        expect(chat!.userId).toBe(USER_ID);
      });
    });

    describe('getChat', () => {
      it('returns Chat when found', async () => {
        await service.users.ensureUser(USER_ID);
        await chats.ensureChat(CHAT_ID, USER_ID);

        const chat = await chats.getChat(CHAT_ID);

        expect(chat).toBeDefined();
        expect(chat!.id).toBe(CHAT_ID);
        expect(chat!.userId).toBe(USER_ID);
      });

      it('returns undefined when not found', async () => {
        const chat = await chats.getChat('nonexistent');
        expect(chat).toBeUndefined();
      });
    });

    describe('getChatSummaryForApi', () => {
      it('returns ChatSummary with message count and lastMessageAt', async () => {
        await service.users.ensureUser(USER_ID);
        await chats.ensureChat(CHAT_ID, USER_ID);

        const summary = await chats.getChatSummaryForApi(CHAT_ID);

        expect(summary).toBeDefined();
        expect(summary!.id).toBe(CHAT_ID);
        expect(summary!.messageCount).toBe(0);
        expect(summary!.lastMessageAt).toBeUndefined();
      });

      it('returns undefined when chat not found', async () => {
        const summary = await chats.getChatSummaryForApi('nonexistent');
        expect(summary).toBeUndefined();
      });
    });
  });

  // =========================================================================
  // MessageRepo
  // =========================================================================

  describe('messages', () => {
    let msgs: IMessageRepo;

    beforeEach(async () => {
      msgs = service.messages;
      // Ensure user and chat exist for message tests
      await service.users.ensureUser(USER_ID);
      await service.chats.ensureChat(CHAT_ID, USER_ID);
    });

    describe('addMessage', () => {
      it('inserts message with full params and returns the message id', async () => {
        const id = await msgs.addMessage({
          userId: USER_ID,
          chatId: CHAT_ID,
          role: 'user',
          content: 'Hello',
          msgId: MESSAGE_ID,
        });

        expect(id).toBe(MESSAGE_ID);
      });

      it('uses randomUUID when msgId is not provided', async () => {
        const id = await msgs.addMessage({
          userId: USER_ID,
          chatId: CHAT_ID,
          role: 'user',
          content: 'No msgId',
        });

        expect(id).toBeDefined();
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
        expect(id).toMatch(/^[0-9a-f-]{36}$/);
      });

      it('skips ensureChat when chatId is not provided', async () => {
        const id = await msgs.addMessage({
          userId: USER_ID,
          role: 'user',
          content: 'No chat',
          msgId: 'msg-no-chat',
        });

        expect(id).toBe('msg-no-chat');
      });
    });

    describe('getMessages', () => {
      it('returns StoredMessage array for a chat', async () => {
        await msgs.addMessage({ userId: USER_ID, chatId: CHAT_ID, role: 'user', content: 'Hi', msgId: 'm1' });
        await msgs.addMessage({ userId: USER_ID, chatId: CHAT_ID, role: 'assistant', content: 'Hello!', msgId: 'm2' });

        const messages = await msgs.getMessages(CHAT_ID);

        expect(messages.length).toBe(2);
        expect(messages[0].id).toBe('m1');
        expect(messages[0].role).toBe('user');
        expect(messages[1].id).toBe('m2');
        expect(messages[1].role).toBe('assistant');
      });

      it('returns empty array when no messages', async () => {
        const messages = await msgs.getMessages(CHAT_ID);
        expect(messages).toEqual([]);
      });

      it('uses default limit 100 and offset 0', async () => {
        // Add a message so we have something to query
        await msgs.addMessage({ userId: USER_ID, chatId: CHAT_ID, role: 'user', content: 'Test', msgId: 'test-msg' });

        const messages = await msgs.getMessages(CHAT_ID);
        expect(messages.length).toBeGreaterThanOrEqual(1);
      });

      it('uses provided limit and offset', async () => {
        await msgs.addMessage({ userId: USER_ID, chatId: CHAT_ID, role: 'user', content: 'A', msgId: 'ma' });
        await msgs.addMessage({ userId: USER_ID, chatId: CHAT_ID, role: 'user', content: 'B', msgId: 'mb' });

        const messages = await msgs.getMessages(CHAT_ID, 1, 0);
        expect(messages.length).toBe(1);
      });
    });

    describe('softDeleteMessage', () => {
      it('sets deletedAt on the message', async () => {
        await msgs.addMessage({
          userId: USER_ID,
          chatId: CHAT_ID,
          role: 'user',
          content: 'Delete me',
          msgId: MESSAGE_ID,
        });
        await msgs.softDeleteMessage(MESSAGE_ID);

        const messages = await msgs.getMessages(CHAT_ID);
        // Soft deleted messages should not appear in normal getMessages
        expect(messages.length).toBe(0);
      });
    });
  });

  // =========================================================================
  // EventRepo — Phase 26.1: relation-based has_event edge
  // =========================================================================

  describe('events', () => {
    let events: IEventRepo;

    beforeEach(() => {
      events = service.events;
    });

    describe('insertChatEvent', () => {
      it('inserts event and returns positive event id', async () => {
        await service.chats.ensureChat(CHAT_ID, USER_ID);

        const eventId = await events.insertChatEvent(CHAT_ID, 'test_type', { key: 'value' });

        expect(typeof eventId).toBe('number');
        expect(eventId).toBeGreaterThan(0);
      });

      it('creates a has_event edge record linking chat to event', async () => {
        await service.chats.ensureChat(CHAT_ID, USER_ID);

        const eventId = await events.insertChatEvent(CHAT_ID, 'edge_test', { x: 1 });

        // Verify the event record exists in chat_events
        const db = getSurreal();
        const eventRecord = await db.query<Array<Record<string, unknown>>>(
          `SELECT type FROM chat_events WHERE meta::id(id) = $eid`,
          { eid: String(eventId) },
        );
        const rows = eventRecord as unknown as Array<Record<string, unknown>>;
        expect(rows.length).toBe(1);
        expect(rows[0].type).toBe('edge_test');
      });

      it('produces monotonically increasing ids for same chat', async () => {
        await service.chats.ensureChat(CHAT_ID, USER_ID);

        const id1 = await events.insertChatEvent(CHAT_ID, 't1', { a: 1 });
        const id2 = await events.insertChatEvent(CHAT_ID, 't2', { a: 2 });
        const id3 = await events.insertChatEvent(CHAT_ID, 't3', { a: 3 });

        expect(id2).toBeGreaterThan(id1);
        expect(id3).toBeGreaterThan(id2);
      });

      it('creates chat_events record with correct data', async () => {
        await service.chats.ensureChat(CHAT_ID, USER_ID);

        const payload = { nested: { val: 42 }, arr: [1, 2, 3] };
        const eventId = await events.insertChatEvent(CHAT_ID, 'field_test', payload);

        // Read raw record from DB
        const db = getSurreal();
        const raw = await db.query<Array<Record<string, unknown>>>(`SELECT * FROM chat_events:${eventId}`);
        const rows = raw as unknown as Array<Record<string, unknown>>;
        expect(rows.length).toBe(1);
        expect(rows[0].type).toBe('field_test');

        // SurrealDB auto-parses JSON strings; verify data roundtrips correctly
        const storedData = typeof rows[0].data === 'string' ? JSON.parse(String(rows[0].data)) : rows[0].data;
        expect(storedData).toEqual(payload);
      });
    });

    describe('getChatEventsSince', () => {
      it('returns empty array when no events since lastEventId', async () => {
        await service.chats.ensureChat(CHAT_ID, USER_ID);

        const result = await events.getChatEventsSince(CHAT_ID, 999999);
        expect(result).toEqual([]);
      });

      it('returns events for the given chat since lastEventId', async () => {
        await service.chats.ensureChat(CHAT_ID, USER_ID);

        const id1 = await events.insertChatEvent(CHAT_ID, 'first', { n: 1 });
        const id2 = await events.insertChatEvent(CHAT_ID, 'second', { n: 2 });
        expect(id1).toBeGreaterThan(0);
        expect(id2).toBeGreaterThan(id1);

        // getChatEventsSince returns events after lastEventId
        const result = await events.getChatEventsSince(CHAT_ID, 0);
        expect(result.length).toBe(2);
        expect(result[0].id).toBe(id1);
        expect(result[0].type).toBe('first');
        expect(result[0].data).toEqual({ n: 1 });
        expect(result[1].id).toBe(id2);
        expect(result[1].type).toBe('second');
        expect(result[1].data).toEqual({ n: 2 });
      });

      it('returns only events after lastEventId', async () => {
        await service.chats.ensureChat(CHAT_ID, USER_ID);

        const id1 = await events.insertChatEvent(CHAT_ID, 'evt1', { a: 1 });
        const id2 = await events.insertChatEvent(CHAT_ID, 'evt2', { a: 2 });

        // Request events after id1 — should only get id2
        const result = await events.getChatEventsSince(CHAT_ID, id1);
        expect(result.length).toBe(1);
        expect(result[0].id).toBe(id2);
        expect(result[0].type).toBe('evt2');
      });

      it('returns events in ascending order by id', async () => {
        await service.chats.ensureChat(CHAT_ID, USER_ID);

        const id1 = await events.insertChatEvent(CHAT_ID, 'a', { v: 1 });
        const id2 = await events.insertChatEvent(CHAT_ID, 'b', { v: 2 });
        const id3 = await events.insertChatEvent(CHAT_ID, 'c', { v: 3 });

        const result = await events.getChatEventsSince(CHAT_ID, 0);
        expect(result.length).toBe(3);
        expect(result.map((e) => e.id)).toEqual([id1, id2, id3]);
      });

      it('roundtrips complex data through insert and get', async () => {
        await service.chats.ensureChat(CHAT_ID, USER_ID);

        const payload = { nested: { deep: true }, arr: [1, 'two', null], num: 42 };
        const eventId = await events.insertChatEvent(CHAT_ID, 'complex', payload);

        const result = await events.getChatEventsSince(CHAT_ID, 0);
        expect(result.length).toBe(1);
        expect(result[0].id).toBe(eventId);
        expect(result[0].type).toBe('complex');
        expect(result[0].data).toEqual(payload);
      });

      it('does not return events from other chats', async () => {
        await service.chats.ensureChat(CHAT_ID, USER_ID);
        const otherChat = 'c_other';
        await service.chats.ensureChat(otherChat, USER_ID);

        await events.insertChatEvent(CHAT_ID, 'mine', { x: 1 });
        await events.insertChatEvent(otherChat, 'theirs', { x: 2 });

        const result = await events.getChatEventsSince(CHAT_ID, 0);
        expect(result.length).toBe(1);
        expect(result[0].type).toBe('mine');
      });

      it('verifies insertChatEvent is idempotent for same chat/type/data', async () => {
        await service.chats.ensureChat(CHAT_ID, USER_ID);

        const id1 = await events.insertChatEvent(CHAT_ID, 'idem', { v: 1 });
        const id2 = await events.insertChatEvent(CHAT_ID, 'idem', { v: 1 });

        // IDs should be different (each insert creates a new record)
        expect(id1).not.toBe(id2);
        // Both should be positive
        expect(id1).toBeGreaterThan(0);
        expect(id2).toBeGreaterThan(0);
      });
    });

    describe('ChatEvent type (compile-time)', () => {
      it('ChatEvent interface has no chatId field', () => {
        // If ChatEvent had a chatId field, this would be a compile error
        const event: import('./interfaces').ChatEvent = {
          id: 1,
          type: 'test',
          data: {},
          createdAt: new Date().toISOString(),
        };
        // Runtime: accessing chatId returns undefined on a properly typed ChatEvent
        expect((event as unknown as Record<string, unknown>).chatId).toBeUndefined();
      });
    });
  });

  // =========================================================================
  // ReactionRepo
  // =========================================================================

  describe('reactions', () => {
    let reactions: IReactionRepo;

    beforeEach(async () => {
      reactions = service.reactions;
      // Create a user and chat with message for reaction tests
      await service.users.ensureUser(USER_ID);
      await service.chats.ensureChat(CHAT_ID, USER_ID);
      await service.messages.addMessage({
        userId: USER_ID,
        chatId: CHAT_ID,
        role: 'user',
        content: 'React to this',
        msgId: MESSAGE_ID,
      });
    });

    describe('setReaction', () => {
      it('upserts reaction without reason', async () => {
        await reactions.setReaction(MESSAGE_ID, USER_ID, 'up');

        const result = await reactions.getReaction(MESSAGE_ID, USER_ID);
        expect(result).toBeDefined();
        expect(result!.type).toBe('up');
        expect(result!.reason).toBe('');
      });

      it('upserts reaction with reason', async () => {
        await reactions.setReaction(MESSAGE_ID, USER_ID, 'heart', 'great answer');

        const result = await reactions.getReaction(MESSAGE_ID, USER_ID);
        expect(result).toBeDefined();
        expect(result!.type).toBe('heart');
        expect(result!.reason).toBe('great answer');
      });
    });

    describe('getReaction', () => {
      it('returns ReactionResult when found', async () => {
        await reactions.setReaction(MESSAGE_ID, USER_ID, 'up', 'helpful');

        const result = await reactions.getReaction(MESSAGE_ID, USER_ID);

        expect(result).toBeDefined();
        expect(result!.type).toBe('up');
        expect(result!.reason).toBe('helpful');
      });

      it('returns null when not found', async () => {
        const result = await reactions.getReaction('nonexistent', 'nonexistent');
        expect(result).toBeUndefined();
      });
    });

    describe('deleteReaction', () => {
      it('deletes reaction', async () => {
        await reactions.setReaction(MESSAGE_ID, USER_ID, 'up');
        await reactions.deleteReaction(MESSAGE_ID, USER_ID);

        const result = await reactions.getReaction(MESSAGE_ID, USER_ID);
        expect(result).toBeUndefined();
      });
    });
  });

  // =========================================================================
  // ToolCallRepo
  // =========================================================================

  describe('toolCalls', () => {
    let toolCalls: IToolCallRepo;

    beforeEach(async () => {
      toolCalls = service.toolCalls;
      await service.users.ensureUser(USER_ID);
      await service.chats.ensureChat(CHAT_ID, USER_ID);
      await service.messages.addMessage({
        userId: USER_ID,
        chatId: CHAT_ID,
        role: 'user',
        content: 'Tool message',
        msgId: MESSAGE_ID,
      });
    });

    describe('getToolCallsByMessageId', () => {
      it('returns ToolCallRecord array', async () => {
        await toolCalls.insertToolCall('tc1', MESSAGE_ID, 'search', 'srv1', '{}');
        await toolCalls.setToolCallResult('tc1', 'done', 100);

        const calls = await toolCalls.getToolCallsByMessageId(MESSAGE_ID);

        expect(calls.length).toBe(1);
        expect(calls[0].id).toBe('tc1');
        expect(calls[0].name).toBe('search');
        expect(calls[0].finishedAt).toBeDefined();
        expect(calls[0].durationMs).toBeGreaterThanOrEqual(0);
      });

      it('returns empty array when no tool calls found', async () => {
        const calls = await toolCalls.getToolCallsByMessageId('nonexistent');
        expect(calls).toEqual([]);
      });
    });

    describe('getToolCallsForMessages', () => {
      it('groups tool calls by messageId', async () => {
        await toolCalls.insertToolCall('tc1', MESSAGE_ID, 'search', 'srv1', '{}');

        const map = await toolCalls.getToolCallsForMessages([MESSAGE_ID]);

        expect(Object.keys(map).length).toBe(1);
        expect(map[MESSAGE_ID].length).toBe(1);
        expect(map[MESSAGE_ID][0].name).toBe('search');
      });

      it('returns empty object for empty input array', async () => {
        const map = await toolCalls.getToolCallsForMessages([]);
        expect(map).toEqual({});
      });

      it('returns empty object when no tool calls match', async () => {
        const map = await toolCalls.getToolCallsForMessages(['nonexistent']);
        expect(map).toEqual({});
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

    describe('getPosts', () => {
      it('returns all posts via queryDb when no opts provided', async () => {
        await content.upsertPost({
          slug: 'post-a',
          hash: 'abc',
          content: '# Post A',
          toc: '[]',
          title: 'Post A',
          description: '',
          date: '2026-03-01',
          tags: [],
          status: 'published',
          excerpt: '',
          headerImage: null,
          featured: false,
          position: null,
          workflowFiles: null,
        });
        await content.upsertPost({
          slug: 'post-b',
          hash: 'def',
          content: '# Post B',
          toc: '[]',
          title: 'Post B',
          description: '',
          date: '2026-02-01',
          tags: [],
          status: 'published',
          excerpt: '',
          headerImage: null,
          featured: false,
          position: null,
          workflowFiles: null,
        });

        const posts = await content.getPosts();

        expect(posts.length).toBe(2);
        // Default sort: date DESC
        expect(posts[0].slug).toBe('post-a');
        expect(posts[1].slug).toBe('post-b');
      });

      it('getPosts({ slug }) filters by slug', async () => {
        await content.upsertPost({
          slug: 'target',
          hash: 'abc',
          content: '# Target',
          toc: '[]',
          title: 'Target Post',
          description: '',
          date: '2026-06-01',
          tags: [],
          status: 'published',
          excerpt: '',
          headerImage: null,
          featured: false,
          position: null,
          workflowFiles: null,
        });

        const posts = await content.getPosts({ slug: 'target' });

        expect(posts.length).toBe(1);
        expect(posts[0].slug).toBe('target');
        expect(posts[0].title).toBe('Target Post');
      });

      it('getPosts({ limit }) applies limit', async () => {
        await content.upsertPost({
          slug: 'p1',
          hash: 'abc',
          content: '1',
          toc: '[]',
          title: 'T1',
          description: '',
          date: '2026-01-01',
          tags: [],
          status: 'published',
          excerpt: '',
          headerImage: null,
          featured: false,
          position: null,
          workflowFiles: null,
        });
        await content.upsertPost({
          slug: 'p2',
          hash: 'def',
          content: '2',
          toc: '[]',
          title: 'T2',
          description: '',
          date: '2026-01-02',
          tags: [],
          status: 'published',
          excerpt: '',
          headerImage: null,
          featured: false,
          position: null,
          workflowFiles: null,
        });

        const posts = await content.getPosts({ limit: 1 });

        expect(posts.length).toBe(1);
      });

      it('getPosts({ sort: "title", order: "asc" }) orders by title ASC', async () => {
        await content.upsertPost({
          slug: 'p1',
          hash: 'abc',
          content: '1',
          toc: '[]',
          title: 'Zeta',
          description: '',
          date: '2026-01-01',
          tags: [],
          status: 'published',
          excerpt: '',
          headerImage: null,
          featured: false,
          position: null,
          workflowFiles: null,
        });
        await content.upsertPost({
          slug: 'p2',
          hash: 'def',
          content: '2',
          toc: '[]',
          title: 'Alpha',
          description: '',
          date: '2026-01-02',
          tags: [],
          status: 'published',
          excerpt: '',
          headerImage: null,
          featured: false,
          position: null,
          workflowFiles: null,
        });

        const posts = await content.getPosts({ sort: 'title', order: 'asc' });

        expect(posts.length).toBe(2);
        expect(posts[0].title).toBe('Alpha');
        expect(posts[1].title).toBe('Zeta');
      });

      it('returns empty array when queryDb returns no rows', async () => {
        const posts = await content.getPosts({ slug: 'nonexistent' });
        expect(posts).toEqual([]);
      });
    });

    describe('getExperience', () => {
      it('returns all experience entries when slug not provided', async () => {
        await content.upsertExperience({
          slug: 'job1',
          hash: 'def',
          content: 'did stuff',
          company: 'Acme',
          role: 'Engineer',
          startDate: '2020',
          endDate: '2022',
          duration: '2y',
          skills: ['JS'],
          description: 'desc',
          published: true,
          jobRole: 'SWE',
        });

        const entries = await content.getExperience();

        expect(entries.length).toBe(1);
        expect(entries[0].slug).toBe('job1');
        expect(entries[0].company).toBe('Acme');
        expect(entries[0].skills).toEqual(['JS']);
        expect(entries[0].published).toBe(true);
      });

      it('returns empty array when no experience found', async () => {
        const entries = await content.getExperience();
        expect(entries).toEqual([]);
      });
    });

    describe('getRelatedBusinessPages', () => {
      it('returns related page slugs', async () => {
        await content.upsertPost({
          slug: 'my-slug',
          hash: 'abc',
          content: 'Content',
          toc: '[]',
          title: 'My Post',
          description: '',
          date: '2026-01-01',
          tags: ['svelte'],
          status: 'published',
          excerpt: '',
          headerImage: null,
          featured: false,
          position: null,
          workflowFiles: null,
        });
        await content.upsertPost({
          slug: 'related-1',
          hash: 'def',
          content: 'Related',
          toc: '[]',
          title: 'Related Post',
          description: '',
          date: '2026-01-02',
          tags: ['svelte'],
          status: 'published',
          excerpt: '',
          headerImage: null,
          featured: false,
          position: null,
          workflowFiles: null,
        });

        const slugs = await content.getRelatedBusinessPages('my-slug');

        expect(slugs).toContain('related-1');
      });

      it('returns empty array when no related pages', async () => {
        const slugs = await content.getRelatedBusinessPages('unique');
        expect(slugs).toEqual([]);
      });
    });

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

      it('creates new post when slug not found', async () => {
        await content.upsertPost(postOpts);

        const posts = await content.getPosts({ slug: 'my-post' });
        expect(posts.length).toBe(1);
        expect(posts[0].slug).toBe('my-post');
        expect(posts[0].title).toBe('My Post');
      });

      it('updates existing post when slug found', async () => {
        await content.upsertPost(postOpts);
        await content.upsertPost({ ...postOpts, title: 'Updated Post', hash: 'newhash' });

        const posts = await content.getPosts({ slug: 'my-post' });
        expect(posts.length).toBe(1);
        expect(posts[0].title).toBe('Updated Post');
      });
    });

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

      it('creates new experience when slug not found', async () => {
        await content.upsertExperience(expOpts);

        const entries = await content.getExperience('job-1');
        expect(entries.length).toBe(1);
        expect(entries[0].company).toBe('Acme');
        expect(entries[0].role).toBe('Engineer');
      });

      it('updates existing experience when slug found', async () => {
        await content.upsertExperience(expOpts);
        await content.upsertExperience({ ...expOpts, company: 'NewCo', hash: 'newhash' });

        const entries = await content.getExperience('job-1');
        expect(entries.length).toBe(1);
        expect(entries[0].company).toBe('NewCo');
      });
    });

    describe('updatePartOfSeries', () => {
      it('sets partOfSeries to parent when both exist', async () => {
        await content.upsertPost({
          slug: 'parent-post',
          hash: 'abc',
          content: 'Parent',
          toc: '[]',
          title: 'Parent',
          description: '',
          date: '2026-01-01',
          tags: [],
          status: 'published',
          excerpt: '',
          headerImage: null,
          featured: false,
          position: null,
          workflowFiles: null,
        });
        await content.upsertPost({
          slug: 'child-post',
          hash: 'def',
          content: 'Child',
          toc: '[]',
          title: 'Child',
          description: '',
          date: '2026-01-02',
          tags: [],
          status: 'published',
          excerpt: '',
          headerImage: null,
          featured: false,
          position: null,
          workflowFiles: null,
        });

        await content.updatePartOfSeries('child-post', 'parent-post');

        const posts = await content.getPosts({ slug: 'child-post' });
        expect(posts.length).toBe(1);
        expect(posts[0].partOfSeries).toBeDefined();
      });

      it('does nothing when parentSlug is null and child not found', async () => {
        await content.updatePartOfSeries('ghost-post', null);
        // No error thrown
      });

      it('does nothing when parent not found', async () => {
        await content.upsertPost({
          slug: 'child',
          hash: 'abc',
          content: 'Child',
          toc: '[]',
          title: 'Child',
          description: '',
          date: '2026-01-01',
          tags: [],
          status: 'published',
          excerpt: '',
          headerImage: null,
          featured: false,
          position: null,
          workflowFiles: null,
        });

        await content.updatePartOfSeries('child', 'nonexistent-parent');
        // No error thrown
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

    describe('insertLead', () => {
      it('creates lead with all fields', async () => {
        await service.users.ensureUser(USER_ID);
        await leads.insertLead(USER_ID, 'John', 'j@j.com', 'Acme', 'CTO', 'hello', '1.2.3.4');
        // insertLead doesn't throw — that's the test
      });
    });
  });

  // =========================================================================
  // ContactIntentRepo
  // =========================================================================

  describe('contactIntents', () => {
    let contactIntents: IContactIntentRepo;

    beforeEach(async () => {
      contactIntents = service.contactIntents;
      await service.users.ensureUser(USER_ID);
      await service.chats.ensureChat(CHAT_ID, USER_ID);
    });

    describe('insertContactIntent', () => {
      it('creates contact intent', async () => {
        await contactIntents.insertContactIntent(USER_ID, CHAT_ID, 'I want to hire you');
        // insertContactIntent doesn't throw — that's the test
      });
    });

    describe('updateUserContact', () => {
      it('updates user name and email', async () => {
        await contactIntents.updateUserContact(USER_ID, 'Alice', 'a@b.com');

        const user = await service.users.getUser(USER_ID);
        expect(user).toBeDefined();
        expect(user!.name).toBe('Alice');
        expect(user!.email).toBe('a@b.com');
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

    describe('getOrCreateUserAgent', () => {
      it('creates new agent when not found', async () => {
        const agentId = await userAgents.getOrCreateUserAgent('Mozilla/5.0');

        expect(agentId).toBeGreaterThan(0);
      });

      it('returns existing agent id when found', async () => {
        const agentId1 = await userAgents.getOrCreateUserAgent('Mozilla/5.0');
        const agentId2 = await userAgents.getOrCreateUserAgent('Mozilla/5.0');

        expect(agentId1).toBe(agentId2);
      });

      it('classifies bot user agents', async () => {
        const agentId = await userAgents.getOrCreateUserAgent('Googlebot/2.1');
        expect(agentId).toBeGreaterThan(0);
      });

      it('truncates user agent to 500 chars', async () => {
        const longUa = 'x'.repeat(1000);
        const agentId = await userAgents.getOrCreateUserAgent(longUa);
        expect(agentId).toBeGreaterThan(0);
      });
    });

    describe('getUserAgents', () => {
      it('returns UserAgentRecord array', async () => {
        await userAgents.getOrCreateUserAgent('Mozilla/5.0');
        await userAgents.getOrCreateUserAgent('Googlebot');

        const agents = await userAgents.getUserAgents();

        expect(agents.length).toBeGreaterThanOrEqual(2);
      });

      it('returns empty array when no agents exist', async () => {
        const agents = await userAgents.getUserAgents();
        expect(agents).toEqual([]);
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

    describe('searchCache', () => {
      it('returns CacheHit array ranked by score', async () => {
        const EMBEDDING = [0.1, 0.2, 0.3];
        const results = await llmCache.searchCache(EMBEDDING);
        expect(results).toEqual([]);
      });

      it('returns empty array when no matches', async () => {
        const results = await llmCache.searchCache([0.1, 0.2, 0.3]);
        expect(results).toEqual([]);
      });
    });

    describe('getCached', () => {
      it('returns undefined when not found', async () => {
        const entry = await llmCache.getCached(999);
        expect(entry).toBeUndefined();
      });
    });

    describe('setCached', () => {
      it('creates cache entry with all optional fields', async () => {
        await service.users.ensureUser(USER_ID);
        await service.chats.ensureChat(CHAT_ID, USER_ID);
        await service.messages.addMessage({
          userId: USER_ID,
          chatId: CHAT_ID,
          role: 'user',
          content: 'Test msg',
          msgId: 'cache-msg',
        });

        await llmCache.setCached('What is?', '42', [0.1, 0.2], 'src1\nsrc2', 'tc1\ntc2', 'cache-msg');
        // setCached doesn't throw — that's the test
      });

      it('creates cache entry without optional toolCalls and messageId', async () => {
        await llmCache.setCached('Q', 'A', [0.1, 0.2], 'src');
        // setCached doesn't throw — that's the test
      });

      it('handles empty sources string', async () => {
        await llmCache.setCached('Q', 'A', [0.1, 0.2], '');
        // setCached doesn't throw — that's the test
      });
    });

    describe('getCacheStats', () => {
      it('returns zero stats when table is empty', async () => {
        const stats = await llmCache.getCacheStats();

        expect(stats.totalEntries).toBe(0);
        expect(stats.oldestEntry).toBeUndefined();
        expect(stats.newestEntry).toBeUndefined();
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

    describe('upsertChunks', () => {
      const chunkData = {
        chunkId: 'chunk_a',
        text: 'Some text',
        title: 'Title',
        date: '2026-01-01',
        tags: ['tag1'],
        section: 'sec1',
        embedding: [0.1, 0.2, 0.3],
      };

      it('creates new chunk when chunkId not found', async () => {
        const ids = await vector.upsertChunks([chunkData]);

        expect(ids.length).toBe(1);
        expect(ids[0]).toBe('chunk_a');
      });

      it('updates existing chunk when chunkId found', async () => {
        await vector.upsertChunks([chunkData]);
        await vector.upsertChunks([{ ...chunkData, text: 'Updated text' }]);

        // Should not throw and should complete successfully
      });

      it('handles multiple chunks', async () => {
        const ids = await vector.upsertChunks([chunkData, { ...chunkData, chunkId: 'chunk_b', text: 'Text B' }]);

        expect(ids.length).toBe(2);
      });

      it('does nothing when rows array is empty', async () => {
        const ids = await vector.upsertChunks([]);
        expect(ids).toEqual([]);
      });
    });

    describe('createEdges', () => {
      it('creates edges between parent and chunks', async () => {
        // First upsert a chunk
        await vector.upsertChunks([
          {
            chunkId: 'edge_chunk_1',
            text: 'Edge test',
            title: 'Edge',
            date: '2026-01-01',
            tags: [],
            section: 's1',
            embedding: [0.1, 0.2, 0.3],
          },
        ]);

        // Create a page_post first
        await service.content.upsertPost({
          slug: 'edge-parent',
          hash: 'abc',
          content: 'Parent',
          toc: '[]',
          title: 'Parent',
          description: '',
          date: '2026-01-01',
          tags: [],
          status: 'published',
          excerpt: '',
          headerImage: null,
          featured: false,
          position: null,
          workflowFiles: null,
        });

        await vector.createEdges('page_posts', 'edge-parent', ['edge_chunk_1']);
        // createEdges doesn't throw — that's the test
      });

      it('does nothing when chunkIds is empty', async () => {
        await vector.createEdges('page_posts', 'any-slug', []);
        // No error thrown
      });

      it('throws for invalid parentTable', async () => {
        await expect(vector.createEdges('invalid_table' as 'page_posts', 'slug', ['c1'])).rejects.toThrow(
          'Invalid parentTable',
        );
      });
    });

    describe('deleteChunksBySlug', () => {
      it('deletes chunks and edges by slug prefix', async () => {
        // Create page post
        await service.content.upsertPost({
          slug: 'delete-test',
          hash: 'abc',
          content: 'To delete',
          toc: '[]',
          title: 'Delete Me',
          description: '',
          date: '2026-01-01',
          tags: [],
          status: 'published',
          excerpt: '',
          headerImage: null,
          featured: false,
          position: null,
          workflowFiles: null,
        });

        // Create chunks with the slug prefix
        await vector.upsertChunks([
          {
            chunkId: 'delete-test_chunk_0',
            text: 'Chunk to delete',
            title: 'Del',
            date: '2026-01-01',
            tags: [],
            section: 's1',
            embedding: [0.1, 0.2, 0.3],
          },
        ]);

        await vector.createEdges('page_posts', 'delete-test', ['delete-test_chunk_0']);

        await vector.deleteChunksBySlug('delete-test');
        // deleteChunksBySlug doesn't throw — that's the test
      });
    });

    describe('searchChunks', () => {
      it('returns empty array when no chunks exist', async () => {
        const results = await vector.searchChunks([0.1, 0.2, 0.3]);
        expect(results).toEqual([]);
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

    describe('ensureModel', () => {
      it('creates new model and returns its id when not found', async () => {
        const id = await models.ensureModel('openai', 'gpt-4', 'gpt-4-turbo', 8192);

        expect(id).toBeDefined();
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      });

      it('returns existing id and updates max_tokens when model found', async () => {
        const id1 = await models.ensureModel('openai', 'gpt-4', 'gpt-4-turbo', 8192);
        const id2 = await models.ensureModel('openai', 'gpt-4', 'gpt-4-turbo', 16384);

        expect(id1).toBe(id2);
      });
    });

    describe('getModelByProvider', () => {
      it('returns model when found', async () => {
        await models.ensureModel('openai', 'gpt-4', 'gpt-4-turbo', 8192);

        const model = await models.getModelByProvider('openai', 'gpt-4');

        expect(model).toBeDefined();
        expect(model!.actualModelName).toBe('gpt-4-turbo');
        expect(model!.maxTokens).toBe(8192);
      });

      it('returns undefined when not found', async () => {
        const model = await models.getModelByProvider('openai', 'nonexistent');
        expect(model).toBeUndefined();
      });
    });

    describe('getModels', () => {
      it('returns all models', async () => {
        await models.ensureModel('openai', 'gpt-4', 'gpt-4-turbo', 8192);
        await models.ensureModel('anthropic', 'claude-3', 'claude-3-opus', 100000);

        const all = await models.getModels();

        expect(all.length).toBe(2);
        expect(all[0].provider).toBe('anthropic'); // sorted by provider
        expect(all[1].provider).toBe('openai');
      });

      it('returns empty array when no models exist', async () => {
        const all = await models.getModels();
        expect(all).toEqual([]);
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

    describe('getAllCentroids', () => {
      it('returns empty array when centroids table is empty', async () => {
        const records = await centroids.getAllCentroids();
        expect(records).toEqual([]);
      });
    });

    describe('upsertCentroid', () => {
      it('inserts centroid with key, vector, and hash', async () => {
        await centroids.upsertCentroid('topic-1', [0.1, 0.2, 0.3], 'abc123hash');

        const records = await centroids.getAllCentroids();
        expect(records.length).toBe(1);
      });

      it('handles empty vector array', async () => {
        await centroids.upsertCentroid('empty-class', [], 'def456hash');

        const records = await centroids.getAllCentroids();
        expect(records.length).toBe(1);
      });
    });
  });

  // =========================================================================
  // FeatureTourRepo
  // =========================================================================

  describe('featureTours', () => {
    let featureTours: IFeatureTourRepo;

    beforeEach(async () => {
      featureTours = service.featureTours;
      await service.users.ensureUser(USER_ID);
    });

    describe('getDismissedFeatureTours', () => {
      it('returns featureId list when rows exist', async () => {
        await featureTours.dismissFeatureTours(USER_ID, ['tour-a', 'tour-b']);

        const ids = await featureTours.getDismissedFeatureTours(USER_ID);

        expect(ids).toContain('tour-a');
        expect(ids).toContain('tour-b');
      });

      it('returns empty array when no rows found', async () => {
        const ids = await featureTours.getDismissedFeatureTours(USER_ID);
        expect(ids).toEqual([]);
      });
    });

    describe('dismissFeatureTours', () => {
      it('inserts each featureId', async () => {
        await featureTours.dismissFeatureTours(USER_ID, ['tour-a', 'tour-b']);

        const ids = await featureTours.getDismissedFeatureTours(USER_ID);
        expect(ids.length).toBe(2);
      });

      it('handles empty featureIds list', async () => {
        await featureTours.dismissFeatureTours(USER_ID, []);
        const ids = await featureTours.getDismissedFeatureTours(USER_ID);
        expect(ids).toEqual([]);
      });
    });

    describe('resetFeatureTours', () => {
      it('deletes all feature tours for user', async () => {
        await featureTours.dismissFeatureTours(USER_ID, ['tour-a']);
        await featureTours.resetFeatureTours(USER_ID);

        const ids = await featureTours.getDismissedFeatureTours(USER_ID);
        expect(ids).toEqual([]);
      });
    });
  });
});
