import type Database from 'better-sqlite3';
import type { SearchResult, StoredMessage, Chat, ToolCallRecord, AddMessageParams } from './db';
import * as db from './db';

/* ------------------------------------------------------------------ */
/*  Domain types — plain data shapes returned by query methods        */
/* ------------------------------------------------------------------ */

export interface ChatEventRow {
  id: number;
  chatId: string;
  type: string;
  data: unknown;
  createdAt: string;
}

export interface PostResult {
  id: number;
  slug: string;
  content: string;
  toc: { id: string; text: string; level: number }[];
  title: string;
  description: string;
  date: string | null;
  tags: string[];
  status: string;
  excerpt: string;
  headerImage: string | null;
  featured: boolean;
  position: number | null;
  partOfSeries: number | null;
  workflowFiles:
    | { label: string; file: string; placeholders: { key: string; label: string; hint?: string }[] }[]
    | null;
}

export interface ExperienceResult {
  slug: string;
  content: string;
  company: string;
  role: string;
  startDate: string | null;
  endDate: string | null;
  duration: string;
  skills: string[];
  description: string;
  jobRole: string;
  published: boolean;
}

/* ------------------------------------------------------------------ */
/*  DatabaseService interface — complete async surface                */
/* ------------------------------------------------------------------ */

export interface DatabaseService {
  // Connection -------------------------------------------------------
  getDb(): Database.Database | undefined;
  closeDb(): void;

  // Chats ------------------------------------------------------------
  createChat(userId: string, title?: string, userAgentId?: number): Promise<string>;
  getChats(userId: string): Promise<Chat[]>;
  getChat(chatId: string): Promise<Chat | undefined>;
  deleteChat(chatId: string): Promise<void>;
  renameChat(chatId: string, title: string): Promise<void>;
  getChatMessageCount(chatId: string): Promise<number>;
  getUserChatCount(userId: string): Promise<number>;

  // Messages ---------------------------------------------------------
  addMessage(params: AddMessageParams): Promise<string>;
  getMessages(chatId: string, limit?: number, offset?: number): Promise<StoredMessage[]>;
  getMessagesByUserId(userId: string, limit?: number, offset?: number): Promise<StoredMessage[]>;
  clearChatMessages(chatId: string): Promise<void>;
  softDeleteMessage(messageId: string): Promise<void>;

  // SC-006 convenience wrappers
  getConversation(chatId: string, limit?: number, offset?: number): Promise<StoredMessage[]>;
  getMessage(messageId: string): Promise<StoredMessage | undefined>;
  createMessage(params: AddMessageParams): Promise<string>;
  deleteConversation(chatId: string): Promise<void>;
  updateMessage(
    messageId: string,
    updates: Partial<
      Pick<StoredMessage, 'content' | 'reasoning' | 'error' | 'sources' | 'tokensIn' | 'tokensOut' | 'durationMs'>
    >,
  ): Promise<void>;
  saveMessages(chatId: string, messages: StoredMessage[]): Promise<void>;

  // Tool Calls -------------------------------------------------------
  getToolCallsByMessageId(messageId: string): Promise<ToolCallRecord[]>;
  getToolCallsForMessages(messageIds: string[]): Promise<Map<string, ToolCallRecord[]>>;

  // Search -----------------------------------------------------------
  searchChunks(embedding: number[], limit?: number, typeFilter?: 'post' | 'experience'): Promise<SearchResult[]>;
  getPosts(slug?: string): Promise<PostResult[]>;
  getExperience(slug?: string): Promise<ExperienceResult[]>;

  // Reactions --------------------------------------------------------
  setReaction(messageId: string, userId: string, reactionType: 'up' | 'down' | 'heart', reason?: string): Promise<void>;
  getReaction(messageId: string, userId: string): Promise<{ type: 'up' | 'down' | 'heart'; reason: string } | null>;
  deleteReaction(messageId: string, userId: string): Promise<void>;

