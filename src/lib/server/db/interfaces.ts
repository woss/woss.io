// ─── Shared Types ───────────────────────────────────────────────────────────
// These currently live in db.ts and will be removed from there once the
// SurrealDB migration is complete.

export interface ChunkRecord {
  chunkId: string;
  text: string;
  title: string;
  date: string;
  tags: string[];
  section: string;
  embedding: number[];
}

/**
 * Stored chunk with parent identity derived from has_chunks edge traversal.
 * `slug` and `type` are populated from the parent record (page_posts/page_experience)
 * via edge traversal, NOT stored on the chunk itself.
 */
export interface StoredChunk {
  id: string;
  text: string;
  title: string;
  date: string;
  tags: string[];
  section: string;
  /** Parent record slug — derived from has_chunks edge traversal */
  slug: string;
  embedding: number[];
  /** Parent record type — derived from has_chunks edge traversal */
  type: 'post' | 'experience';
}

export interface SearchResult {
  chunk: StoredChunk;
  /** Cosine distance from query embedding (0 = identical). */
  score: number;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  serverId: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface StoredMessage {
  id: string;
  userId: string;
  chatId: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources: string;
  reasoning: string;
  error?: string;
  irrecoverable?: boolean;
  userAgentId?: number;
  createdAt: string;
  modelId: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  maxTokens: number;
  queryType?: string;
  deletedAt?: string;
  fromCache?: boolean;
}

export interface Chat {
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

export interface AddMessageParams {
  userId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  sources?: string;
  reasoning?: string;
  chatId?: string;
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

// ─── Domain-specific Types ──────────────────────────────────────────────────

export interface ChatEvent {
  id: number;
  chatId: string;
  type: string;
  data: unknown;
  createdAt: string;
}

export interface ReactionResult {
  type: 'up' | 'down' | 'heart';
  reason: string;
}

export interface Post {
  id: number;
  slug: string;
  content: string;
  toc: { id: string; text: string; level: number }[];
  title: string;
  description: string;
  date: string;
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

export interface ExperienceEntry {
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

export interface CacheHit {
  answer: string;
  sources: string;
  toolCalls?: { name: string; serverId: string }[];
  score?: number;
  createdAt?: string;
}

export interface CacheEntry {
  id: number;
  question: string;
  answer: string;
  sources: string;
  toolCalls: string | null;
  messageId: string | null;
  createdAt: string;
}

export interface CacheStats {
  totalEntries: number;
  oldestEntry: string | null;
  newestEntry: string | null;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export interface UserAgentRecord {
  id: number;
  ua: string;
  deviceType: string | null;
  ip: string | null;
  createdAt: string;
}

export interface UserRecord {
  id: string;
  email: string | null;
  name: string | null;
  createdAt: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: string;
  messageCount: number;
  lastMessageAt: string | null;
}

// ─── Repository Interfaces ──────────────────────────────────────────────────

export interface IUserRepo {
  ensureUser(userId: string, email?: string, name?: string): Promise<void>;
  getOrCreateUser(userId: string, email?: string, name?: string): Promise<UserRecord>;
  getUser(userId: string): Promise<UserRecord | undefined>;
  updateUser(userId: string, updates: Partial<Pick<UserRecord, 'email' | 'name'>>): Promise<void>;
}

export interface IChatRepo {
  ensureChat(chatId: string, userId: string, title?: string): Promise<void>;
  createChat(userId: string, title?: string, userAgentId?: number): Promise<string>;
  getChats(userId: string): Promise<Chat[]>;
  getChat(chatId: string): Promise<Chat | undefined>;
  updateChat(chatId: string, updates: Partial<Pick<Chat, 'title' | 'locked' | 'deletedAt'>>): Promise<void>;
  deleteChat(chatId: string): Promise<void>;
  hardDeleteOldChats(before: Date): Promise<number>;
  renameChat(chatId: string, title: string): Promise<void>;
  getChatMessageCount(chatId: string): Promise<number>;
  getUserChatCount(userId: string): Promise<number>;
  lockChat(chatId: string): Promise<void>;
  isChatLocked(chatId: string): Promise<boolean>;
  getOffTopicCount(chatId: string): Promise<number>;
  incrementOffTopicCount(chatId: string): Promise<number>;
  clearChatMessages(chatId: string): Promise<void>;
  getChatSummaryForApi(chatId: string): Promise<ChatSummary | undefined>;
}

export interface IMessageRepo {
  addMessage(params: AddMessageParams): Promise<string>;
  setMessageModel(msgId: string, modelId: string): Promise<void>;
  getMessages(chatId: string, limit?: number, offset?: number): Promise<StoredMessage[]>;
  getMessagesByUserId(userId: string, limit?: number, offset?: number): Promise<StoredMessage[]>;
  getLastMessagesCount(chatId: string, count: number): Promise<StoredMessage[]>;
  hardDeleteOldMessages(before: Date): Promise<number>;
  setAssistantMessageContent(messageId: string, content: string): Promise<void>;
  softDeleteMessage(messageId: string): Promise<void>;
  setMessageQueryType(messageId: string, queryType: string): Promise<void>;
}

export interface IEventRepo {
  insertChatEvent(chatId: string, type: string, data: unknown): Promise<number>;
  getChatEventsSince(chatId: string, lastEventId: number): Promise<ChatEvent[]>;
}

export interface IReactionRepo {
  setReaction(messageId: string, userId: string, reactionType: 'up' | 'down' | 'heart', reason?: string): Promise<void>;
  getReaction(messageId: string, userId: string): Promise<ReactionResult | null>;
  deleteReaction(messageId: string, userId: string): Promise<void>;
}

export interface IToolCallRepo {
  getToolCallsByMessageId(messageId: string): Promise<ToolCallRecord[]>;
  getToolCallsForMessages(messageIds: string[]): Promise<Record<string, ToolCallRecord[]>>;
  insertToolCall(id: string, msgId: string, name: string, serverId: string, toolInput: string): Promise<void>;
  setToolCallResult(id: string, result: string, resultSize: number): Promise<void>;
}

export interface IContentRepo {
  // Read existing SLUG + HASH pairs from page_posts and page_experience tables
  getStoredHashes(): Promise<{ slug: string; hash: string }[]>;

