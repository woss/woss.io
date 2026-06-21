import Database from 'better-sqlite3';
import { Index } from 'usearch';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { SEARCH_INDEX_CONFIG } from '../search-config.js';
import { CAT, createLogger } from './logger.js';
import { initDatabase, DATA_DIR, DB_PATH, DB_WAL_PATH, DB_SHM_PATH, VECTOR_INDEX_PATH } from './schema.js';
import { randomUUID } from '../utils/random-uuid.js';
import { getCurrentTraceContext } from './trace-context.js';
import { isbot } from 'isbot';
import { UAParser } from 'ua-parser-js';

/** Typed wrapper around better-sqlite3 .all() — avoids scattering `as Record<string, unknown>[]` everywhere. */
function queryRows<T>(stmt: Database.Statement, ...params: unknown[]): T[] {
  return stmt.all(...params) as T[];
}

/** Typed wrapper around better-sqlite3 .get() — avoids scattering `as Record<string, unknown> | undefined` everywhere. */
function queryRow<T>(stmt: Database.Statement, ...params: unknown[]): T | undefined {
  return stmt.get(...params) as T | undefined;
}

function validateRowType(value: unknown): 'post' | 'experience' {
  if (value === 'post' || value === 'experience') return value;
  return 'post';
}

function parseRole(value: unknown): 'user' | 'assistant' | 'system' {
  const s = String(value);
  if (s === 'user' || s === 'assistant' || s === 'system') return s;
  return 'system';
}

function parseReactionType(value: unknown): 'up' | 'down' | 'heart' {
  const s = String(value);
  if (s === 'up' || s === 'down' || s === 'heart') return s;
  return 'up';
}

const log = createLogger(CAT.db);

/** A single chunk loaded from the database with parsed fields. */
interface StoredChunk {
  id: string;
  text: string;
  title: string;
  date: string | null;
  tags: string[];
  section: string;
  slug: string;
  embedding: number[];
  type: 'post' | 'experience';
}

/** Result of a vector similarity search. */
interface SearchResult {
  chunk: StoredChunk;
  /** Cosine distance from query embedding (0 = identical). */
  score: number;
}

/** A single message from the chat history. */
interface StoredMessage {
  id: string;
  userId: string;
  chatId: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources: string; // JSON array of {title, score}
  reasoning: string;
  error?: string;
  irrecoverable?: boolean;
  userAgentId?: number;
  createdAt: string;
  modelId: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  maxTokens: number;
  queryType?: string;
  deletedAt?: string;
  fromCache?: boolean;
}