  // Events (SSE reconnect) ------------------------------------------
  insertChatEvent(chatId: string, type: string, data: unknown): Promise<number>;
  getChatEventsSince(chatId: string, lastEventId: number): Promise<ChatEventRow[]>;

  // User -------------------------------------------------------------
  getOrCreateUserAgent(ua: string, ip?: string): Promise<number>;
  classifyDeviceType(ua: string): 'bot' | 'mobile' | 'tablet' | 'desktop'; // SYNC

  // Feature Tours (SYNC) ---------------------------------------------
  getDismissedFeatureTours(userId: string): string[];
  dismissFeatureTours(userId: string, featureIds: string[]): void;

  // Leads ------------------------------------------------------------
  insertLead(
    userId: string,
    name: string,
    email: string,
    companyName: string,
    role: string,
    message: string,
    ipAddress: string,
  ): Promise<void>;
  updateUserContact(userId: string, name: string, email: string): Promise<void>;
  insertContactIntent(userId: string, chatId: string, text: string): Promise<void>;

  // Locks ------------------------------------------------------------
  lockChat(chatId: string): Promise<void>;
  isChatLocked(chatId: string): Promise<boolean>;
  getOffTopicCount(chatId: string): Promise<number>;
  incrementOffTopicCount(chatId: string): Promise<void>;

  // Models -----------------------------------------------------------
  ensureModel(provider: string, modelName: string, actualModelName: string, maxTokens: number): Promise<number>;
}

/* ------------------------------------------------------------------ */
/*  SqliteDatabaseService — wraps every function from ./db             */
/* ------------------------------------------------------------------ */

/** Parse a raw DB row into a typed StoredMessage (mirrors db.ts helper). */
function parseStoredMessage(row: Record<string, unknown>): StoredMessage {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    chatId: row.chat_id == null ? null : String(row.chat_id),
    role: parseRole(row.role),
    content: String(row.content),
    sources: String(row.sources),
    reasoning: String(row.reasoning),
    error: row.error ? String(row.error) : undefined,
    irrecoverable: Boolean(row.irrecoverable ?? false),
    createdAt: String(row.created_at),
    modelId: Number(row.model_id ?? 0),
    tokensIn: Number(row.tokens_in ?? 0),
    tokensOut: Number(row.tokens_out ?? 0),
    durationMs: Number(row.duration_ms ?? 0),
    maxTokens: Number(row.max_tokens ?? 0),
    queryType: row.query_type ? String(row.query_type) : undefined,
    deletedAt: row.deleted_at ? String(row.deleted_at) : undefined,
    fromCache: Number(row.from_cache ?? 0) === 1 ? true : undefined,
  };
}

function parseRole(value: unknown): 'user' | 'assistant' | 'system' {
  const s = String(value);
  if (s === 'user' || s === 'assistant' || s === 'system') return s;
  return 'system';
}

export class SqliteDatabaseService implements DatabaseService {
  // Connection -------------------------------------------------------
  getDb(): Database.Database {
    return db.getDb();
  }

  closeDb(): void {
    db.closeDb();
  }

  // Chats ------------------------------------------------------------
  async createChat(userId: string, title?: string, userAgentId?: number): Promise<string> {
    return db.createChat(userId, title, userAgentId);
  }

  async getChats(userId: string): Promise<Chat[]> {
    return db.getChats(userId);
  }

  async getChat(chatId: string): Promise<Chat | undefined> {
    return db.getChat(chatId);
  }

  async deleteChat(chatId: string): Promise<void> {
    db.deleteChat(chatId);
  }

  async renameChat(chatId: string, title: string): Promise<void> {
    db.renameChat(chatId, title);
  }

  async getChatMessageCount(chatId: string): Promise<number> {
    return db.getChatMessageCount(chatId);
  }

  async getUserChatCount(userId: string): Promise<number> {
    return db.getUserChatCount(userId);
  }

  // Messages ---------------------------------------------------------
  async addMessage(params: AddMessageParams): Promise<string> {
    return db.addMessage(params);
  }

  async getMessages(chatId: string, limit?: number, offset?: number): Promise<StoredMessage[]> {
    return db.getMessages(chatId, limit, offset);
  }

