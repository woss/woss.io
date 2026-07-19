/**
 * SurrealDatabaseService — core service layer for SurrealDB.
 *
 * Implements every repository interface defined in interfaces.ts using
 * the surrealdb v2 SDK.  Uses query builder for simple SELECT by RecordId and WHERE
 *
 * All 15 repos are implemented.  FeatureTourRepo is a stub
 * (throws NOT_YET_IMPLEMENTED) pending migration.
 *
 * Uses queryDb helper for all queries (v2 throws on error — no status wrapper).
 * Record link fields use meta::id() to extract plain IDs.
 */

import { type Surreal, RecordId, Table, eq, and } from 'surrealdb';
import { getSurreal, initSurreal, closeSurreal } from './surreal';
import { randomUUID } from 'node:crypto';
import { createLogger, CAT } from '$lib/server/logger';
import { EMBEDDING_DIM, EMBEDDING_MODEL } from '$lib/search-config';
import type {
  IDatabaseService,
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
  ILlmCacheRepo,
  IVectorRepo,
  IModelRepo,
  IFeatureTourRepo,
  ICentroidRepo,
  CentroidRecord,
  StoredMessage,
  Chat,
  AddMessageParams,
  UserRecord,
  ChatSummary,
  ChatEvent,
  ReactionResult,
  ToolCallRecord,
  CacheHit,
  CacheEntry,
  CacheStats,
  UserAgentRecord,
  Post,
  ExperienceEntry,
  SearchResult,
  ChunkRecord,
} from './interfaces';
import { getCurrentTraceContext } from '../trace-context';

const log = createLogger(CAT.db);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Execute a single SurrealQL statement and return its first (only) result.
 *
 * surrealdb v2 `query()` returns `Promise<unknown[]>` and throws on error —
 * no status wrapper needed.
 */
async function queryDb<T = unknown>(db: Surreal, sql: string, vars?: Record<string, unknown>): Promise<T> {
  const result = (await db.query(sql, vars)) as unknown[];
  return result[0] as T;
}

/**
 * Create a record using the surrealdb SDK `db.create()` method.
 *
 * When `id` is provided, creates with an explicit RecordId (table:id).
 * When `id` is omitted, SurrealDB auto-generates a UUID.
 *
 * Returns the created record.
 */
async function createRecord<T = Record<string, unknown>>(
  db: Surreal,
  table: string,
  data: Record<string, unknown>,
  id?: string | number,
): Promise<T> {
  const compactData = compact(data as Record<string, unknown>);
  if (id != null) {
    const recordId = new RecordId(table, String(id));
    return (await db.create(recordId).content(compactData).output('after')) as T;
  }
  // db.create(Table) returns RecordResult<T>[] — extract the first element
  const results = (await db.create(new Table(table)).content(compactData).output('after')) as T[];
  return results[0] as T;
}

/**
 * Extract the plain key from a SurrealDB record-ID string (`table:key` → `key`).
 * When no colon is present the string is returned as-is.
 */
function stripPrefix(recordId: unknown): string {
  if (typeof recordId === 'string') {
    const idx = recordId.indexOf(':');
    return idx >= 0 ? recordId.slice(idx + 1) : recordId;
  }
  // surrealdb.js v2 SDK returns record IDs as objects { tb: 'table', id: 'key' }
  if (recordId && typeof recordId === 'object' && 'id' in recordId) {
    return String((recordId as Record<string, unknown>).id);
  }
  return String(recordId ?? '');
}

/**
 * Safely convert a SurrealDB datetime value (Date or string) to an ISO string.
 * SurrealDB SDK v2 returns Date objects for datetime fields — `as string` casts
 * only suppress the TS error without runtime conversion.
 */
function toDateString(val: unknown): string {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string') return val;
  return '';
}

/**
 * Remove entries with `undefined` or `null` values from an object so SurrealDB
 * does not receive them in query variables.  `null` is no longer preserved
 * because SurrealDB 3.x SCHEMAFULL tables reject NULL for `option<type>`
 * columns that lack `| null` in their definition.
 */
function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null)) as Partial<T>;
}

/**
 * Map a raw SurrealDB result row to a StoredMessage.
 * The row MUST already have its `id` field cleaned via `meta::id(id) AS id`.
 */
function toStoredMessage(row: Record<string, unknown>): StoredMessage {
  return {
    id: row.id as string,
    userId: stripPrefix(row.user_id),
    role: row.role as 'user' | 'assistant' | 'system',
    content: row.content as string,
    sources: Array.isArray(row.sources) ? JSON.stringify(row.sources) : ((row.sources as string) ?? ''),
    reasoning: (row.reasoning as string) ?? '',
    error: row.error as string | undefined,
    irrecoverable: row.irrecoverable as boolean | undefined,
    userAgentId: row.user_agent_id ? Number(stripPrefix(row.user_agent_id)) : undefined,
    createdAt: toDateString(row.created_at),
    modelId: row.model_id ? stripPrefix(row.model_id) : '',
    tokensIn: (row.tokens_in as number) ?? 0,
    tokensOut: (row.tokens_out as number) ?? 0,
    durationMs: (row.duration_ms as number) ?? 0,
    maxTokens: (row.max_tokens as number) ?? 0,
    queryType: row.query_type as string | undefined,
    deletedAt: row.deleted_at != null ? toDateString(row.deleted_at) : undefined,
    fromCache: row.from_cache as boolean | undefined,
  };
}

/**
 * Map a raw SurrealDB result row to a Chat.
 * The row MUST already have its `id` field cleaned via `meta::id(id) AS id`.
 */
function toChat(row: Record<string, unknown>): Chat {
  return {
    id: row.id as string,
    // SurrealDB subquery returns [{ "meta::id(in)": "uuid" }] — extract the value
    userId: stripPrefix(
      (() => {
        const raw = row.userId ?? row.user_id;
        if (Array.isArray(raw)) {
          const first = raw[0];
          // Subquery row object: extract the value from the object
          if (first && typeof first === 'object' && !Array.isArray(first)) {
            return Object.values(first)[0];
          }
          return first;
        }
        return raw;
      })(),
    ),
    title: (row.title as string) ?? '',
    createdAt: toDateString(row.created_at),
    messageCount:
      typeof row.messageCount === 'object' && row.messageCount !== null
        ? Number(
            (Array.isArray(row.messageCount)
              ? (row.messageCount as Record<string, unknown>[])[0]?.count
              : (row.messageCount as Record<string, unknown>).count) ?? 0,
          )
        : Number(row.messageCount ?? 0),
    deletedAt: row.deleted_at != null ? toDateString(row.deleted_at) : undefined,
    locked: row.locked as boolean | undefined,
    userAgentId: row.user_agent_id ? Number(stripPrefix(row.user_agent_id)) : undefined,
    traceId: row.trace_id as string | undefined,
  };
}

/**
 * Map a raw SurrealDB result row to a UserRecord.
 * The row MUST already have its `id` field cleaned via `meta::id(id) AS id`.
 */
function toUserRecord(row: Record<string, unknown>): UserRecord {
  return {
    id: row.id as string,
    email: row.email as string | null,
    name: row.name as string | null,
    createdAt: toDateString(row.created_at),
  };
}

/**
 * Simple user-agent device type classifier.
 * Returns one of 'bot' | 'mobile' | 'tablet' | 'desktop'.
 */