/** A chat conversation. */
interface Chat {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  messageCount: number;
  deletedAt?: string;
  locked?: boolean;
  userAgentId?: number;
  traceId?: string;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  serverId: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

let _db: Database.Database | null = null;
let _index: Index | null = null;

/**
 * Return cached database connection or create one.
 */
function getDb(): Database.Database {
  if (_db) return _db;

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  // Delete stale WAL/SHM journal files when DB is missing — prevents SQLITE_IOERR_SHORT_READ
  // on new database creation after a hard reset that left journal files behind.
  if (!existsSync(DB_PATH)) {
    try {
      if (existsSync(DB_WAL_PATH)) unlinkSync(DB_WAL_PATH);
    } catch (e) {
      log.warn`Failed to clean up WAL file: ${e}`;
    }
    try {
      if (existsSync(DB_SHM_PATH)) unlinkSync(DB_SHM_PATH);
    } catch (e) {
      log.warn`Failed to clean up SHM file: ${e}`;
    }
  }

  const db = new Database(DB_PATH);

  db.exec('PRAGMA journal_mode = TRUNCATE');
  db.exec('PRAGMA foreign_keys = ON');

  initDatabase(db);

  // Re-read the DB ref (initDatabase runs schema/migrations)
  _db = db;
  return db;
}

/**
 * Get or create the USearch vector index.
 */
function getIndex(): Index {
  if (_index) return _index;

  const idx = new Index(SEARCH_INDEX_CONFIG);

  if (existsSync(VECTOR_INDEX_PATH)) {
    idx.load(VECTOR_INDEX_PATH);
  }

  _index = idx;
  return idx;
}

/**
 * Search chunks by cosine similarity to the given embedding.
 * Uses USearch for KNN search, then looks up metadata from SQLite.
 */
function searchChunks(embedding: number[], limit: number = 10, typeFilter?: 'post' | 'experience'): SearchResult[] {
  const db = getDb();
  const idx = getIndex();

  if (idx.size() === 0) return [];

  const queryVector = new Float32Array(embedding);

  // Search more results to have room for type filtering
  const searchLimit = typeFilter ? limit * 5 : limit;
  const matches = idx.search(queryVector, searchLimit, 0);

  const keys = matches.keys;
  const distances = matches.distances;

  // Batch-fetch all chunks in one query instead of N individual lookups
  const rowIds = Array.from(keys, Number);
  const placeholders = rowIds.map(() => '?').join(',');
  const rawRows = queryRows<Record<string, unknown>>(
    db.prepare(`SELECT * FROM chunks WHERE id IN (${placeholders})`),
    ...rowIds,
  );
  const rowMap = new Map<number, Record<string, unknown>>(rawRows.map((row) => [Number(row.id), row]));

  const results: SearchResult[] = [];
  for (let i = 0; i < keys.length; i++) {
    const rowId = Number(keys[i]);
    const distance = distances[i];
    const row = rowMap.get(rowId);

    if (!row) continue;

    const parsed = parseSearchRow(row, distance);

    // Apply type filter if specified
    if (typeFilter && parsed.chunk.type !== typeFilter) continue;

    results.push(parsed);

    // Stop once we have enough filtered results
    if (results.length >= limit) break;
  }

  return results;
}

/** Parse a raw DB row into a typed SearchResult. */
function parseSearchRow(row: Record<string, unknown>, distance: number): SearchResult {
  const tagsRaw = typeof row.tags === 'string' ? row.tags : '[]';
  const embeddingRaw = typeof row.embedding === 'string' ? row.embedding : '[]';

  let tags: string[];
  try {
    const parsed = JSON.parse(tagsRaw);
    tags = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (e) {
    log.warn`Failed to parse tags JSON: ${e}`;
    tags = [];
  }

  let embedding: number[];
  try {
    const parsed = JSON.parse(embeddingRaw);
    embedding = Array.isArray(parsed) ? parsed.map(Number) : [];
  } catch (e) {
    log.warn`Failed to parse embedding JSON: ${e}`;
    embedding = [];
  }

  const chunkId = String(row.chunk_id ?? '');
  const slug = chunkId.includes('_chunk_') ? chunkId.split('_chunk_')[0] : '';

  return {
    chunk: {
      id: String(row.id ?? ''),
      text: String(row.text ?? ''),
      title: String(row.title ?? ''),
      date: row.date == null ? null : String(row.date),
      tags,
      section: String(row.section ?? ''),
      slug,
      embedding,
      type: validateRowType(row.type),
    },
    score: distance,
  };
}

/** Close the database connection gracefully. */
function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
  _index = null;
}

/**
 * Ensure a user exists in the users table. Inserts if absent;
 * updates email/name only when provided and non-empty.
 */
function ensureUser(userId: string, email?: string, name?: string): void {
  const db = getDb();

  db.prepare('INSERT OR IGNORE INTO users (id, email, name) VALUES (?, ?, ?)').run(userId, email ?? null, name ?? null);

  if (email !== undefined && email.length > 0) {
    db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, userId);
  }

  if (name !== undefined && name.length > 0) {
    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, userId);
  }
}

/** @group Feature Tour Functions */

/**
 * Get all feature tours that have been dismissed for a user.
 * Returns an array of feature_id strings.
 */
export function getDismissedFeatureTours(userId: string): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT feature_id FROM feature_tours WHERE user_id = ?').all(userId) as {
    feature_id: string;
  }[];
  return rows.map((r) => r.feature_id);
}

/**
 * Dismiss one or more feature tours for a user.
 * Inserts records — no-op if already dismissed (PRIMARY KEY constraint).
 */
export function dismissFeatureTours(userId: string, featureIds: string[]): void {
  const db = getDb();
  const stmt = db.prepare('INSERT OR IGNORE INTO feature_tours (user_id, feature_id) VALUES (?, ?)');
  for (const featureId of featureIds) {
    stmt.run(userId, featureId);
  }
}