  async getMessagesByUserId(userId: string, limit?: number, offset?: number): Promise<StoredMessage[]> {
    return db.getMessagesByUserId(userId, limit, offset);
  }

  async clearChatMessages(chatId: string): Promise<void> {
    db.clearChatMessages(chatId);
  }

  async softDeleteMessage(messageId: string): Promise<void> {
    db.softDeleteMessage(messageId);
  }

  // SC-006 convenience wrappers
  async getConversation(chatId: string, limit?: number, offset?: number): Promise<StoredMessage[]> {
    return db.getMessages(chatId, limit, offset);
  }

  async getMessage(messageId: string): Promise<StoredMessage | undefined> {
    const row = db
      .getDb()
      .prepare(
        'SELECT id, user_id, chat_id, role, content, sources, reasoning, error, irrecoverable, created_at, model_id, tokens_in, tokens_out, duration_ms, max_tokens, deleted_at, from_cache FROM messages WHERE id = ?',
      )
      .get(messageId) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return parseStoredMessage(row);
  }

  async createMessage(params: AddMessageParams): Promise<string> {
    return db.addMessage(params);
  }

  async deleteConversation(chatId: string): Promise<void> {
    db.deleteChat(chatId);
  }

  async updateMessage(
    messageId: string,
    updates: Partial<
      Pick<
        StoredMessage,
        | 'content'
        | 'reasoning'
        | 'error'
        | 'sources'
        | 'tokensIn'
        | 'tokensOut'
        | 'durationMs'
        | 'modelId'
        | 'maxTokens'
      >
    >,
  ): Promise<void> {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (updates.content !== undefined) {
      setClauses.push('content = ?');
      params.push(updates.content);
    }
    if (updates.reasoning !== undefined) {
      setClauses.push('reasoning = ?');
      params.push(updates.reasoning);
    }
    if (updates.error !== undefined) {
      setClauses.push('error = ?');
      params.push(updates.error);
    }
    if (updates.sources !== undefined) {
      setClauses.push('sources = ?');
      params.push(updates.sources);
    }
    if (updates.tokensIn !== undefined) {
      setClauses.push('tokens_in = ?');
      params.push(updates.tokensIn);
    }
    if (updates.tokensOut !== undefined) {
      setClauses.push('tokens_out = ?');
      params.push(updates.tokensOut);
    }
    if (updates.durationMs !== undefined) {
      setClauses.push('duration_ms = ?');
      params.push(updates.durationMs);
    }
    if (updates.modelId !== undefined) {
      setClauses.push('model_id = ?');
      params.push(updates.modelId);
    }
    if (updates.maxTokens !== undefined) {
      setClauses.push('max_tokens = ?');
      params.push(updates.maxTokens);
    }

    if (setClauses.length === 0) return;

    params.push(messageId);
    db.getDb()
      .prepare(`UPDATE messages SET ${setClauses.join(', ')} WHERE id = ?`)
      .run(...params);
  }

  async saveMessages(_chatId: string, messages: StoredMessage[]): Promise<void> {
    const insert = db.getDb().transaction((msgs: StoredMessage[]) => {
      for (const msg of msgs) {
        db.addMessage({
          msgId: msg.id,
          userId: msg.userId,
          chatId: msg.chatId ?? undefined,
          role: msg.role,
          content: msg.content,
          sources: msg.sources,
          reasoning: msg.reasoning,
          error: msg.error,
          irrecoverable: msg.irrecoverable,
          modelId: msg.modelId,
          tokensIn: msg.tokensIn,
          tokensOut: msg.tokensOut,
          durationMs: msg.durationMs,
          maxTokens: msg.maxTokens,
          queryType: msg.queryType,
          userAgentId: msg.userAgentId,
          fromCache: msg.fromCache,
        });
      }
    });
    insert(messages);
  }

  // Tool Calls -------------------------------------------------------
  async getToolCallsByMessageId(messageId: string): Promise<ToolCallRecord[]> {
    return db.getToolCallsByMessageId(messageId);
  }