function uaParser(ua: string): 'bot' | 'mobile' | 'tablet' | 'desktop' {
  const uaLower = ua.toLowerCase();
  if (uaLower.includes('bot') || uaLower.includes('crawl') || uaLower.includes('spider')) return 'bot';
  if (uaLower.includes('tablet') || uaLower.includes('ipad') || uaLower.includes('playbook')) return 'tablet';
  if (uaLower.includes('mobile') || uaLower.includes('iphone') || uaLower.includes('android')) return 'mobile';
  return 'desktop';
}

// ===========================================================================
// UserRepo
// ===========================================================================

class UserRepo implements IUserRepo {
  constructor(private db: () => Surreal) {}

  async ensureUser(userId: string, email?: string, name?: string): Promise<void> {
    const db = this.db();
    const updates = compact({ email, name });
    if (Object.keys(updates).length === 0) {
      // UPSERT: create user if absent, no-op if already exists
      await queryDb(db, `UPSERT $id`, { id: new RecordId('users', userId) });
      return;
    }
    await queryDb(
      db,
      `UPSERT $id SET ${Object.keys(updates)
        .map((k) => `${k} = $${k}`)
        .join(', ')}`,
      { id: new RecordId('users', userId), ...updates },
    );
  }

  async getOrCreateUser(userId: string, email?: string, name?: string): Promise<UserRecord> {
    const db = this.db();
    const parts: string[] = [];
    const vars: Record<string, unknown> = { id: new RecordId('users', userId) };
    if (email != null) {
      parts.push('email = $email');
      vars.email = email;
    }
    if (name != null) {
      parts.push('name = $name');
      vars.name = name;
    }
    if (parts.length > 0) {
      await queryDb(db, `UPSERT $id SET ${parts.join(', ')}`, vars);
    } else {
      await queryDb(db, 'UPSERT $id SET _ = true', vars);
    }
    const row = await db.select(new RecordId('users', userId));
    if (!row) throw new Error('getOrCreateUser returned no rows');
    const raw = row as Record<string, unknown>;
    raw.id = stripPrefix(raw.id);
    return toUserRecord(raw);
  }

  async getUser(userId: string): Promise<UserRecord | undefined> {
    const db = this.db();
    const row = await db.select(new RecordId('users', userId));
    if (!row) return undefined;
    const raw = row as Record<string, unknown>;
    raw.id = stripPrefix(raw.id);
    return toUserRecord(raw);
  }

  async updateUser(userId: string, updates: Partial<Pick<UserRecord, 'email' | 'name'>>): Promise<void> {
    const filtered = compact(updates);
    if (Object.keys(filtered).length === 0) return;

    const db = this.db();
    await db.update(new RecordId('users', userId)).merge(filtered);
  }
}

// ===========================================================================
// ChatRepo
// ===========================================================================

class ChatRepo implements IChatRepo {
  constructor(private db: () => Surreal) {}

  async ensureChat(chatId: string, userId: string): Promise<void> {
    const db = this.db();
    const existing = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT id FROM has_chat WHERE in = $userId AND out = $chatId`,
      { userId: new RecordId('users', userId), chatId: new RecordId('chats', chatId) },
    );
    if (existing.length === 0) {
      await queryDb(db, `RELATE $userId->has_chat->$chatId`, {
        userId: new RecordId('users', userId),
        chatId: new RecordId('chats', chatId),
      });
    }
  }

  async createChat(userId: string, title?: string, userAgentId?: number): Promise<string> {
    const db = this.db();
    const chatId = randomUUID();
    log.debug`[ChatRepo.createChat] userId=${userId} title=${title} userAgentId=${userAgentId} chatId=${chatId}`;
    await createRecord(
      db,
      'chats',
      {
        title: title ?? 'New Chat',
        user_agent_id: userAgentId != null ? new RecordId('user_agents', userAgentId) : null,
        created_at: new Date(),
      },
      chatId,
    );
    await queryDb(db, `RELATE $userId->has_chat->$chatId`, {
      userId: new RecordId('users', userId),
      chatId: new RecordId('chats', chatId),
    });
    return chatId;
  }

  async getChats(userId: string): Promise<Chat[]> {
    const db = this.db();
    // Step 1: Get chat record IDs via graph traversal (INSIDE broken in SurrealDB 3.1.4)
    const refs = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT ->has_chat->chats AS chatRefs FROM type::record('users', $userId) LIMIT 1`,
      { userId },
    );
    const chatRefs = (refs[0]?.chatRefs as string[]) ?? [];
    if (chatRefs.length === 0) return [];

