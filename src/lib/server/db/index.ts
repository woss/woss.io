import { SurrealDatabaseService } from './surreal-service';
import type { IDatabaseService } from './interfaces';

/**
 * SurrealDB service singleton instance.
 * Type-annotated as IDatabaseService so callers only see the interface.
 * call init() at app startup: await db.init();
 * call close() at shutdown: await db.close();
 */
export const db: IDatabaseService = new SurrealDatabaseService();

// Re-export aggregate service type
export type { IDatabaseService };

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
} from './interfaces';