/** @group Chat Functions */

/**
 * Ensure a chat exists. Creates the chat row if absent.
 * Parallel to ensureUser — called from addMessage to guarantee
 * the FK target exists before inserting a message.
 */
function ensureChat(chatId: string, userId: string, title?: string): void {
  // Only allow UUID-format chat IDs
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatId)) return;
  const db = getDb();
  ensureUser(userId);
  db.prepare('INSERT OR IGNORE INTO chats (id, user_id, title) VALUES (?, ?, ?)').run(
    chatId,
    userId,
    title?.slice(0, 100) ?? 'New Chat',
  );
}

/**
 * Classify a user-agent string into a device type category.
 * Bot detection via `isbot` library, device form-factor via ua-parser-js.
 */
export function classifyDeviceType(ua: string): 'bot' | 'mobile' | 'tablet' | 'desktop' {
  if (!ua) return 'desktop';
  if (isbot(ua)) return 'bot';
  const device = new UAParser(ua).getDevice();
  if (device.type === 'tablet') return 'tablet';
  if (device.type === 'mobile') return 'mobile';
  return 'desktop';
}

/**
 * Get or create a user agent record.
 * Returns the user_agent id.
 */
export function getOrCreateUserAgent(ua: string, ip?: string): number {
  const db = getDb();
  const trimmed = ua.slice(0, 500);
  const deviceType = classifyDeviceType(trimmed);
  db.prepare('INSERT OR IGNORE INTO user_agents (ua, device_type) VALUES (?, ?)').run(trimmed, deviceType);
  db.prepare('UPDATE user_agents SET device_type = ? WHERE ua = ? AND device_type IS NULL').run(deviceType, trimmed);
  if (ip) {
    db.prepare('UPDATE user_agents SET ip = ? WHERE ua = ? AND ip IS NULL').run(ip, trimmed);
  }
  const row = db.prepare('SELECT id FROM user_agents WHERE ua = ?').get(trimmed) as { id: number } | undefined;
  return row?.id ?? 0;
}

/**
 * Create a new chat for a user.
 * Returns the new chat ID.
 */
function createChat(userId: string, title?: string, userAgentId?: number): string {
  const db = getDb();
  ensureUser(userId);

  const chatId = randomUUID();
  const chatTitle = title?.slice(0, 100) || 'New Chat';
  const ctx = getCurrentTraceContext();

  db.prepare('INSERT INTO chats (id, user_id, title, user_agent_id, trace_id) VALUES (?, ?, ?, ?, ?)').run(
    chatId,
    userId,
    chatTitle,
    userAgentId ?? null,
    ctx?.traceId ?? null,
  );

  return chatId;
}

/**
 * Get all chats for a user, ordered by created_at DESC.
 */
function getChats(userId: string): Chat[] {
  const db = getDb();
  log.debug`Loading chats for user ${userId}`;
  const rows = queryRows<Record<string, unknown>>(
    db.prepare(
      `SELECT c.id, c.user_id, c.title, c.created_at, c.locked, c.user_agent_id, c.trace_id, (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND m.role = 'user' AND m.deleted_at IS NULL) AS message_count FROM chats c WHERE c.user_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at DESC`,
    ),
    userId,
  );

  log.debug`Loaded ${rows.length} chats for user ${userId}`;

  return rows.map((row) => ({
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    createdAt: String(row.created_at),
    messageCount: Number(row.message_count ?? 0),
    locked: Boolean(row.locked ?? false),
    userAgentId: row.user_agent_id == null ? undefined : Number(row.user_agent_id),
    traceId: row.trace_id == null ? undefined : String(row.trace_id),
  }));
}

/**
 * Get a single chat by ID.
 */