    // Step 2: Query chats with subqueries for userId and messageCount
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT meta::id(id) AS id, title, created_at, user_agent_id, off_topic_count, locked,
       (SELECT meta::id(in) FROM has_chat WHERE out = $parent.id LIMIT 1) AS userId,
       (SELECT count() FROM has_message WHERE in = $parent.id AND out.role = 'user' AND out.deleted_at IS NONE GROUP ALL) AS messageCount
       FROM $chats WHERE deleted_at IS NONE ORDER BY created_at DESC`,
      { chats: chatRefs },
    );
    return rows.map(toChat);
  }

  async getChat(chatId: string): Promise<Chat | undefined> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT *, meta::id(id) AS id, (SELECT meta::id(in) FROM has_chat WHERE out = $parent.id LIMIT 1) AS userId, (SELECT count() FROM has_message WHERE in = $parent.id AND out.role = 'user' AND out.deleted_at IS NONE GROUP ALL) AS messageCount FROM chats WHERE id = $chatId AND deleted_at IS NONE`,
      { chatId: new RecordId('chats', chatId) },
    );
    if (rows.length === 0) return undefined;
    return toChat(rows[0]);
  }

  async updateChat(chatId: string, updates: Partial<Pick<Chat, 'title' | 'locked' | 'deletedAt'>>): Promise<void> {
    const filtered = compact(updates);
    if (Object.keys(filtered).length === 0) return;

    const db = this.db();
    await db.update(new RecordId('chats', chatId)).merge(filtered);
  }

  async deleteChat(chatId: string): Promise<void> {
    const db = this.db();
    await db.update(new RecordId('chats', chatId)).merge({ deleted_at: new Date() });
  }

  async hardDeleteOldChats(before: Date): Promise<number> {
    const db = this.db();
    const deleted = await queryDb<unknown[]>(db, `DELETE chats WHERE created_at < $before`, {
      before: before.toISOString(),
    });
    return deleted.length;
  }

  async renameChat(chatId: string, title: string): Promise<void> {
    const db = this.db();
    await db.update(new RecordId('chats', chatId)).merge({ title });
  }

  async getChatMessageCount(chatId: string): Promise<number> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT count() AS count FROM has_message WHERE in = $chatId AND out.role = $role AND out.deleted_at IS NONE GROUP ALL`,
      { chatId: new RecordId('chats', chatId), role: 'user' },
    );
    return (rows[0]?.count as number) ?? 0;
  }

  async getUserChatCount(userId: string): Promise<number> {
    const db = this.db();
    // Step 1: Get chat record IDs via graph traversal (INSIDE broken in SurrealDB 3.1.4)
    const refs = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT ->has_chat->chats AS chatRefs FROM type::record('users', $userId) LIMIT 1`,
      { userId },
    );
    const chatRefs = (refs[0]?.chatRefs as string[]) ?? [];
    if (chatRefs.length === 0) return 0;

    // Step 2: Count non-deleted chats from those refs
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT count() AS count FROM $chats WHERE deleted_at IS NONE GROUP ALL`,
      { chats: chatRefs },
    );
    return (rows[0]?.count as number) ?? 0;
  }

  async lockChat(chatId: string): Promise<void> {
    const db = this.db();
    await db.update(new RecordId('chats', chatId)).merge({ locked: true });
  }

  async isChatLocked(chatId: string): Promise<boolean> {
    const db = this.db();
    const row = await db.select(new RecordId('chats', chatId));
    if (!row) return false;
    return (row as Record<string, unknown>)?.locked === true;
  }

  async getOffTopicCount(chatId: string): Promise<number> {
    const db = this.db();
    const row = await db.select(new RecordId('chats', chatId));
    if (!row) return 0;
    return ((row as Record<string, unknown>)?.off_topic_count as number) ?? 0;
  }

  async incrementOffTopicCount(chatId: string): Promise<number> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `UPDATE $chatId SET off_topic_count += 1 RETURN off_topic_count`,
      {
        chatId: new RecordId('chats', chatId),
      },
    );
    return rows.length > 0 ? ((rows[0]?.off_topic_count as number) ?? 1) : 1;
  }

  async clearChatMessages(chatId: string): Promise<void> {
    const db = this.db();
    await queryDb(db, `DELETE $chatId->has_message->messages`, {
      chatId: new RecordId('chats', chatId),
    });
    // Clean up edges
    await queryDb(db, `DELETE has_message WHERE in = $chatId`, { chatId: new RecordId('chats', chatId) });
  }

  async getChatSummaryForApi(chatId: string): Promise<ChatSummary | undefined> {
    const db = this.db();

    // Three independent queries — more reliable than SurrealQL subqueries.
    const chatRow = await db.select(new RecordId('chats', chatId));
    if (!chatRow) return undefined;
    const rawChat = chatRow as Record<string, unknown>;
    rawChat.id = stripPrefix(rawChat.id);
    const chat = toChat(rawChat);

    const countRows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT count() AS count FROM has_message WHERE in = $chatId AND out.role = $role AND out.deleted_at IS NONE GROUP ALL`,
      { chatId: new RecordId('chats', chatId), role: 'user' },
    );
    const messageCount = (countRows[0]?.count as number) ?? 0;

    const lastRows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT MAX(created_at) AS lastAt FROM $chatId->has_message->messages GROUP ALL`,
      { chatId: new RecordId('chats', chatId) },
    );
    const lastMessageAt = (lastRows[0]?.lastAt as string) ?? null;

    return {
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      messageCount,
      lastMessageAt,
    };
  }
}

// ===========================================================================
// MessageRepo
// ===========================================================================

class MessageRepo implements IMessageRepo {
  constructor(
    private db: () => Surreal,
    private userRepo: IUserRepo,
    private chatRepo: IChatRepo,
  ) {}

  async addMessage(params: AddMessageParams): Promise<string> {
    // Generate or use the provided message ID
    const id = params.msgId ?? randomUUID();

    // Ensure the parent entities exist
    log.debug`[MessageRepo.addMessage] ensureUser starting, userId=${params.userId}`;
    await this.userRepo.ensureUser(params.userId);
    log.debug`[MessageRepo.addMessage] ensureUser completed`;
    log.debug`[MessageRepo.addMessage] ensureChat starting, chatId=${params.chatId}`;
    if (params.chatId) {
      await this.chatRepo.ensureChat(params.chatId, params.userId);
    }
    log.debug`[MessageRepo.addMessage] ensureChat completed`;

    const db = this.db();
    const traceCtx = getCurrentTraceContext();
    log.debug`[MessageRepo.addMessage] db.create(messages) starting, id=${id}`;
    await createRecord(
      db,
      'messages',
      {
        user_id: new RecordId('users', params.userId),
        role: params.role,
        content: params.content,
        sources: params.sources ?? '[]',
        reasoning: params.reasoning ?? '',
        created_at: new Date(),
        tokens_in: params.tokensIn ?? 0,
        tokens_out: params.tokensOut ?? 0,
        duration_ms: params.durationMs ?? 0,
        max_tokens: params.maxTokens ?? 0,
        query_type: params.queryType ?? null,
        irrecoverable: params.irrecoverable ?? false,
        error: params.error ?? null,
        user_agent_id: params.userAgentId != null ? new RecordId('user_agents', params.userAgentId) : undefined,
        from_cache: params.fromCache ?? false,
        trace_id: traceCtx?.traceId ?? null,
      },
      id,
    );
    log.debug`[MessageRepo.addMessage] db.create(messages) completed, id=${id}`;

    // Create has_message edge: chats:chatId -> has_message -> messages:msgId
    if (params.chatId) {
      await db.relate(new RecordId('chats', params.chatId), new Table('has_message'), new RecordId('messages', id), {
        created_at: new Date(),
      });
    }

    return id;
  }

  async createMessageForStreaming(
    params: Pick<AddMessageParams, 'userId' | 'chatId' | 'role' | 'queryType' | 'userAgentId' | 'msgId'>,
  ): Promise<string> {
    const id = params.msgId ?? randomUUID();

    // Ensure parent entities exist
    await this.userRepo.ensureUser(params.userId);
    if (params.chatId) {
      await this.chatRepo.ensureChat(params.chatId, params.userId);
    }

    const db = this.db();
    const traceCtx = getCurrentTraceContext();

    // Create message record with empty content — will be updated by finalizeMessage
    await createRecord(
      db,
      'messages',
      {
        user_id: new RecordId('users', params.userId),
        role: params.role,
        content: '',
        sources: '[]',
        reasoning: '',
        created_at: new Date(),
        tokens_in: 0,
        tokens_out: 0,
        duration_ms: 0,
        max_tokens: 0,
        query_type: params.queryType ?? null,
        irrecoverable: false,
        error: null,
        user_agent_id: params.userAgentId != null ? new RecordId('user_agents', params.userAgentId) : undefined,
        from_cache: false,
        trace_id: traceCtx?.traceId ?? null,
      },
      id,
    );

    // Create has_message edge: chats:chatId -> has_message -> messages:msgId
    if (params.chatId) {
      await db.relate(new RecordId('chats', params.chatId), new Table('has_message'), new RecordId('messages', id), {
        created_at: new Date(),
      });
    }

    log.debug`[MessageRepo.createMessageForStreaming] created message ${id} for streaming`;
    return id;
  }

  async finalizeMessage(
    msgId: string,
    updates: Pick<
      AddMessageParams,
      | 'content'
      | 'sources'
      | 'reasoning'
      | 'tokensIn'
      | 'tokensOut'
      | 'durationMs'
      | 'maxTokens'
      | 'irrecoverable'
      | 'error'
      | 'fromCache'
    >,
  ): Promise<void> {
    const db = this.db();
    log.debug`[MessageRepo.finalizeMessage] msgId=${msgId}`;
    await db.update(new RecordId('messages', msgId)).merge({
      content: updates.content,
      sources: updates.sources ?? '[]',
      reasoning: updates.reasoning ?? '',
      tokens_in: updates.tokensIn ?? 0,
      tokens_out: updates.tokensOut ?? 0,
      duration_ms: updates.durationMs ?? 0,
      max_tokens: updates.maxTokens ?? 0,
      irrecoverable: updates.irrecoverable ?? false,
      error: updates.error ?? null,
      from_cache: updates.fromCache ?? false,
    });
  }

  async setMessageModel(msgId: string, modelId: string): Promise<void> {
    const db = this.db();
    log.debug`[MessageRepo.setMessageModel] msgId=${msgId} modelId=${modelId}`;
    await db.relate(new RecordId('messages', msgId), new Table('used_model'), new RecordId('models', modelId), {
      created_at: new Date(),
    });
  }

  async getMessages(chatId: string, limit?: number, offset?: number): Promise<StoredMessage[]> {
    const db = this.db();
    const l = limit ?? 100;
    const o = offset ?? 0;
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT *, meta::id(id) AS id, (SELECT VALUE meta::id(out) FROM ->used_model LIMIT 1)[0] AS model_id FROM $chatId->has_message->messages WHERE deleted_at IS NONE ORDER BY created_at ASC LIMIT $limit START $offset`,
      { chatId: new RecordId('chats', chatId), limit: l, offset: o },
    );
    return rows.map(toStoredMessage);
  }

  async getMessagesByUserId(userId: string, limit?: number, offset?: number): Promise<StoredMessage[]> {
    const db = this.db();
    const l = limit ?? 100;
    const o = offset ?? 0;
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT *, meta::id(id) AS id, (SELECT VALUE meta::id(out) FROM ->used_model LIMIT 1)[0] AS model_id FROM messages WHERE user_id = $userId AND deleted_at IS NONE ORDER BY created_at ASC LIMIT $limit START $offset`,
      { userId: new RecordId('users', userId), limit: l, offset: o },
    );
    return rows.map(toStoredMessage);
  }

  async getLastMessagesCount(chatId: string, count: number): Promise<StoredMessage[]> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT *, meta::id(id) AS id, (SELECT VALUE meta::id(out) FROM ->used_model LIMIT 1)[0] AS model_id FROM $chatId->has_message->messages WHERE deleted_at IS NONE ORDER BY created_at DESC LIMIT $count`,
      { chatId: new RecordId('chats', chatId), count },
    );
    // Reverse to return in chronological order
    return rows.map(toStoredMessage).reverse();
  }

  async hardDeleteOldMessages(before: Date): Promise<number> {
    const db = this.db();
    const deleted = await queryDb<unknown[]>(db, `DELETE messages WHERE created_at < $before`, {
      before: before.toISOString(),
    });
    return deleted.length;
  }

  async setAssistantMessageContent(messageId: string, content: string): Promise<void> {
    const db = this.db();
    await db.update(new RecordId('messages', messageId)).merge({ content });
  }

  async softDeleteMessage(messageId: string): Promise<void> {
    const db = this.db();
    await db.update(new RecordId('messages', messageId)).merge({ deleted_at: new Date() });
  }

  async setMessageQueryType(messageId: string, queryType: string): Promise<void> {
    const db = this.db();
    await db.update(new RecordId('messages', messageId)).merge({ query_type: queryType });
  }
}

