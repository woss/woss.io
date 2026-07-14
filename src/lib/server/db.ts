// Re-export SurrealDB service singleton for all consumers
export { db } from './db/index';

// Re-export aggregate service type
export type { IDatabaseService } from './db/index';

// Re-export all data interfaces and repo interfaces
export type {
  StoredChunk,
  SearchResult,
  ToolCallRecord,
  StoredMessage,
  Chat,
  AddMessageParams,
  ChatEvent,
  ReactionResult,
  Post,
  ExperienceEntry,
  CacheHit,
  CacheEntry,
  CacheStats,
  RateLimitResult,
  UserAgentRecord,
  UserRecord,
  ChatSummary,
} from './db/interfaces';