  // Upsert (create or update) a page_post by slug
  // slug has UNIQUE index so UPSERT uses slug as the matching key
  // Set updated_at to time::now(); omit part_of_series (stays NONE until second pass)
  upsertPost(opts: {
    slug: string;
    hash: string;
    content: string;
    toc: string;
    title: string;
    description: string;
    date: string;
    tags: string[];
    status: string;
    excerpt: string;
    headerImage: string | null;
    featured: boolean;
    position: number | null;
    workflowFiles: string | null;
  }): Promise<void>;

  // Upsert (create or update) a page_experience by slug
  upsertExperience(opts: {
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
  }): Promise<void>;

  // Delete a page_post by slug
  deletePost(slug: string): Promise<void>;

  // Delete a page_experience by slug
  deleteExperience(slug: string): Promise<void>;

  // Get all page_posts id + slug for series resolution
  // Uses meta::id(id) to extract the record key, aliased as "id" and returned as string
  getSlugToIdMap(): Promise<{ id: string; slug: string }[]>;

  // Update part_of_series on a page_post
  // parentSlug null → clear to NONE
  // parentSlug non-null → set to the parent's record ID via subquery
  updatePartOfSeries(slug: string, parentSlug: string | null): Promise<void>;

  getPosts(opts?: { slug?: string; sort?: 'date' | 'title'; order?: 'asc' | 'desc'; limit?: number }): Promise<Post[]>;
  getExperience(slug?: string): Promise<ExperienceEntry[]>;
  getRelatedBusinessPages(slug: string): Promise<string[]>;
}

export interface ILeadRepo {
  insertLead(
    userId: string,
    name: string,
    email: string,
    companyName: string,
    role: string,
    message: string,
    ipAddress: string,
  ): Promise<void>;
}

export interface IContactIntentRepo {
  insertContactIntent(userId: string, chatId: string, text: string): Promise<void>;
  updateUserContact(userId: string, name: string, email: string): Promise<void>;
}

export interface IUserAgentRepo {
  getOrCreateUserAgent(ua: string, ip?: string): Promise<number>;
  getUserAgents(): Promise<UserAgentRecord[]>;
}

export interface ILlmCacheRepo {
  searchCache(embedding: number[], limit?: number): Promise<CacheHit[]>;
  getCached(cacheId: number): Promise<CacheEntry | undefined>;
  setCached(
    question: string,
    answer: string,
    embedding: number[],
    sources: string,
    toolCalls?: string,
    messageId?: string,
  ): Promise<void>;
  getCacheStats(): Promise<CacheStats>;
}

/**
 * Edge connecting a parent record (page_posts/page_experience) to its chunks.
 * Schema: page_posts:xxx --has_chunks--> chunks:xxx_chunk_0
 */
export interface HasChunkEdge {
  /** Parent record table + id (e.g., 'page_posts:my-post-slug') */
  parentTable: 'page_posts' | 'page_experience';
  /** Parent record slug */
  parentSlug: string;
  /** Chunk table + id (e.g., 'chunks:my-post-slug_chunk_0') */
  chunkId: string;
}

export interface IVectorRepo {
  /** Bulk upsert chunks. For each row, UPSERT by chunk_id (has UNIQUE index). Chunks no longer store slug/type. */
  upsertChunks(rows: ChunkRecord[]): Promise<string[]>;