// ===========================================================================
// Stub repos (not yet migrated)
// ===========================================================================

// ===========================================================================
// EventRepo
// ===========================================================================

class EventRepo implements IEventRepo {
  private seq = 0;

  constructor(private db: () => Surreal) {}

  async insertChatEvent(chatId: string, type: string, data: unknown): Promise<number> {
    const db = this.db();
    const eventId = Date.now() * 1000 + (this.seq++ % 1000);
    log.debug(`[EventsRepo.insertChatEvent] db.create starting, chatId=${chatId} type=${type}`);
    await createRecord(
      db,
      'chat_events',
      {
        type,
        data: JSON.stringify(data),
        created_at: new Date(),
      },
      eventId,
    );

    // Create has_event edge: chats:chatId -> has_event -> chat_events:eventId
    await db.relate(
      new RecordId('chats', chatId),
      new Table('has_event'),
      new RecordId('chat_events', String(eventId)),
      { created_at: new Date() },
    );

    log.debug`[EventsRepo.insertChatEvent] db.create completed, id=${eventId}`;
    return eventId;
  }

  async getChatEventsSince(chatId: string, lastEventId: number): Promise<ChatEvent[]> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT meta::id(id) AS id, type, data, created_at AS createdAt
       FROM chat_events
       WHERE id INSIDE (SELECT out FROM has_event WHERE in = $chatId)
         AND <int> meta::id(id) > $lastEventId
       ORDER BY id ASC`,
      { chatId: new RecordId('chats', chatId), lastEventId },
    );
    return rows.map((r) => ({
      id: Number(r.id),
      type: String(r.type),
      data: JSON.parse(String(r.data)),
      createdAt: String(r.createdAt),
    }));
  }
}

// ===========================================================================
// ReactionRepo
// ===========================================================================

class ReactionRepo implements IReactionRepo {
  constructor(private db: () => Surreal) {}

  async setReaction(
    messageId: string,
    userId: string,
    reactionType: 'up' | 'down' | 'heart',
    reason?: string,
  ): Promise<void> {
    log.debug`[ReactionRepo.setReaction] messageId=${messageId} userId=${userId} reactionType=${reactionType} reason=${reason}`;
    const db = this.db();
    // Check if user already has a reaction on this message
    const existing = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT id FROM reactions WHERE id IN (SELECT out FROM has_reaction WHERE in = $messageId) AND user_id = $userId LIMIT 1`,
      {
        messageId: new RecordId('messages', messageId),
        userId: new RecordId('users', userId),
      },
    );

    if (existing.length > 0) {
      // Update existing reaction
      const reactionId = existing[0].id as RecordId;
      await queryDb(
        db,
        `UPDATE $reactionId SET reaction_type = $reactionType, reason = $reason, created_at = $createdAt`,
        {
          reactionId,
          reactionType,
          reason: reason ?? '',
          createdAt: new Date(),
        },
      );
    } else {
      // Create new reaction
      const created = await queryDb<Array<Record<string, unknown>>>(
        db,
        `CREATE reactions CONTENT { user_id: $userId, reaction_type: $reactionType, reason: $reason, created_at: $createdAt } RETURN AFTER`,
        {
          userId: new RecordId('users', userId),
          reactionType,
          reason: reason ?? '',
          createdAt: new Date(),
        },
      );

      if (created.length > 0) {
        const newReactionId = created[0].id as RecordId;
        await db.relate(new RecordId('messages', messageId), new Table('has_reaction'), newReactionId, {
          created_at: new Date(),
        });
      }
    }
  }

  async getReaction(messageId: string, userId: string): Promise<ReactionResult | null> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT * FROM reactions WHERE id IN (SELECT out FROM has_reaction WHERE in = $messageId) AND user_id = $userId LIMIT 1`,
      {
        messageId: new RecordId('messages', messageId),
        userId: new RecordId('users', userId),
      },
    );
    if (rows.length === 0) return null;
    const r = rows[0] as Record<string, unknown>;
    return {
      type: r.reaction_type as 'up' | 'down' | 'heart',
      reason: String(r.reason ?? ''),
    };
  }

  async deleteReaction(messageId: string, userId: string): Promise<void> {
    const db = this.db();
    const msgId = new RecordId('messages', messageId);
    const usrId = new RecordId('users', userId);
    // Capture IDs first, then delete both in one transaction
    await db.query(
      `LET $rids = (SELECT id FROM reactions WHERE user_id = $usrId AND id IN (SELECT out FROM has_reaction WHERE in = $msgId));
       DELETE has_reaction WHERE in = $msgId AND out IN $rids;
       DELETE reactions WHERE id IN $rids;`,
      { msgId, usrId },
    );
  }
}

// ===========================================================================
// ToolCallRepo
// ===========================================================================

class ToolCallRepo implements IToolCallRepo {
  constructor(private db: () => Surreal) {}

  async getToolCallsByMessageId(messageId: string): Promise<ToolCallRecord[]> {
    const db = this.db();
    // Step 1: Get tool_call record IDs via graph traversal (IN subquery broken in SurrealDB 3.1.4)
    const relRows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT meta::id(out) AS toolCallId FROM has_tool_call WHERE in = $messageId`,
      { messageId: new RecordId('messages', messageId) },
    );
    const toolCallIds = relRows.map((r) => new RecordId('tool_calls', String(r.toolCallId)));
    if (toolCallIds.length === 0) return [];

    // Step 2: Query tool_calls using those IDs
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT meta::id(id) AS id, name, server_id AS serverId, started_at AS startedAt, finished_at AS finishedAt
       FROM tool_calls WHERE id IN $toolCallIds ORDER BY started_at ASC`,
      { toolCallIds },
    );
    return rows.map((r) => {
      const startedAt = String(r.startedAt);
      const finishedAt = r.finishedAt ? String(r.finishedAt) : null;
      return {
        id: String(r.id),
        name: String(r.name),
        serverId: String(r.serverId),
        startedAt,
        finishedAt,
        durationMs: finishedAt ? Math.round(new Date(finishedAt).getTime() - new Date(startedAt).getTime()) : null,
      };
    });
  }

  async getToolCallsForMessages(messageIds: string[]): Promise<Record<string, ToolCallRecord[]>> {
    if (messageIds.length === 0) return {};
    const db = this.db();

    // Step 1: Get all message→tool_call mappings via graph traversal (batch, no N+1)
    const relRows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT meta::id(in) AS msgId, meta::id(out) AS toolCallId FROM has_tool_call WHERE in IN $messageIds`,
      { messageIds: messageIds.map((id) => new RecordId('messages', id)) },
    );

    // Group toolCallIds by msgId
    const msgToToolCallIds: Record<string, string[]> = {};
    const allToolCallIdSet = new Set<string>();
    for (const row of relRows) {
      const msgId = String(row.msgId);
      const toolCallId = String(row.toolCallId);
      if (!msgToToolCallIds[msgId]) msgToToolCallIds[msgId] = [];
      msgToToolCallIds[msgId].push(toolCallId);
      allToolCallIdSet.add(toolCallId);
    }
    if (allToolCallIdSet.size === 0) return {};

    // Step 2: Query all tool_calls in one shot
    const allToolCallIds = [...allToolCallIdSet].map((id) => new RecordId('tool_calls', id));
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT meta::id(id) AS id, name, server_id AS serverId, started_at AS startedAt, finished_at AS finishedAt
       FROM tool_calls WHERE id IN $allToolCallIds ORDER BY started_at ASC`,
      { allToolCallIds },
    );

    // Build id→record lookup
    const toolCallById: Record<string, ToolCallRecord> = {};
    for (const r of rows) {
      const startedAt = String(r.startedAt);
      const finishedAt = r.finishedAt ? String(r.finishedAt) : null;
      toolCallById[String(r.id)] = {
        id: String(r.id),
        name: String(r.name),
        serverId: String(r.serverId),
        startedAt,
        finishedAt,
        durationMs: finishedAt ? Math.round(new Date(finishedAt).getTime() - new Date(startedAt).getTime()) : null,
      };
    }

    // Build final map: msgId → ToolCallRecord[]
    const map: Record<string, ToolCallRecord[]> = {};
    for (const msgId of messageIds) {
      const tcIds = msgToToolCallIds[msgId];
      if (tcIds && tcIds.length > 0) {
        const records = tcIds.map((id) => toolCallById[id]).filter(Boolean);
        if (records.length > 0) {
          map[msgId] = records;
        }
      }
    }
    return map;
  }

  async insertToolCall(id: string, msgId: string, name: string, serverId: string, toolInput: string): Promise<void> {
    const db = this.db();
    await createRecord(
      db,
      'tool_calls',
      {
        name,
        server_id: serverId,
        tool_input: toolInput,
        started_at: new Date().toISOString(),
      },
      id,
    );

    // Create has_tool_call edge: messages → tool_calls
    try {
      await db.relate(new RecordId('messages', msgId), new Table('has_tool_call'), new RecordId('tool_calls', id), {
        created_at: new Date(),
      });
    } catch (edgeErr) {
      log.warn`[ToolCallRepo.createToolCall] Failed to create has_tool_call edge for tool_call ${id}: ${(edgeErr as Error).message}`;
    }
  }

  async setToolCallResult(id: string, result: string, resultSize: number): Promise<void> {
    const db = this.db();
    await db.update(new RecordId('tool_calls', id)).merge({
      tool_output: result,
      result_size: resultSize,
      finished_at: new Date().toISOString(),
    });
  }
}

// ===========================================================================
// ContentRepo
// ===========================================================================

/** Parse a JSON toc string or return []. */
function parseToc(raw: unknown): { id: string; text: string; level: number }[] {
  try {
    const parsed = JSON.parse(String(raw ?? '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

class ContentRepo implements IContentRepo {
  constructor(private db: () => Surreal) {}

  async getStoredHashes(): Promise<{ slug: string; hash: string }[]> {
    const db = this.db();
    const posts = await db.select<Record<string, unknown>>(new Table('page_posts'));
    const experiences = await db.select<Record<string, unknown>>(new Table('page_experience'));
    return [...posts, ...experiences].map((r) => ({
      slug: String(r.slug),
      hash: String(r.hash),
    }));
  }

  async upsertPost(opts: {
    slug: string;
    hash: string;
    content: string;
    toc: string;
    title: string;
    description: string;
    date: string | null;
    tags: string[];
    status: string;
    excerpt: string;
    headerImage: string | null;
    featured: boolean;
    position: number | null;
    workflowFiles: string | null;
  }): Promise<void> {
    const db = this.db();
    const existing = await db
      .select<Array<Record<string, unknown>>>(new Table('page_posts'))
      .where(eq('slug', opts.slug))
      .limit(1);
    const data = {
      slug: opts.slug,
      hash: opts.hash,
      content: opts.content,
      toc: opts.toc,
      title: opts.title,
      description: opts.description,
      date: opts.date,
      tags: opts.tags,
      status: opts.status,
      excerpt: opts.excerpt,
      header_image: opts.headerImage,
      featured: opts.featured,
      position: opts.position,
      workflow_files: opts.workflowFiles,
      updated_at: new Date().toISOString(),
    };
    if (existing.length > 0) {
      await db.update(new RecordId('page_posts', stripPrefix(existing[0].id))).merge(data);
    } else {
      await createRecord(db, 'page_posts', data, opts.slug);
    }
  }

  async upsertExperience(opts: {
    slug: string;
    hash: string;
    content: string;
    company: string;
    role: string;
    startDate: string | null;
    endDate: string | null;
    duration: string;
    skills: string[];
    description: string;
    published: boolean;
    jobRole: string | null;
  }): Promise<void> {
    const db = this.db();
    const existing = await db
      .select<Array<Record<string, unknown>>>(new Table('page_experience'))
      .where(eq('slug', opts.slug))
      .limit(1);
    const data = {
      slug: opts.slug,
      hash: opts.hash,
      content: opts.content,
      company: opts.company,
      role: opts.role,
      start_date: opts.startDate,
      end_date: opts.endDate,
      duration: opts.duration,
      skills: opts.skills,
      description: opts.description,
      published: opts.published,
      job_role: opts.jobRole,
      updated_at: new Date().toISOString(),
    };
    if (existing.length > 0) {
      await db.update(new RecordId('page_experience', stripPrefix(existing[0].id))).merge(data);
    } else {
      await createRecord(db, 'page_experience', data, opts.slug);
    }
  }

  async deletePost(slug: string): Promise<void> {
    const db = this.db();
    await queryDb(db, `DELETE page_posts WHERE slug = $slug`, { slug });
  }

  async deleteExperience(slug: string): Promise<void> {
    const db = this.db();
    await queryDb(db, `DELETE page_experience WHERE slug = $slug`, { slug });
  }

  async getSlugToIdMap(): Promise<{ id: string; slug: string }[]> {
    const db = this.db();
    const rows = await db.select<Record<string, unknown>>(new Table('page_posts'));
    return rows.map((r) => ({
      id: stripPrefix(r.id),
      slug: String(r.slug),
    }));
  }

  async updatePartOfSeries(slug: string, parentSlug: string | null): Promise<void> {
    const db = this.db();
    if (parentSlug === null) {
      const existing = await db
        .select<Array<Record<string, unknown>>>(new Table('page_posts'))
        .where(eq('slug', slug))
        .limit(1);
      if (existing.length > 0) {
        const recordId = new RecordId('page_posts', stripPrefix(existing[0].id));
        // SurrealDB 3.x SCHEMAFULL rejects NULL for option<record> without | null.
        // Use UNSET to remove the field entirely rather than setting it to null.
        const msg = await db.select(recordId);
        if (msg && 'part_of_series' in (msg as Record<string, unknown>)) {
          await db.query('UPDATE $id UNSET part_of_series', { id: recordId });
        }
      }
    } else {
      const parentRows = await db.select(new Table('page_posts')).where(eq('slug', parentSlug)).limit(1);
      if (parentRows.length === 0) return;
      const childRows = await db
        .select<Array<Record<string, unknown>>>(new Table('page_posts'))
        .where(eq('slug', slug))
        .limit(1);
      if (childRows.length === 0) return;
      await db.update(new RecordId('page_posts', stripPrefix(childRows[0].id))).merge({
        part_of_series: new RecordId('page_posts', stripPrefix(parentRows[0].id)),
      });
    }
  }

  async getPosts(opts?: {
    slug?: string;
    sort?: 'date' | 'title';
    order?: 'asc' | 'desc';
    limit?: number;
  }): Promise<Post[]> {
    const db = this.db();
    const sortField = opts?.sort ?? 'date';
    const sortOrder = opts?.order ?? 'desc';
    const sortColumn = sortField === 'title' ? 'title' : 'date';

    let sql = `SELECT * FROM page_posts`;
    const vars: Record<string, unknown> = {};

    if (opts?.slug) {
      sql += ` WHERE slug = $slug`;
      vars.slug = opts.slug;
    }

    sql += ` ORDER BY ${sortColumn} ${sortOrder === 'asc' ? 'ASC' : 'DESC'}`;

    if (opts?.limit != null && opts.limit > 0) {
      sql += ` LIMIT $limit`;
      vars.limit = opts.limit;
    }

    const rows = await queryDb<Array<Record<string, unknown>>>(db, sql, vars);
    return rows.map((r) => ({
      id: Number(stripPrefix(r.id)),
      slug: String(r.slug),
      content: String(r.content),
      toc: parseToc(r.toc),
      title: String(r.title ?? ''),
      description: String(r.description ?? ''),
      date: r.date ? String(r.date) : '',
      tags: (r.tags as string[]) ?? [],
      status: String(r.status),
      excerpt: String(r.excerpt ?? ''),
      headerImage: r.header_image ? String(r.header_image) : null,
      featured: Boolean(r.featured),
      position: r.position != null ? Number(r.position) : null,
      partOfSeries: r.part_of_series != null ? Number(stripPrefix(r.part_of_series)) : null,
      workflowFiles: (() => {
        try {
          return JSON.parse(String(r.workflow_files ?? 'null'));
        } catch {
          return null;
        }
      })(),
    }));
  }

  async getExperience(slug?: string): Promise<ExperienceEntry[]> {
    const db = this.db();
    let query = db.select<Record<string, unknown>>(new Table('page_experience'));
    if (slug) {
      query = query.where(eq('slug', slug));
    }
    const rows = (await query) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      slug: String(r.slug),
      content: String(r.content),
      company: String(r.company ?? ''),
      role: String(r.role ?? ''),
      startDate: r.start_date ? String(r.start_date) : null,
      endDate: r.end_date ? String(r.end_date) : null,
      duration: String(r.duration ?? ''),
      skills: (r.skills as string[]) ?? [],
      description: String(r.description ?? ''),
      jobRole: r.job_role ? String(r.job_role) : '',
      published: Boolean(r.published),
    }));
  }

  async getRelatedBusinessPages(slug: string): Promise<string[]> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT slug FROM page_posts
       WHERE slug != $slug AND array::intersects(tags, (SELECT tags FROM page_posts WHERE slug = $slug LIMIT 1)[0].tags)`,
      { slug },
    );
    return rows.map((r) => String(r.slug));
  }
}

