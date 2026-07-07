/**
 * SurrealDatabaseService — core service layer for SurrealDB.
 *
 * Implements every repository interface defined in interfaces.ts using raw
 * SurrealQL via the surrealdb v2 SDK.  Uses query builder for simple SELECT by RecordId and WHERE
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
  IRateLimitRepo,
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
  RateLimitResult,
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
 * Remove entries with `undefined` values from an object so SurrealDB does not
 * receive `undefined` in its query variables (which can cause serialisation
 * issues).  `null` values are preserved so callers can explicitly clear a field.
 */
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

function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Map a raw SurrealDB result row to a StoredMessage.
 * The row MUST already have its `id` field cleaned via `meta::id(id) AS id`.
 */
function toStoredMessage(row: Record<string, unknown>): StoredMessage {
  return {
    id: row.id as string,
    userId: stripPrefix(row.user_id),
    chatId: row.chat_id != null ? stripPrefix(row.chat_id) : null,
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
    userId: stripPrefix(row.user_id),
    title: (row.title as string) ?? '',
    createdAt: toDateString(row.created_at),
    messageCount: (row.messageCount as number) ?? 0,
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
    email: row.email as string | undefined,
    name: row.name as string | undefined,
    githubId: row.github_id as string | undefined,
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
      await db.update(new RecordId('users', userId)).merge({});
      return;
    }
    await db.update(new RecordId('users', userId)).merge(updates);
  }

  async getOrCreateUser(userId: string, email?: string, name?: string): Promise<UserRecord> {
    const db = this.db();
    const result = await db.update(new RecordId('users', userId)).merge({
      email: email ?? null,
      name: name ?? null,
    });
    if (!result) throw new Error('getOrCreateUser returned no rows');
    const raw = result as Record<string, unknown>;
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

  async getUserByGithubId(githubId: number): Promise<UserRecord | undefined> {
    const db = this.db();
    const rows = await db.select(new Table('users')).where(eq('github_id', githubId)).limit(1);
    if (rows.length === 0) return undefined;
    const raw = rows[0] as Record<string, unknown>;
    raw.id = stripPrefix(raw.id);
    return toUserRecord(raw);
  }

  async updateUser(userId: string, updates: Partial<Pick<UserRecord, 'email' | 'name' | 'githubId'>>): Promise<void> {
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
    await db.update(new RecordId('chats', chatId)).merge({
      user_id: new RecordId('users', userId),
    });
  }

  async createChat(userId: string, title?: string, userAgentId?: number): Promise<string> {
    const db = this.db();
    const chatId = randomUUID();
    await db.create(new RecordId('chats', chatId)).content({
      user_id: new RecordId('users', userId),
      title: title ?? 'New Chat',
      user_agent_id: userAgentId != null ? new RecordId('user_agents', userAgentId) : null,
      created_at: new Date(),
    });
    return chatId;
  }

  async getChats(userId: string): Promise<Chat[]> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT *, meta::id(id) AS id FROM chats WHERE user_id = $userId AND deleted_at IS NONE ORDER BY created_at DESC`,
      { userId: new RecordId('users', userId) },
    );
    return rows.map(toChat);
  }

  async getChat(chatId: string): Promise<Chat | undefined> {
    const db = this.db();
    const row = await db.select(new RecordId('chats', chatId));
    if (!row) return undefined;
    const raw = row as Record<string, unknown>;
    raw.id = stripPrefix(raw.id);
    return toChat(raw);
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
      `SELECT count() AS count FROM messages WHERE chat_id = $chatId AND role = $role AND deleted_at IS NONE GROUP ALL`,
      { chatId: new RecordId('chats', chatId), role: 'user' },
    );
    return (rows[0]?.count as number) ?? 0;
  }

  async getUserChatCount(userId: string): Promise<number> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT count() AS count FROM chats WHERE user_id = $userId AND deleted_at IS NONE GROUP ALL`,
      { userId: new RecordId('users', userId) },
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
      `UPDATE type::record('chats', $chatId) SET off_topic_count += 1 RETURN off_topic_count`,
      {
        chatId,
      },
    );
    return rows.length > 0 ? ((rows[0]?.off_topic_count as number) ?? 1) : 1;
  }

  async clearChatMessages(chatId: string): Promise<void> {
    const db = this.db();
    await queryDb(db, `DELETE messages WHERE chat_id = $chatId`, { chatId: new RecordId('chats', chatId) });
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
      `SELECT count() AS count FROM messages WHERE chat_id = $chatId AND role = $role AND deleted_at IS NONE GROUP ALL`,
      { chatId: new RecordId('chats', chatId), role: 'user' },
    );
    const messageCount = (countRows[0]?.count as number) ?? 0;

    const lastRows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT MAX(created_at) AS lastAt FROM messages WHERE chat_id = $chatId GROUP ALL`,
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
    await db.create(new RecordId('messages', id)).content({
      user_id: new RecordId('users', params.userId),
      chat_id: params.chatId != null ? new RecordId('chats', params.chatId) : null,
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
    });
    log.debug`[MessageRepo.addMessage] db.create(messages) completed, id=${id}`;

    return id;
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
      `SELECT *, meta::id(id) AS id, (SELECT VALUE meta::id(out) FROM ->used_model LIMIT 1)[0] AS model_id FROM messages WHERE chat_id = $chatId ORDER BY created_at ASC LIMIT $limit START $offset`,
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
      `SELECT *, meta::id(id) AS id, (SELECT VALUE meta::id(out) FROM ->used_model LIMIT 1)[0] AS model_id FROM messages WHERE user_id = $userId ORDER BY created_at ASC LIMIT $limit START $offset`,
      { userId: new RecordId('users', userId), limit: l, offset: o },
    );
    return rows.map(toStoredMessage);
  }

  async getLastMessagesCount(chatId: string, count: number): Promise<StoredMessage[]> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT *, meta::id(id) AS id, (SELECT VALUE meta::id(out) FROM ->used_model LIMIT 1)[0] AS model_id FROM messages WHERE chat_id = $chatId ORDER BY created_at DESC LIMIT $count`,
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
    await db.create(new RecordId('chat_events', eventId)).content({
      chat_id: new RecordId('chats', chatId),
      type,
      data: JSON.stringify(data),
      created_at: new Date(),
    });
    log.debug`[EventsRepo.insertChatEvent] db.create completed, id=${eventId}`;
    return eventId;
  }

  async getChatEventsSince(chatId: string, lastEventId: number): Promise<ChatEvent[]> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT meta::id(id) AS id, meta::id(chat_id) AS chatId, type, data, created_at AS createdAt
       FROM chat_events
        WHERE meta::id(chat_id) = $chatId AND <int> meta::id(id) > $lastEventId
       ORDER BY id ASC`,
      { chatId, lastEventId },
    );
    return rows.map((r) => ({
      id: Number(r.id),
      chatId: String(r.chatId),
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
    const db = this.db();
    const reactionId = `${messageId}_${userId}`;
    await db.update(new RecordId('reactions', reactionId)).merge({
      message_id: new RecordId('messages', messageId),
      user_id: new RecordId('users', userId),
      reaction_type: reactionType,
      reason: reason ?? '',
      created_at: new Date(),
    });
  }

  async getReaction(messageId: string, userId: string): Promise<ReactionResult | null> {
    const db = this.db();
    const rows = await db
      .select(new Table('reactions'))
      .where(and(eq('message_id', messageId), eq('user_id', userId)))
      .limit(1);
    if (rows.length === 0) return null;
    const r = rows[0] as Record<string, unknown>;
    return {
      type: r.reaction_type as 'up' | 'down' | 'heart',
      reason: String(r.reason ?? ''),
    };
  }

  async deleteReaction(messageId: string, userId: string): Promise<void> {
    const db = this.db();
    await queryDb(db, `DELETE reactions WHERE message_id = $messageId AND user_id = $userId`, {
      messageId: new RecordId('messages', messageId),
      userId: new RecordId('users', userId),
    });
  }
}

// ===========================================================================
// ToolCallRepo
// ===========================================================================

class ToolCallRepo implements IToolCallRepo {
  constructor(private db: () => Surreal) {}

  async getToolCallsByMessageId(messageId: string): Promise<ToolCallRecord[]> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT meta::id(id) AS id, name, server_id AS serverId, started_at AS startedAt, finished_at AS finishedAt
        FROM tool_calls WHERE message_id = $messageId ORDER BY started_at ASC`,
      { messageId: new RecordId('messages', messageId) },
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
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT meta::id(id) AS id, meta::id(message_id) AS messageId, name, server_id AS serverId, started_at AS startedAt, finished_at AS finishedAt
        FROM tool_calls WHERE message_id INSIDE $messageIds ORDER BY started_at ASC`,
      { messageIds },
    );
    const map: Record<string, ToolCallRecord[]> = {};
    for (const r of rows) {
      const msgId = String(r.messageId);
      if (!map[msgId]) map[msgId] = [];
      const startedAt = String(r.startedAt);
      const finishedAt = r.finishedAt ? String(r.finishedAt) : null;
      map[msgId].push({
        id: String(r.id),
        name: String(r.name),
        serverId: String(r.serverId),
        startedAt,
        finishedAt,
        durationMs: finishedAt ? Math.round(new Date(finishedAt).getTime() - new Date(startedAt).getTime()) : null,
      });
    }
    return map;
  }

  async insertToolCall(id: string, msgId: string, name: string, serverId: string, toolInput: string): Promise<void> {
    const db = this.db();
    await db.create(new RecordId('tool_calls', id)).content({
      message_id: new RecordId('messages', msgId),
      name,
      server_id: serverId,
      tool_input: toolInput,
      started_at: new Date().toISOString(),
    });
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
      await db.create(new Table('page_posts')).content(data);
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
      await db.create(new Table('page_experience')).content(data);
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
        await db.update(new RecordId('page_posts', stripPrefix(existing[0].id))).merge({ part_of_series: null });
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

  async getPosts(slug?: string): Promise<Post[]> {
    const db = this.db();
    let query = db.select<Record<string, unknown>>(new Table('page_posts'));
    if (slug) {
      query = query.where(eq('slug', slug));
    }
    const rows = (await query) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(stripPrefix(r.id)),
      slug: String(r.slug),
      content: String(r.content),
      toc: parseToc(r.toc),
      title: String(r.title ?? ''),
      description: String(r.description ?? ''),
      date: r.date ? String(r.date) : null,
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
    await db.create(new Table('leads')).content({
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
    await db.create(new Table('contact_intents')).content({
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
    const existingRows = await db.select(new Table('user_agents')).where(eq('ua', trimmed)).limit(1);
    if (existingRows.length > 0) {
      // Update ip if provided and currently null
      if (ip) {
        await queryDb(db, `UPDATE type::record('user_agents', $agentId) SET ip = $ip WHERE ip IS NONE`, {
          agentId: stripPrefix(existingRows[0].id),
          ip,
        });
      }
      return Number(stripPrefix(existingRows[0].id));
    }

    // Create new user agent
    // Derive deviceType from ua
    const deviceType = uaParser(trimmed);
    const agentId = Date.now() * 1000 + (this.agentSeq++ % 1000);
    const result = await db.create(new RecordId('user_agents', agentId)).content({
      ua: trimmed,
      device_type: deviceType,
      ip: ip ?? null,
      created_at: new Date(),
    });
    return Number(result.id);
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
       FROM type::record('llm_cache', $cacheId)`,
      { cacheId: cacheId.toString() },
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
    await db.create(new Table('llm_cache')).content({
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

class RateLimitRepo implements IRateLimitRepo {
  private MAX_REQUESTS = 10;
  private WINDOW_MS = 60_000;

  constructor(private db: () => Surreal) {}

  async getRateLimit(ip: string): Promise<RateLimitResult> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT count() AS count, math::min(timestamp) AS oldest
       FROM rate_limits
       WHERE ip = $ip AND timestamp > time::now() - 60s
       GROUP ALL`,
      { ip },
    );
    const count = Number(rows[0]?.count ?? 0);
    const oldest = rows[0]?.oldest ? new Date(String(rows[0].oldest)).getTime() : Date.now();
    const resetAt = oldest + this.WINDOW_MS;

    return {
      allowed: count < this.MAX_REQUESTS,
      remaining: Math.max(0, this.MAX_REQUESTS - count),
      resetAt,
    };
  }

  async incrementRateLimit(ip: string): Promise<void> {
    const db = this.db();
    await db.create(new Table('rate_limits')).content({ ip, timestamp: new Date() });
  }

  async resetRateLimit(ip: string): Promise<void> {
    const db = this.db();
    await queryDb(db, `DELETE rate_limits WHERE ip = $ip`, { ip });
  }

  async cleanupExpired(): Promise<void> {
    const db = this.db();
    await queryDb(db, `DELETE rate_limits WHERE timestamp < time::now() - 60s`);
  }
}

class VectorRepo implements IVectorRepo {
  constructor(private db: () => Surreal) {}

  async upsertChunks(rows: ChunkRecord[]): Promise<void> {
    const db = this.db();
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
        type: r.type,
      };
      if (existing.length > 0) {
        await db.update(new RecordId('chunks', String(existing[0].id))).merge(data);
      } else {
        await db.create(new Table('chunks')).content(data);
      }
    }
  }

  async deleteChunksBySlug(slug: string): Promise<void> {
    const db = this.db();
    const prefix = `${slug}_chunk_`;
    await queryDb(db, `DELETE chunks WHERE string::starts_with(chunk_id, $prefix)`, { prefix });
  }

  async searchChunks(embedding: number[], limit = 10, typeFilter?: 'post' | 'experience'): Promise<SearchResult[]> {
    const db = this.db();
    const rows = await queryDb<Array<Record<string, unknown>>>(
      db,
      `SELECT *, (1 - vector::similarity::cosine(embedding, $embedding)) AS score
       FROM chunks
       WHERE ($typeFilter IS NULL OR type = $typeFilter)
       ORDER BY score ASC
       LIMIT $limit`,
      { embedding, typeFilter: typeFilter ?? null, limit },
    );
    return rows.map((r) => ({
      chunk: {
        id: String(r.chunkId || r.id),
        text: String(r.text),
        title: String(r.title),
        date: r.date ? String(r.date) : null,
        tags: Array.isArray(r.tags) ? r.tags : [],
        section: String(r.section),
        slug: String(r.slug || ''),
        embedding: [],
        type: String(r.type) as 'post' | 'experience',
      },
      score: Number(r.score),
    }));
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
    const [result] = await db.create(new Table('models')).content({
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

class FeatureTourRepo implements IFeatureTourRepo {
  constructor(private db: () => Surreal) {}

  async getDismissedFeatureTours(userId: string): Promise<string[]> {
    const db = this.db();
    const rows = await db.select(new Table('feature_tours')).where(eq('user_id', new RecordId('users', userId)));
    return rows.map((r) => String((r as Record<string, unknown>).feature_id));
  }

  async dismissFeatureTours(userId: string, featureIds: string[]): Promise<void> {
    const db = this.db();
    for (const featureId of featureIds) {
      await queryDb(
        db,
        `INSERT INTO feature_tours (user_id, feature_id) VALUES ($userId, $featureId) ON DUPLICATE KEY UPDATE dismissed_at = time::now()`,
        { userId: new RecordId('users', userId), featureId },
      );
    }
  }

  async resetFeatureTours(userId: string): Promise<void> {
    const db = this.db();
    await queryDb(db, `DELETE feature_tours WHERE user_id = $userId`, { userId: new RecordId('users', userId) });
  }
}

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
    await queryDb(db, `DELETE centroids:${key}`);
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
    this.rateLimit = new RateLimitRepo(this.db);
    this.vector = new VectorRepo(this.db);
    this.models = new ModelRepo(this.db);
    this.featureTours = new FeatureTourRepo(this.db);
    this.centroids = new CentroidRepo(this.db);
  }

  async init(): Promise<void> {
    await initSurreal();
  }

  async healthCheck(): Promise<boolean> {
    try {
      const db = this.db();
      await queryDb(db, 'SELECT 1 FROM users LIMIT 1');
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
    await queryDb(db, 'BEGIN TRANSACTION');
    try {
      const result = await fn();
      await queryDb(db, 'COMMIT TRANSACTION');
      return result;
    } catch (err) {
      await queryDb(db, 'CANCEL TRANSACTION');
      throw err;
    }
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
  readonly rateLimit: IRateLimitRepo;
  readonly vector: IVectorRepo;
  readonly models: IModelRepo;
  readonly featureTours: IFeatureTourRepo;
  readonly centroids: ICentroidRepo;
}