  /**
   * Create has_chunks edges connecting a parent record to its chunks.
   * @param parentTable - 'page_posts' or 'page_experience'
   * @param parentSlug - slug of the parent record
   * @param chunkIds - array of chunk chunk_id values to connect
   */
  createEdges(parentTable: 'page_posts' | 'page_experience', parentSlug: string, chunkIds: string[]): Promise<void>;

  /** Delete all chunks and their has_chunks edges for a given parent slug. */
  deleteChunksBySlug(slug: string): Promise<void>;

  /**
   * Search chunks by embedding similarity.
   * Traverses has_chunks edges to populate slug/type from parent records.
   * @param embedding - query vector
   * @param limit - max results
   * @param typeFilter - optional filter on parent type ('post' | 'experience')
   */
  searchChunks(embedding: number[], limit?: number, typeFilter?: 'post' | 'experience'): Promise<SearchResult[]>;
}

export interface IModelRepo {
  ensureModel(provider: string, modelName: string, actualModelName: string, maxTokens: number): Promise<string>;
  getModelByProvider(
    provider: string,
    modelName: string,
  ): Promise<{ id: string; actualModelName: string; maxTokens: number } | undefined>;
  getModels(): Promise<
    Array<{ id: string; provider: string; modelName: string; actualModelName: string; maxTokens: number }>
  >;
  getModelById(id: string): Promise<{ modelName: string; actualModelName: string } | undefined>;
}

export interface IFeatureTourRepo {
  getDismissedFeatureTours(userId: string): Promise<string[]>;
  dismissFeatureTours(userId: string, featureIds: string[]): Promise<void>;
  resetFeatureTours(userId: string): Promise<void>;
}

// ─── Centroid Repo ──────────────────────────────────────────────────────────

export interface CentroidRecord {
  class: string;
  vector: number[];
  hash: string;
}

export interface ICentroidRepo {
  getAllCentroids(): Promise<CentroidRecord[]>;
  upsertCentroid(key: string, vector: number[], hash: string): Promise<void>;
}

// ─── Aggregate Service ──────────────────────────────────────────────────────

export interface IDatabaseService {
  /** Initialize the SurrealDB connection. */
  init(): Promise<void>;
  /** Verify SurrealDB connection is alive. */
  healthCheck(): Promise<boolean>;
  /** Close the connection gracefully. */
  close(): Promise<void>;
  /** Execute operations in a SurrealDB transaction. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  users: IUserRepo;
  chats: IChatRepo;
  messages: IMessageRepo;
  events: IEventRepo;
  reactions: IReactionRepo;
  toolCalls: IToolCallRepo;
  content: IContentRepo;
  leads: ILeadRepo;
  contactIntents: IContactIntentRepo;
  userAgents: IUserAgentRepo;
  llmCache: ILlmCacheRepo;
  vector: IVectorRepo;
  models: IModelRepo;
  featureTours: IFeatureTourRepo;
  centroids: ICentroidRepo;
}