// ===========================================================================
// LeadRepo
// ===========================================================================

class LeadRepo implements ILeadRepo {
  constructor(private db: () => Surreal) {}

  async insertLead(
    userId: string,
    name: string,
    email: string,
    companyName: string,
    role: string,
    message: string,
    ipAddress: string,
  ): Promise<void> {
    const db = this.db();
    await createRecord(db, 'leads', {
      user_id: new RecordId('users', userId),
      name,
      email,
      company_name: companyName,
      role,
      message,
      ip_address: ipAddress,
      created_at: new Date(),
    });
  }
}

// ===========================================================================
// ContactIntentRepo
// ===========================================================================

class ContactIntentRepo implements IContactIntentRepo {
  constructor(private db: () => Surreal) {}

  async insertContactIntent(userId: string, chatId: string, text: string): Promise<void> {
    const db = this.db();
    await createRecord(db, 'contact_intents', {
      user_id: new RecordId('users', userId),
      chat_id: new RecordId('chats', chatId),
      text,
      created_at: new Date(),
    });
  }

  async updateUserContact(userId: string, name: string, email: string): Promise<void> {
    const db = this.db();
    await db.update(new RecordId('users', userId)).merge({ name, email });
  }
}

// ===========================================================================
// UserAgentRepo
// ===========================================================================