  async getToolCallsForMessages(messageIds: string[]): Promise<Map<string, ToolCallRecord[]>> {
    const records = db.getToolCallsForMessages(messageIds);
    return new Map(Object.entries(records));
  }

  // Search -----------------------------------------------------------
  async searchChunks(embedding: number[], limit?: number, typeFilter?: 'post' | 'experience'): Promise<SearchResult[]> {
    return db.searchChunks(embedding, limit, typeFilter);
  }

  async getPosts(slug?: string): Promise<PostResult[]> {
    return db.getPosts(slug) as PostResult[];
  }

  async getExperience(slug?: string): Promise<ExperienceResult[]> {
    return db.getExperience(slug) as ExperienceResult[];
  }

  // Reactions --------------------------------------------------------
  async setReaction(
    messageId: string,
    userId: string,
    reactionType: 'up' | 'down' | 'heart',
    reason?: string,
  ): Promise<void> {
    db.setReaction(messageId, userId, reactionType, reason);
  }

  async getReaction(
    messageId: string,
    userId: string,
  ): Promise<{ type: 'up' | 'down' | 'heart'; reason: string } | null> {
    return db.getReaction(messageId, userId);
  }

  async deleteReaction(messageId: string, userId: string): Promise<void> {
    db.deleteReaction(messageId, userId);
  }

  // Events -----------------------------------------------------------
  async insertChatEvent(chatId: string, type: string, data: unknown): Promise<number> {
    return db.insertChatEvent(chatId, type, data);
  }

  async getChatEventsSince(chatId: string, lastEventId: number): Promise<ChatEventRow[]> {
    return db.getChatEventsSince(chatId, lastEventId);
  }

  // User -------------------------------------------------------------
  async getOrCreateUserAgent(ua: string, ip?: string): Promise<number> {
    return db.getOrCreateUserAgent(ua, ip);
  }

  classifyDeviceType(ua: string): 'bot' | 'mobile' | 'tablet' | 'desktop' {
    return db.classifyDeviceType(ua);
  }

  // Feature Tours (SYNC) ---------------------------------------------
  getDismissedFeatureTours(userId: string): string[] {
    return db.getDismissedFeatureTours(userId);
  }

  dismissFeatureTours(userId: string, featureIds: string[]): void {
    db.dismissFeatureTours(userId, featureIds);
  }

  // Leads ------------------------------------------------------------
  async insertLead(
    userId: string,
    name: string,
    email: string,
    companyName: string,
    role: string,
    message: string,
    ipAddress: string,
  ): Promise<void> {
    db.insertLead(userId, name, email, companyName, role, message, ipAddress);
  }

  async updateUserContact(userId: string, name: string, email: string): Promise<void> {
    db.updateUserContact(userId, name, email);
  }

  async insertContactIntent(userId: string, chatId: string, text: string): Promise<void> {
    db.insertContactIntent(userId, chatId, text);
  }

  // Locks ------------------------------------------------------------
  async lockChat(chatId: string): Promise<void> {
    db.lockChat(chatId);
  }

  async isChatLocked(chatId: string): Promise<boolean> {
    return db.isChatLocked(chatId);
  }

  async getOffTopicCount(chatId: string): Promise<number> {
    return db.getOffTopicCount(chatId);
  }

  async incrementOffTopicCount(chatId: string): Promise<void> {
    db.incrementOffTopicCount(chatId);
  }

  // Models -----------------------------------------------------------
  async ensureModel(provider: string, modelName: string, actualModelName: string, maxTokens: number): Promise<number> {
    return db.ensureModel(provider, modelName, actualModelName, maxTokens);
  }
}

/* ------------------------------------------------------------------ */
/*  Module-level dependency injection                                  */
/* ------------------------------------------------------------------ */

let _instance: DatabaseService | undefined;

export function getDbService(): DatabaseService {
  if (!_instance) {
    _instance = new SqliteDatabaseService();
  }
  return _instance!;
}

export function setDbService(service: DatabaseService): void {
  _instance = service;
}