function getChat(chatId: string): Chat | undefined {
  const db = getDb();
  const row = queryRow<Record<string, unknown>>(
    db.prepare(
      `SELECT c.id, c.user_id, c.title, c.created_at, c.locked, c.user_agent_id, c.trace_id, (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND m.role = 'user' AND m.deleted_at IS NULL) AS message_count FROM chats c WHERE c.id = ? AND c.deleted_at IS NULL`,
    ),
    chatId,
  );

  if (!row) return undefined;

  return {
    id: String(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    createdAt: String(row.created_at),
    messageCount: Number(row.message_count ?? 0),
    locked: Boolean(row.locked ?? false),
    userAgentId: row.user_agent_id == null ? undefined : Number(row.user_agent_id),
    traceId: row.trace_id == null ? undefined : String(row.trace_id),
  };
}

/**
 * Soft-delete a chat by setting its deleted_at timestamp.
 * Messages are preserved but the chat is hidden from normal queries.
 */
function deleteChat(chatId: string): void {
  const db = getDb();
  db.prepare("UPDATE chats SET deleted_at = datetime('now') WHERE id = ?").run(chatId);
}

/**
 * Soft-delete a message by setting its deleted_at timestamp.
 */
function softDeleteMessage(messageId: string): void {
  const db = getDb();
  db.prepare("UPDATE messages SET deleted_at = datetime('now') WHERE id = ?").run(messageId);
}

/**
 * Rename a chat. Title is truncated to 100 chars.
 */
function renameChat(chatId: string, title: string): void {
  const db = getDb();
  db.prepare('UPDATE chats SET title = ? WHERE id = ?').run(title.slice(0, 100), chatId);
}

/**
 * Get count of messages in a chat.
 */
function getChatMessageCount(chatId: string): number {
  const db = getDb();
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM messages WHERE chat_id = ? AND role = 'user' AND deleted_at IS NULL")
    .get(chatId) as { count: number };
  return row.count;
}

/**
 * Get count of chats for a user.
 */
function getUserChatCount(userId: string): number {
  const db = getDb();
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM chats WHERE user_id = ? AND deleted_at IS NULL')
    .get(userId) as { count: number };
  return row.count;
}

/**
 * Insert a lead from the contact form.
 */
function insertLead(
  userId: string,
  name: string,
  email: string,
  companyName: string,
  role: string,
  message: string,
  ipAddress: string,
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO leads (user_id, name, email, company_name, role, message, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, name, email, companyName, role, message, ipAddress);
}

/**
 * Update user's name and email in the users table.
 */
function updateUserContact(userId: string, name: string, email: string): void {
  const db = getDb();
  db.prepare(`UPDATE users SET name = ?, email = ? WHERE id = ?`).run(name, email, userId);
}

/**
 * Log a contact intent detection event.
 */
function insertContactIntent(userId: string, chatId: string, text: string): void {
  const db = getDb();
  db.prepare('INSERT INTO contact_intents (user_id, chat_id, text) VALUES (?, ?, ?)').run(userId, chatId, text);
}

/** @group Message Functions */

/**
 * Add a message to a chat history.
 * Guarantees the user and chat exist before inserting (auto-creates if absent).
 * If chatId not provided, message has NULL chat_id (legacy support).
 */
export interface AddMessageParams {
  userId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: string;
  reasoning?: string;
  chatId?: string;
  modelId?: number;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  maxTokens?: number;
  queryType?: string;
  irrecoverable?: boolean;
  error?: string;
  msgId?: string;
  userAgentId?: number;
  fromCache?: boolean;
}

/**
 * Add a message to chat history, auto-creating user and chat records as needed.
 * @param params - Message parameters including role, content, and metadata
 * @returns The message ID
 */
function addMessage(params: AddMessageParams): string {
  const db = getDb();
  ensureUser(params.userId);
  if (params.chatId)
    ensureChat(params.chatId, params.userId, params.role === 'user' ? params.content.slice(0, 100) : undefined);
  const id = params.msgId ?? randomUUID();
  const ctx = getCurrentTraceContext();
  db.prepare(
    'INSERT INTO messages (id, user_id, chat_id, role, content, sources, reasoning, error, irrecoverable, model_id, tokens_in, tokens_out, duration_ms, max_tokens, query_type, user_agent_id, trace_id, from_cache) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    id,
    params.userId,
    params.chatId ?? null,
    params.role,
    params.content,
    params.sources ?? '[]',
    params.reasoning ?? '',
    params.error ?? null,
    params.irrecoverable ? 1 : 0,
    params.modelId ?? null,
    params.tokensIn ?? 0,
    params.tokensOut ?? 0,
    params.durationMs ?? 0,
    params.maxTokens ?? 0,
    params.queryType ?? null,
    params.userAgentId ?? null,
    ctx?.traceId ?? null,
    params.fromCache ? 1 : 0,
  );
  return id;
}

/**
 * Retrieve messages by chat ID, oldest first.
 */
function getMessages(chatId: string, limit: number = 50, offset: number = 0): StoredMessage[] {
  const db = getDb();
  const rows = queryRows<Record<string, unknown>>(
    db.prepare(
      'SELECT id, user_id, chat_id, role, content, sources, reasoning, error, irrecoverable, created_at, model_id, tokens_in, tokens_out, duration_ms, max_tokens, deleted_at, from_cache FROM messages WHERE chat_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?',
    ),
    chatId,
    limit,
    offset,
  );

  return rows.map((row) => parseStoredMessage(row));
}

/**
 * Retrieve messages by user ID (legacy fallback).
 */
function getMessagesByUserId(userId: string, limit: number = 50, offset: number = 0): StoredMessage[] {
  const db = getDb();
  const rows = queryRows<Record<string, unknown>>(
    db.prepare(
      'SELECT id, user_id, chat_id, role, content, sources, reasoning, error, irrecoverable, created_at, model_id, tokens_in, tokens_out, duration_ms, max_tokens, deleted_at, from_cache FROM messages WHERE user_id = ? ORDER BY created_at ASC LIMIT ? OFFSET ?',
    ),
    userId,
    limit,
    offset,
  );

  return rows.map((row) => parseStoredMessage(row));
}

/** Parse raw DB row into StoredMessage. */
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

/**
 * Ensure a model record exists in the models table and return its ID.
 * @param provider - LLM provider name
 * @param modelName - Configured model name
 * @param actualModelName - Actual model name returned by the provider
 * @param maxTokens - Maximum tokens for this model
 * @returns Model record ID
 */
function ensureModel(provider: string, modelName: string, actualModelName: string, maxTokens: number): number {
  const safeMaxTokens = maxTokens ?? 0;
  const db = getDb();
  db.prepare(
    'INSERT OR IGNORE INTO models (provider, model_name, actual_model_name, max_tokens) VALUES (?, ?, ?, ?)',
  ).run(provider, modelName, actualModelName, safeMaxTokens);
  const row = db
    .prepare('SELECT id FROM models WHERE provider = ? AND model_name = ? AND actual_model_name = ?')
    .get(provider, modelName, actualModelName) as { id: number } | undefined;
  if (!row) {
    throw new Error(
      `ensureModel: failed to find model row for provider="${provider}" model="${modelName}" actual="${actualModelName}"`,
    );
  }
  return row.id;
}

/** @group Chat Events (SSE reconnect) */

/**
 * Insert a chat event. Returns the new event ID.
 */
function insertChatEvent(chatId: string, type: string, data: unknown): number {
  const db = getDb();
  const result = db
    .prepare('INSERT INTO chat_events (chat_id, type, data) VALUES (?, ?, ?)')
    .run(chatId, type, JSON.stringify(data));
  return Number(result.lastInsertRowid);
}

/**
 * Get chat events since a given event ID (exclusive).
 * Returns events ordered by id ascending.
 */
function getChatEventsSince(
  chatId: string,
  lastEventId: number,
): { id: number; chatId: string; type: string; data: unknown; createdAt: string }[] {
  const db = getDb();
  const rows = queryRows<Record<string, unknown>>(
    db.prepare(
      'SELECT id, chat_id, type, data, created_at FROM chat_events WHERE chat_id = ? AND id > ? ORDER BY id ASC',
    ),
    chatId,
    lastEventId,
  );
  return rows.map((r) => ({
    id: Number(r.id),
    chatId: String(r.chat_id),
    type: String(r.type),
    data: JSON.parse(String(r.data)),
    createdAt: String(r.created_at),
  }));
}

/** @group Reaction Functions */

/**
 * Save or update a reaction for a message.
 * Upserts: if reaction exists for this message+user, update type and reason.
 */
function setReaction(messageId: string, userId: string, reactionType: 'up' | 'down' | 'heart', reason?: string): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO reactions (message_id, user_id, reaction_type, reason)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(message_id, user_id) DO UPDATE SET
       reaction_type = excluded.reaction_type,
       reason = excluded.reason,
       created_at = datetime('now')`,
  ).run(messageId, userId, reactionType, reason ?? '');
}

/**
 * Get reaction for a specific message + user, or null if none.
 */
function getReaction(messageId: string, userId: string): { type: 'up' | 'down' | 'heart'; reason: string } | null {
  const db = getDb();
  const row = queryRow<Record<string, unknown>>(
    db.prepare('SELECT reaction_type, reason FROM reactions WHERE message_id = ? AND user_id = ?'),
    messageId,
    userId,
  );
  if (!row) return null;
  return {
    type: parseReactionType(row.reaction_type),
    reason: String(row.reason ?? ''),
  };
}

/**
 * Remove a reaction for a message + user.
 */
function deleteReaction(messageId: string, userId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ?').run(messageId, userId);
}

/**
 * Delete all messages for a specific chat.
 */
function clearChatMessages(chatId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE chat_id = ?').run(chatId);
}

/**
 * Get page posts, optionally filtered by slug.
 */
function getPosts(slug?: string): {
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
  headerImage: { alt: string; url: string } | null;
  featured: boolean;
  position: number | null;
  partOfSeries: number | null;
  workflowFiles:
    | { label: string; file: string; placeholders: { key: string; label: string; hint?: string }[] }[]
    | null;
}[] {
  const db = getDb();
  let rows;
  if (slug) {
    rows = queryRows<Record<string, unknown>>(
      db.prepare(
        'SELECT id, slug, content, toc, title, description, date, tags, status, excerpt, header_image, featured, position, part_of_series, workflow_files FROM page_posts WHERE slug = ?',
      ),
      slug,
    );
  } else {
    rows = queryRows<Record<string, unknown>>(
      db.prepare(
        'SELECT id, slug, content, toc, title, description, date, tags, status, excerpt, header_image, featured, position, part_of_series, workflow_files FROM page_posts',
      ),
    );
  }
  return rows.map((r) => {
    let toc: { id: string; text: string; level: number }[] = [];
    try {
      const parsed = JSON.parse(String(r.toc ?? '[]'));
      if (Array.isArray(parsed)) toc = parsed;
    } catch (e) {
      log.warn`Failed to parse ToC JSON: ${e}`;
    }
    return {
      id: Number(r.id),
      slug: String(r.slug),
      content: String(r.content),
      toc,
      title: String(r.title ?? ''),
      description: String(r.description ?? ''),
      date: r.date ? String(r.date) : null,
      tags: JSON.parse(String(r.tags ?? '[]')),
      status: String(r.status),
      excerpt: String(r.excerpt ?? ''),
      headerImage: JSON.parse(String(r.header_image ?? 'null')) as { alt: string; url: string } | null,
      featured: Number(r.featured) === 1,
      position: r.position != null ? Number(r.position) : null,
      partOfSeries: r.part_of_series != null ? Number(r.part_of_series) : null,
      workflowFiles: (() => {
        try {
          return JSON.parse(String(r.workflow_files ?? 'null'));
        } catch {
          return null;
        }
      })(),
    };
  });
}

/**
 * Get page experience entries, optionally filtered by slug.
 */
function getExperience(slug?: string): {
  slug: string;
  content: string;
  company: string;
  role: string;
  startDate: string | null;
  endDate: string | null;
  duration: string;
  skills: string[];
  description: string;
  published: boolean;
}[] {
  const db = getDb();
  let rows;
  if (slug) {
    rows = queryRows<Record<string, unknown>>(
      db.prepare(
        'SELECT slug, content, company, role, start_date, end_date, duration, skills, description, published FROM page_experience WHERE slug = ?',
      ),
      slug,
    );
  } else {
    rows = queryRows<Record<string, unknown>>(
      db.prepare(
        'SELECT slug, content, company, role, start_date, end_date, duration, skills, description, published FROM page_experience',
      ),
    );
  }
  return rows.map((r) => ({
    slug: String(r.slug),
    content: String(r.content),
    company: String(r.company ?? ''),
    role: String(r.role ?? ''),
    startDate: r.start_date ? String(r.start_date) : null,
    endDate: r.end_date ? String(r.end_date) : null,
    duration: String(r.duration ?? ''),
    skills: JSON.parse(String(r.skills ?? '[]')),
    description: String(r.description ?? ''),
    published: r.published !== 0,
  }));
}

/** @group Chat Locking */

function lockChat(chatId: string): void {
  const db = getDb();
  db.prepare('UPDATE chats SET locked = 1 WHERE id = ?').run(chatId);
}

function isChatLocked(chatId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT locked FROM chats WHERE id = ?').get(chatId) as { locked: number } | undefined;
  return row?.locked === 1;
}

function getOffTopicCount(chatId: string): number {
  const db = getDb();
  const row = db.prepare('SELECT off_topic_count FROM chats WHERE id = ?').get(chatId) as
    | { off_topic_count: number }
    | undefined;
  return row?.off_topic_count ?? 0;
}

function incrementOffTopicCount(chatId: string): number {
  const db = getDb();
  db.prepare('UPDATE chats SET off_topic_count = off_topic_count + 1 WHERE id = ?').run(chatId);
  return getOffTopicCount(chatId);
}

/**
 * Get tool calls for a message, ordered by start time.
 * Computes durationMs from started_at/finished_at timestamps.
 */
function getToolCallsByMessageId(messageId: string): ToolCallRecord[] {
  const db = getDb();
  const rows = queryRows<Record<string, unknown>>(
    db.prepare(
      `SELECT id, name, server_id, started_at, finished_at,
        CASE WHEN finished_at IS NOT NULL THEN
          (julianday(finished_at) - julianday(started_at)) * 86400000
        ELSE NULL END as duration_ms
      FROM tool_calls WHERE message_id = ? ORDER BY started_at ASC`,
    ),
    messageId,
  );
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    serverId: String(row.server_id),
    startedAt: String(row.started_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
    durationMs: row.duration_ms != null ? Math.round(Number(row.duration_ms)) : null,
  }));
}

/**
 * Batch fetch tool calls for multiple message IDs.
 * Returns a record keyed by message ID.
 */
function getToolCallsForMessages(messageIds: string[]): Record<string, ToolCallRecord[]> {
  if (messageIds.length === 0) return {};
  const db = getDb();
  const placeholders = messageIds.map(() => '?').join(',');
  const rows = queryRows<Record<string, unknown>>(
    db.prepare(
      `SELECT id, message_id, name, server_id, started_at, finished_at,
        CASE WHEN finished_at IS NOT NULL THEN
          (julianday(finished_at) - julianday(started_at)) * 86400000
        ELSE NULL END as duration_ms
      FROM tool_calls WHERE message_id IN (${placeholders}) ORDER BY started_at ASC`,
    ),
    ...messageIds,
  );
  const map: Record<string, ToolCallRecord[]> = {};
  for (const row of rows) {
    const msgId = String(row.message_id);
    if (!map[msgId]) map[msgId] = [];
    map[msgId].push({
      id: String(row.id),
      name: String(row.name),
      serverId: String(row.server_id),
      startedAt: String(row.started_at),
      finishedAt: row.finished_at ? String(row.finished_at) : null,
      durationMs: row.duration_ms != null ? Math.round(Number(row.duration_ms)) : null,
    });
  }
  return map;
}

export {
  getDb,
  searchChunks,
  closeDb,
  addMessage,
  getMessages,
  getToolCallsByMessageId,
  getToolCallsForMessages,
  getMessagesByUserId,
  clearChatMessages,
  ensureModel,
  insertChatEvent,
  getChatEventsSince,
  setReaction,
  getReaction,
  deleteReaction,
  softDeleteMessage,
  getPosts,
  getExperience,
  createChat,
  getChats,
  getChat,
  deleteChat,
  renameChat,
  getChatMessageCount,
  getUserChatCount,
  insertLead,
  updateUserContact,
  insertContactIntent,
  lockChat,
  isChatLocked,
  getOffTopicCount,
  incrementOffTopicCount,
};
export type { StoredChunk, SearchResult, StoredMessage, Chat };