class UserAgentRepo implements IUserAgentRepo {
  private agentSeq = 0;

  constructor(private db: () => Surreal) {}

  async getOrCreateUserAgent(ua: string, ip?: string): Promise<number> {
    const db = this.db();
    const trimmed = ua.slice(0, 500);

    // Check if user agent already exists
    const existingRows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT meta::id(id) AS id, ua, device_type AS deviceType, ip, created_at AS createdAt FROM user_agents WHERE ua = $ua LIMIT 1`,
      { ua: trimmed },
    );
    if (existingRows.length > 0) {
      const agentId = Number(stripPrefix(existingRows[0].id));
      if (Number.isFinite(agentId) && agentId > 0) {
        // Valid existing record — update ip if needed
        if (ip) {
          await queryDb(db, `UPDATE $agentId SET ip = $ip WHERE ip IS NONE`, {
            agentId: new RecordId('user_agents', stripPrefix(existingRows[0].id)),
            ip,
          });
        }
        return agentId;
      }
      // Corrupted record (NaN/0/negative) — delete it and recreate below
      await queryDb(db, `DELETE $id`, {
        id: new RecordId('user_agents', stripPrefix(existingRows[0].id)),
      }).catch(() => {}); // best-effort cleanup
    }

    // Create new user agent
    // Derive deviceType from ua
    const deviceType = uaParser(trimmed);
    const agentId = Date.now() * 1000 + (this.agentSeq++ % 1000);
    await createRecord(
      db,
      'user_agents',
      {
        ua: trimmed,
        device_type: deviceType,
        ip: ip ?? null,
        created_at: new Date(),
      },
      agentId,
    );
    return agentId;
  }

  async getUserAgents(): Promise<UserAgentRecord[]> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT meta::id(id) AS id, ua, device_type AS deviceType, ip, created_at AS createdAt FROM user_agents ORDER BY created_at DESC`,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      ua: String(r.ua),
      deviceType: r.deviceType ? String(r.deviceType) : null,
      ip: r.ip ? String(r.ip) : null,
      createdAt: String(r.createdAt),
    }));
  }
}

class LlmCacheRepo implements ILlmCacheRepo {
  constructor(private db: () => Surreal) {}

  async searchCache(embedding: number[], limit = 5): Promise<CacheHit[]> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT answer, array::join(sources, '\n') AS sources, tool_calls, created_at, vector::similarity::cosine(question_embedding, $embedding) AS score
       FROM llm_cache
       ORDER BY score DESC
       LIMIT $limit`,
      { embedding, limit },
    );
    return rows.map((r) => ({
      answer: String(r.answer),
      sources: String(r.sources),
      toolCalls: Array.isArray(r.tool_calls) ? r.tool_calls.map((tc: string) => JSON.parse(tc)) : undefined,
      score: r.score !== undefined ? Number(r.score) : undefined,
      createdAt: r.created_at ? String(r.created_at) : undefined,
    }));
  }

  async getCached(cacheId: number): Promise<CacheEntry | undefined> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT meta::id(id) AS id, question, answer, array::join(sources, '\n') AS sources, array::join(tool_calls, '\n') AS tool_calls, meta::id(message_id) AS message_id, created_at
       FROM $cacheId`,
      { cacheId: new RecordId('llm_cache', cacheId.toString()) },
    );
    if (rows.length === 0) return undefined;
    const r = rows[0];
    return {
      id: Number(r.id),
      question: String(r.question),
      answer: String(r.answer),
      sources: String(r.sources),
      toolCalls: r.tool_calls ? String(r.tool_calls) : null,
      messageId: r.message_id ? String(r.message_id) : null,
      createdAt: String(r.created_at),
    };
  }

  async setCached(
    question: string,
    answer: string,
    embedding: number[],
    sources: string,
    toolCalls?: string,
    messageId?: string,
  ): Promise<void> {
    const db = this.db();
    const sourcesArray = sources ? sources.split('\n').filter(Boolean) : [];
    const toolCallsArray = toolCalls ? toolCalls.split('\n').filter(Boolean) : [];
    await createRecord(db, 'llm_cache', {
      question,
      question_embedding: embedding,
      answer,
      sources: sourcesArray,
      tool_calls: toolCallsArray,
      message_id: messageId != null ? new RecordId('messages', messageId) : null,
      created_at: new Date(),
    });
  }

  async getCacheStats(): Promise<CacheStats> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT count() AS total, math::min(created_at) AS oldest, math::max(created_at) AS newest
       FROM llm_cache GROUP ALL`,
    );
    if (rows.length === 0) {
      return { totalEntries: 0, oldestEntry: null, newestEntry: null };
    }
    const r = rows[0];
    return {
      totalEntries: Number(r.total),
      oldestEntry: r.oldest ? String(r.oldest) : null,
      newestEntry: r.newest ? String(r.newest) : null,
    };
  }
}

class VectorRepo implements IVectorRepo {
  constructor(private db: () => Surreal) {}

  async upsertChunks(rows: ChunkRecord[]): Promise<string[]> {
    const db = this.db();
    const ids: string[] = [];
    for (const r of rows) {
      const existing = await queryDb<Array<Record<string, unknown>>>(
        db,
        `SELECT meta::id(id) AS id FROM chunks WHERE chunk_id = $chunkId`,
        { chunkId: r.chunkId },
      );
      const data = {
        chunk_id: r.chunkId,
        text: r.text,
        title: r.title,
        date: r.date,
        tags: r.tags,
        section: r.section,
        embedding: r.embedding,
      };
      if (existing.length > 0) {
        await db.update(new RecordId('chunks', String(existing[0].id))).merge(data);
      } else {
        await createRecord(db, 'chunks', data, r.chunkId);
      }
      ids.push(r.chunkId);
    }
    return ids;
  }

  async createEdges(
    parentTable: 'page_posts' | 'page_experience',
    parentSlug: string,
    chunkIds: string[],
  ): Promise<void> {
    if (chunkIds.length === 0) return;
    if (parentTable !== 'page_posts' && parentTable !== 'page_experience') {
      throw new Error(`Invalid parentTable: ${parentTable}`);
    }
    const db = this.db();
    // Always backtick-quote IDs — slugs contain hyphens which break the parser
    // Batch all RELATEs into one query to stay in the same transaction context
    const src = `${parentTable}:\`${parentSlug}\``;
    const stmts = chunkIds.map((chunkId) => `RELATE ${src} -> has_chunk -> chunks:\`${chunkId}\``).join('; ');
    await db.query(stmts);
  }

  async deleteChunksBySlug(slug: string): Promise<void> {
    const db = this.db();
    // Delete edges whose `in` references this slug (page_posts or page_experience)
    const allEdges = (await db.select(new Table('has_chunk'))) as unknown as Array<
      Record<string, unknown> & { id: RecordId; in: RecordId }
    >;
    const parentTables = ['page_posts', 'page_experience'];
    for (const edge of allEdges) {
      const inId = String(edge.in);
      const matches = parentTables.some((t) => inId === `${t}:${slug}`);
      if (matches && edge.id) {
        await db.delete(edge.id);
      }
    }
    // Delete chunks whose chunk_id starts with the slug prefix
    const prefix = `${slug}_chunk_`;
    const allChunks = (await db.select(new Table('chunks'))) as unknown as Array<
      Record<string, unknown> & { id: RecordId; chunk_id: string }
    >;
    for (const chunk of allChunks) {
      if (typeof chunk.chunk_id === 'string' && chunk.chunk_id.startsWith(prefix) && chunk.id) {
        await db.delete(chunk.id);
      }
    }
  }

  async searchChunks(embedding: number[], limit = 10, typeFilter?: 'post' | 'experience'): Promise<SearchResult[]> {
    const db = this.db();

    // Step 1: Vector similarity search (over-fetch when typeFilter to compensate for JS-side filtering)
    const fetchLimit = typeFilter ? limit * 5 : limit;
    const chunkRows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT *,
        (1 - vector::similarity::cosine(embedding, $embedding)) AS score
       FROM chunks
       ORDER BY score ASC
       LIMIT $limit`,
      { embedding, limit: fetchLimit },
    );

    if (chunkRows.length === 0) return [];

    // Step 2: Batch-fetch edges to resolve parent slug/type
    // 240 edges is tiny — full fetch is faster than a filtered query with IN clauses
    const allEdges = (await db.select(new Table('has_chunk'))) as unknown as Array<{
      in: RecordId;
      out: RecordId;
      id: RecordId;
    }>;

    const edgeMap = new Map<string, { slug: string; type: 'post' | 'experience' }>();
    for (const edge of allEdges) {
      const chunkId = String(edge.out);
      // edge.in is a RecordId like `page_posts:my-slug` — extract the table and key
      const parentStr = String(edge.in);
      const colonIdx = parentStr.indexOf(':');
      const parentTable = colonIdx >= 0 ? parentStr.slice(0, colonIdx) : parentStr;
      const parentSlug = colonIdx >= 0 ? parentStr.slice(colonIdx + 1) : parentStr;
      edgeMap.set(chunkId, {
        slug: parentSlug,
        type: parentTable === 'page_posts' ? 'post' : 'experience',
      });
    }

    // Step 3: Merge chunk scores with edge metadata, apply type filter
    let results = chunkRows
      .filter((r) => edgeMap.has(String(r.id)))
      .map((r) => {
        const edge = edgeMap.get(String(r.id))!;
        return {
          chunk: {
            id: String(r.chunkId || r.id),
            text: String(r.text),
            title: String(r.title),
            date: r.date ? String(r.date) : '',
            tags: Array.isArray(r.tags) ? r.tags : [],
            section: String(r.section),
            slug: edge.slug,
            embedding: [],
            type: edge.type,
          },
          score: Number(r.score),
        };
      });

    if (typeFilter) {
      results = results.filter((r) => r.chunk.type === typeFilter);
    }

    return results.slice(0, limit);
  }
}

class ModelRepo implements IModelRepo {
  constructor(private db: () => Surreal) {}

  async ensureModel(provider: string, modelName: string, actualModelName: string, maxTokens: number): Promise<string> {
    const db = this.db();
    const existing = await db
      .select(new Table('models'))
      .where(and(eq('provider', provider), eq('model_name', modelName)))
      .limit(1);
    if (existing.length > 0) {
      const id = stripPrefix(existing[0].id);
      await db.update(new RecordId('models', id)).merge({ max_tokens: maxTokens });
      return id;
    }
    const result = await createRecord(db, 'models', {
      provider,
      model_name: modelName,
      actual_model_name: actualModelName,
      max_tokens: maxTokens,
    });
    return stripPrefix(result.id);
  }

  async getModelByProvider(
    provider: string,
    modelName: string,
  ): Promise<{ id: string; actualModelName: string; maxTokens: number } | undefined> {
    const db = this.db();
    const rows = await db
      .select(new Table('models'))
      .where(and(eq('provider', provider), eq('model_name', modelName)))
      .limit(1);
    if (rows.length === 0) return undefined;
    const r = rows[0] as Record<string, unknown>;
    return {
      id: stripPrefix(r.id),
      actualModelName: String(r.actual_model_name),
      maxTokens: Number(r.max_tokens),
    };
  }

  async getModels(): Promise<
    Array<{ id: string; provider: string; modelName: string; actualModelName: string; maxTokens: number }>
  > {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT meta::id(id) AS id, provider, model_name, actual_model_name, max_tokens
       FROM models ORDER BY provider, model_name`,
    );
    return rows.map((r) => ({
      id: String(r.id),
      provider: String(r.provider),
      modelName: String(r.model_name),
      actualModelName: String(r.actual_model_name),
      maxTokens: Number(r.max_tokens),
    }));
  }

  async getModelById(id: string): Promise<{ modelName: string; actualModelName: string } | undefined> {
    const db = this.db();
    const row = await db.select(new RecordId('models', id));
    if (!row) return undefined;
    const r = row as Record<string, unknown>;
    return {
      modelName: String(r.model_name),
      actualModelName: String(r.actual_model_name),
    };
  }
}

// Feature tour methods are implemented directly on SurrealDatabaseService (IFeatureTourRepo)

// ===========================================================================
// CentroidRepo
// ===========================================================================

class CentroidRepo implements ICentroidRepo {
  constructor(private db: () => Surreal) {}

  async getAllCentroids(): Promise<CentroidRecord[]> {
    const db = this.db();
    const rows = await db.select(new Table('centroids'));
    return rows as unknown as CentroidRecord[];
  }

  async upsertCentroid(key: string, vector: number[], hash: string): Promise<void> {
    const db = this.db();
    // DELETE + INSERT is the only true upsert pattern that works with
    // SCHEMAFULL centroids table.  INSERT fails on existing records
    // (AlreadyExists), UPDATE ... CONTENT sets `updated` to NONE
    // (SCHEMAFULL blocks datetime=NONE with DEFAULT time::now()),
    // and db.update().merge() silently fails to create new records.
    await queryDb(db, `DELETE FROM centroids:${key}`);
    await queryDb(
      db,
      `INSERT INTO centroids (id, class, vector, dims, model, hash)
       VALUES (centroids:${key}, $class, $vector, $dims, $model, $hash)`,
      { class: key, vector, dims: EMBEDDING_DIM, model: EMBEDDING_MODEL, hash },
    );
  }
}

// ===========================================================================
// SurrealDatabaseService
// ===========================================================================

export class SurrealDatabaseService implements IDatabaseService {
  private db: () => Surreal;

  constructor() {
    this.db = () => getSurreal();

    // Instantiate all three concrete repos first
    const userRepo = new UserRepo(this.db);
    const chatRepo = new ChatRepo(this.db);

    // MessageRepo needs references to user and chat repos for ensure* calls
    this.users = userRepo;
    this.chats = chatRepo;
    this.messages = new MessageRepo(this.db, userRepo, chatRepo);
    this.events = new EventRepo(this.db);
    this.reactions = new ReactionRepo(this.db);
    this.toolCalls = new ToolCallRepo(this.db);
    this.content = new ContentRepo(this.db);
    this.leads = new LeadRepo(this.db);
    this.contactIntents = new ContactIntentRepo(this.db);
    this.userAgents = new UserAgentRepo(this.db);
    this.llmCache = new LlmCacheRepo(this.db);
    this.vector = new VectorRepo(this.db);
    this.models = new ModelRepo(this.db);
    this.featureTours = this as unknown as IFeatureTourRepo;
    this.centroids = new CentroidRepo(this.db);
  }

  async init(): Promise<void> {
    await initSurreal();
  }

  async healthCheck(): Promise<boolean> {
    try {
      const db = this.db();
      await queryDb(db, 'RETURN 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await closeSurreal();
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const db = this.db();
    await queryDb(db, 'BEGIN');
    try {
      const result = await fn();
      await queryDb(db, 'COMMIT');
      return result;
    } catch (err) {
      try {
        await queryDb(db, 'CANCEL');
      } catch {
        /* no transaction to cancel */
      }
      throw err;
    }
  }

  // Feature tour methods (IFeatureTourRepo)

  async getDismissedFeatureTours(userId: string): Promise<string[]> {
    const db = this.db();
    const result = await queryDb<Array<Record<string, unknown>>>(
      db,
      'SELECT dismissed_tours FROM users WHERE id = $id',
      { id: new RecordId('users', userId) },
    );
    const record = result?.[0];
    return (record?.dismissed_tours as string[]) ?? [];
  }

  async dismissFeatureTours(userId: string, featureIds: string[]): Promise<void> {
    const db = this.db();
    await this.users.ensureUser(userId);
    const existing = await this.getDismissedFeatureTours(userId);
    const merged = [...new Set([...existing, ...featureIds])];
    await queryDb(db, 'UPDATE users SET dismissed_tours = $tours WHERE id = $id', {
      id: new RecordId('users', userId),
      tours: merged,
    });
  }

  async resetFeatureTours(userId: string): Promise<void> {
    const db = this.db();
    await this.users.ensureUser(userId);
    await queryDb(db, 'UPDATE users SET dismissed_tours = [] WHERE id = $id', {
      id: new RecordId('users', userId),
    });
  }

  readonly users: IUserRepo;
  readonly chats: IChatRepo;
  readonly messages: IMessageRepo;
  readonly events: IEventRepo;
  readonly reactions: IReactionRepo;
  readonly toolCalls: IToolCallRepo;
  readonly content: IContentRepo;
  readonly leads: ILeadRepo;
  readonly contactIntents: IContactIntentRepo;
  readonly userAgents: IUserAgentRepo;
  readonly llmCache: ILlmCacheRepo;
  readonly vector: IVectorRepo;
  readonly models: IModelRepo;
  readonly featureTours: IFeatureTourRepo;
  readonly centroids: ICentroidRepo;
}
