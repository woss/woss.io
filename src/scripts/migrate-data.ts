/**
 * migrate-data.ts
 *
 * Copies ALL existing data from SQLite (data/woss.db) to SurrealDB.
 *
 * Usage: bun run src/scripts/migrate-data.ts
 *
 * Prerequisites:
 *   - SurrealDB running locally (ws://localhost:10101, ns:woss, db:woss)
 *   - Schema already applied via migrate.surql
 *   - SQLite DB at data/woss.db with existing data
 */

import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { type Surreal, RecordId, Table } from 'surrealdb';
import { initSurreal, closeSurreal } from '../lib/server/db/surreal';
import { SEED_QUERIES, type QueryClass } from '../lib/chat/suggested-questions';
import centroidData from '../../data/centroid.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MigrationResult {
  table: string;
  attempted: number;
  succeeded: number;
  failed: number;
  errors: string[];
}

type SurrealRow = Record<string, unknown>;

// Maps: SQLite auto-increment ID → SurrealDB auto-generated RecordId
// Populated during migration of user_agents and models, consumed by chats, messages, etc.
const userAgentIdMap = new Map<number, RecordId>();
const modelIdMap = new Map<number, RecordId>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDate(value: unknown): Date | undefined {
  if (value == null || value === '') return undefined;
  const d = new Date(String(value));
  return isNaN(d.getTime()) ? undefined : d;
}

function toJSON<T = unknown>(value: unknown): T | undefined {
  if (value == null || value === '') return undefined;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return undefined;
  }
}

function toBool(value: unknown): boolean {
  return value === 1 || value === true;
}

function toNum(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return isNaN(n) ? undefined : n;
}

// ---------------------------------------------------------------------------
// Table migration functions
// ---------------------------------------------------------------------------

async function migrateUserAgents(db: Database.Database, surreal: Surreal) {
  const result: MigrationResult = { table: 'user_agents', attempted: 0, succeeded: 0, failed: 0, errors: [] };
  const rows = db.prepare('SELECT * FROM user_agents').all();
  result.attempted = rows.length;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    try {
      const created = await surreal.create(new Table('user_agents')).content({
        ua: r.ua ?? null,
        ip: r.ip ?? null,
        device_type: r.device_type ?? null,
        created_at: toDate(r.created_at) ?? new Date(),
      });
      userAgentIdMap.set(Number(r.id), created[0].id as RecordId);
      result.succeeded++;
    } catch (e) {
      result.failed++;
      result.errors.push(`id=${r.id}: ${(e as Error).message}`);
    }
  }
  return result;
}

async function migrateModels(db: Database.Database, surreal: Surreal) {
  const result: MigrationResult = { table: 'models', attempted: 0, succeeded: 0, failed: 0, errors: [] };
  const rows = db.prepare('SELECT * FROM models').all();
  result.attempted = rows.length;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    try {
      const created = await surreal.create(new Table('models')).content({
        provider: r.provider ?? null,
        model_name: r.model_name ?? null,
        actual_model_name: r.actual_model_name ?? null,
        max_tokens: toNum(r.max_tokens) ?? null,
      });
      modelIdMap.set(Number(r.id), created[0].id as RecordId);
      result.succeeded++;
    } catch (e) {
      result.failed++;
      result.errors.push(`id=${r.id}: ${(e as Error).message}`);
    }
  }
  return result;
}

async function migrateUsers(db: Database.Database, surreal: Surreal) {
  const result: MigrationResult = { table: 'users', attempted: 0, succeeded: 0, failed: 0, errors: [] };
  const rows = db.prepare('SELECT * FROM users').all();
  result.attempted = rows.length;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    try {
      await surreal.create(new RecordId('users', String(r.id))).content({
        email: r.email ?? null,
        name: r.name ?? null,
        created_at: toDate(r.created_at) ?? new Date(),
      });
      result.succeeded++;
    } catch (e) {
      result.failed++;
      result.errors.push(`id=${r.id}: ${(e as Error).message}`);
    }
  }
  return result;
}

async function migratePageExperience(db: Database.Database, surreal: Surreal) {
  const result: MigrationResult = { table: 'page_experience', attempted: 0, succeeded: 0, failed: 0, errors: [] };
  const rows = db.prepare('SELECT * FROM page_experience').all();
  result.attempted = rows.length;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    try {
      await surreal.create(new RecordId('page_experience', String(r.slug))).content({
        slug: r.slug ?? null,
        hash: r.hash ?? null,
        content: r.content ?? null,
        company: r.company ?? null,
        role: r.role ?? null,
        start_date: r.start_date ?? null,
        end_date: r.end_date ?? null,
        duration: r.duration ?? null,
        skills: toJSON<string[]>(r.skills),
        description: r.description ?? null,
        published: toBool(r.published),
        updated_at: r.updated_at ? String(r.updated_at) : null,
        job_role: r.job_role ?? null,
      });
      result.succeeded++;
    } catch (e) {
      result.failed++;
      result.errors.push(`slug=${r.slug}: ${(e as Error).message}`);
    }
  }
  return result;
}

async function migratePagePosts(db: Database.Database, surreal: Surreal) {
  const result: MigrationResult = { table: 'page_posts', attempted: 0, succeeded: 0, failed: 0, errors: [] };
  const rows = db.prepare('SELECT * FROM page_posts').all() as Record<string, unknown>[];
  result.attempted = rows.length;

  // First pass: insert all page_posts without part_of_series (self-ref)
  for (const r of rows) {
    try {
      await surreal.create(new RecordId('page_posts', String(r.slug))).content({
        slug: r.slug ?? null,
        hash: r.hash ?? null,
        content: r.content ?? null,
        toc: r.toc ?? null,
        title: r.title ?? null,
        description: r.description ?? null,
        date: r.date ?? null,
        tags: toJSON<string[]>(r.tags),
        status: r.status ?? 'draft',
        excerpt: r.excerpt ?? null,
        header_image: r.header_image ?? null,
        featured: toBool(r.featured),
        position: toNum(r.position) ?? null,
        workflow_files: r.workflow_files ?? null,
        updated_at: r.updated_at ? String(r.updated_at) : null,
      });
      result.succeeded++;
    } catch (e) {
      result.failed++;
      result.errors.push(`slug=${r.slug}: ${(e as Error).message}`);
    }
  }

  // Second pass: set part_of_series references
  // SQLite part_of_series is INTEGER referencing page_posts(id) — the autoincrement id
  // We need to look up the slug from the SQLite id to create the SurrealDB RecordId
  const slugLookup = new Map<number, string>();
  for (const r of rows) {
    slugLookup.set(Number(r.id), String(r.slug));
  }

  for (const r of rows) {
    const partOfSeriesId = toNum(r.part_of_series);
    if (partOfSeriesId != null && partOfSeriesId !== 0) {
      const parentSlug = slugLookup.get(partOfSeriesId);
      if (parentSlug) {
        try {
          await surreal.update(new RecordId('page_posts', String(r.slug))).merge({
            part_of_series: new RecordId('page_posts', parentSlug),
          });
        } catch (e) {
          // Non-fatal: parent slug mapping failed
          result.errors.push(`part_of_series slug=${r.slug}->${parentSlug}: ${(e as Error).message}`);
        }
      }
    }
  }
  return result;
}

async function migrateChats(db: Database.Database, surreal: Surreal) {
  const result: MigrationResult = { table: 'chats', attempted: 0, succeeded: 0, failed: 0, errors: [] };
  const rows = db.prepare('SELECT * FROM chats').all();
  result.attempted = rows.length;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    try {
      const data: SurrealRow = {
        title: r.title ?? 'New Chat',
        created_at: toDate(r.created_at) ?? new Date(),
        locked: toBool(r.locked),
        off_topic_count: toNum(r.off_topic_count) ?? 0,
        trace_id: r.trace_id ?? null,
        deleted_at: toDate(r.deleted_at) ?? null,
      };
      if (r.user_agent_id) {
        const mapped = userAgentIdMap.get(Number(r.user_agent_id));
        if (mapped) data.user_agent_id = mapped;
      }
      await surreal.create(new RecordId('chats', String(r.id))).content(data);

      // Create has_chat edge: users → chats
      if (r.user_id) {
        try {
          await surreal.relate(
            new RecordId('users', String(r.user_id)),
            new Table('has_chat'),
            new RecordId('chats', String(r.id)),
            { created_at: toDate(r.created_at) ?? new Date() },
          );
        } catch (edgeErr) {
          console.warn(`Failed to create has_chat edge for chat ${r.id}: ${(edgeErr as Error).message}`);
        }
      }

      result.succeeded++;
    } catch (e) {
      result.failed++;
      result.errors.push(`id=${r.id}: ${(e as Error).message}`);
    }
  }
  return result;
}

async function migrateMessages(db: Database.Database, surreal: Surreal) {
  const result: MigrationResult = { table: 'messages', attempted: 0, succeeded: 0, failed: 0, errors: [] };
  const rows = db.prepare('SELECT * FROM messages').all();
  result.attempted = rows.length;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    try {
      const data: SurrealRow = {
        role: r.role ?? 'user',
        content: r.content ?? '',
        sources: r.sources ?? '[]',
        reasoning: r.reasoning ?? '',
        irrecoverable: toBool(r.irrecoverable),
        created_at: toDate(r.created_at) ?? new Date(),
        tokens_in: toNum(r.tokens_in) ?? 0,
        tokens_out: toNum(r.tokens_out) ?? 0,
        duration_ms: toNum(r.duration_ms) ?? 0,
        max_tokens: toNum(r.max_tokens) ?? 0,
        query_type: r.query_type ?? null,
        deleted_at: toDate(r.deleted_at) ?? null,
        trace_id: r.trace_id ?? null,
        from_cache: toBool(r.from_cache),
        error: r.error ?? null,
      };
      if (r.user_id) data.user_id = new RecordId('users', String(r.user_id));
      if (r.chat_id) data.chat_id = new RecordId('chats', String(r.chat_id));
      if (r.user_agent_id) {
        const mapped = userAgentIdMap.get(Number(r.user_agent_id));
        if (mapped) data.user_agent_id = mapped;
      }

      await surreal.create(new RecordId('messages', String(r.id))).content(data);

      // Create used_model edge if model_id present
      const modelId = toNum(r.model_id);
      if (modelId != null && modelId !== 0 && modelIdMap.has(modelId)) {
        try {
          await surreal.relate(
            new RecordId('messages', String(r.id)),
            new Table('used_model'),
            modelIdMap.get(modelId)!,
            { created_at: toDate(r.created_at) ?? new Date() },
          );
        } catch (edgeErr) {
          result.errors.push(`used_model edge msg=${r.id}: ${(edgeErr as Error).message}`);
        }
      }
      result.succeeded++;
    } catch (e) {
      result.failed++;
      result.errors.push(`id=${r.id}: ${(e as Error).message}`);
    }
  }
  return result;
}

async function migrateToolCalls(db: Database.Database, surreal: Surreal) {
  const result: MigrationResult = { table: 'tool_calls', attempted: 0, succeeded: 0, failed: 0, errors: [] };
  const rows = db.prepare('SELECT * FROM tool_calls').all();
  result.attempted = rows.length;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    try {
      const data: SurrealRow = {
        name: r.name ?? null,
        server_id: r.server_id ?? null,
        tool_input: r.tool_input ?? null,
        tool_output: r.tool_output ?? null,
        result_size: toNum(r.result_size) ?? 0,
        started_at: r.started_at ?? null,
        finished_at: r.finished_at ?? null,
      };
      await surreal.create(new RecordId('tool_calls', String(r.id))).content(data);
      // Create has_tool_call edge: messages → tool_calls
      if (r.message_id) {
        try {
          await surreal.relate(
            new RecordId('messages', String(r.message_id)),
            new Table('has_tool_call'),
            new RecordId('tool_calls', String(r.id)),
            { created_at: new Date() },
          );
        } catch (edgeErr) {
          console.warn(`Failed to create has_tool_call edge for tool_call ${r.id}: ${(edgeErr as Error).message}`);
        }
      }
      result.succeeded++;
    } catch (e) {
      result.failed++;
      result.errors.push(`id=${r.id}: ${(e as Error).message}`);
    }
  }
  return result;
}

async function migrateReactions(db: Database.Database, surreal: Surreal) {
  const result: MigrationResult = { table: 'reactions', attempted: 0, succeeded: 0, failed: 0, errors: [] };
  const rows = db.prepare('SELECT * FROM reactions').all();
  result.attempted = rows.length;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    try {
      const data: SurrealRow = {
        reaction_type: r.reaction_type ?? null,
        reason: r.reason ?? '',
        created_at: toDate(r.created_at) ?? new Date(),
      };
      if (r.user_id) data.user_id = new RecordId('users', String(r.user_id));
      const created = await surreal.create(new Table('reactions')).content(data);
      // Create has_reaction edge: messages → reactions
      if (r.message_id) {
        try {
          await surreal.relate(
            new RecordId('messages', String(r.message_id)),
            new Table('has_reaction'),
            created[0].id as RecordId,
            {
              created_at: toDate(r.created_at) ?? new Date(),
            },
          );
        } catch (edgeErr) {
          console.warn(`Failed to create has_reaction edge for reaction ${r.id}: ${(edgeErr as Error).message}`);
        }
      }
      result.succeeded++;
    } catch (e) {
      result.failed++;
      result.errors.push(`id=${r.id}: ${(e as Error).message}`);
    }
  }
  return result;
}

async function migrateChatEvents(db: Database.Database, surreal: Surreal) {
  const result: MigrationResult = { table: 'chat_events', attempted: 0, succeeded: 0, failed: 0, errors: [] };
  const rows = db.prepare('SELECT * FROM chat_events').all();
  result.attempted = rows.length;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    try {
      const data: SurrealRow = {
        type: r.type ?? null,
        data: r.data ?? null,
        created_at: toDate(r.created_at) ?? new Date(),
      };
      await surreal.create(new RecordId('chat_events', String(r.id))).content(data);
      // Create has_event edge: chats → chat_events
      if (r.chat_id) {
        try {
          await surreal.relate(
            new RecordId('chats', String(r.chat_id)),
            new Table('has_event'),
            new RecordId('chat_events', String(r.id)),
            { created_at: new Date() },
          );
        } catch (edgeErr) {
          console.warn(`Failed to create has_event edge for event ${r.id}: ${(edgeErr as Error).message}`);
        }
      }
      result.succeeded++;
    } catch (e) {
      result.failed++;
      result.errors.push(`id=${r.id}: ${(e as Error).message}`);
    }
  }
  return result;
}

async function migrateLeads(db: Database.Database, surreal: Surreal) {
  const result: MigrationResult = { table: 'leads', attempted: 0, succeeded: 0, failed: 0, errors: [] };
  const rows = db.prepare('SELECT * FROM leads').all();
  result.attempted = rows.length;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    try {
      const data: SurrealRow = {
        name: r.name ?? null,
        email: r.email ?? null,
        company_name: r.company_name ?? null,
        role: r.role ?? null,
        message: r.message ?? null,
        ip_address: r.ip_address ?? null,
        created_at: toDate(r.created_at) ?? new Date(),
      };
      if (r.user_id) data.user_id = new RecordId('users', String(r.user_id));
      await surreal.create(new Table('leads')).content(data);
      result.succeeded++;
    } catch (e) {
      result.failed++;
      result.errors.push(`id=${r.id}: ${(e as Error).message}`);
    }
  }
  return result;
}

async function migrateContactIntents(db: Database.Database, surreal: Surreal) {
  const result: MigrationResult = { table: 'contact_intents', attempted: 0, succeeded: 0, failed: 0, errors: [] };
  const rows = db.prepare('SELECT * FROM contact_intents').all();
  result.attempted = rows.length;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    try {
      const data: SurrealRow = {
        text: r.text ?? null,
        created_at: toDate(r.created_at) ?? new Date(),
      };
      if (r.user_id) data.user_id = new RecordId('users', String(r.user_id));
      if (r.chat_id) data.chat_id = new RecordId('chats', String(r.chat_id));
      await surreal.create(new Table('contact_intents')).content(data);
      result.succeeded++;
    } catch (e) {
      result.failed++;
      result.errors.push(`id=${r.id}: ${(e as Error).message}`);
    }
  }
  return result;
}

async function migrateLlmCache(db: Database.Database, surreal: Surreal) {
  const result: MigrationResult = { table: 'llm_cache', attempted: 0, succeeded: 0, failed: 0, errors: [] };
  const rows = db.prepare('SELECT * FROM llm_cache').all();
  result.attempted = rows.length;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    try {
      const data: SurrealRow = {
        question: r.question ?? null,
        question_embedding: toJSON<number[]>(r.question_embedding),
        answer: r.answer ?? null,
        sources: toJSON<string[]>(r.sources) ?? [],
        tool_calls: toJSON<unknown[]>(r.tool_calls)?.map((t) => (typeof t === 'string' ? t : JSON.stringify(t))) ?? [],
        created_at: toDate(r.created_at) ?? new Date(),
      };
      if (r.message_id) data.message_id = new RecordId('messages', String(r.message_id));
      await surreal.create(new Table('llm_cache')).content(data);
      result.succeeded++;
    } catch (e) {
      result.failed++;
      result.errors.push(`id=${r.id}: ${(e as Error).message}`);
    }
  }
  return result;
}

async function migrateFeatureTours(db: Database.Database, surreal: Surreal) {
  const result: MigrationResult = { table: 'feature_tours', attempted: 0, succeeded: 0, failed: 0, errors: [] };
  const rows = db.prepare('SELECT * FROM feature_tours').all();
  result.attempted = rows.length;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    try {
      const compositeId = `${r.user_id}:${r.feature_id}`;
      await surreal.create(new RecordId('feature_tours', compositeId)).content({
        feature_id: String(r.feature_id),
        dismissed_at: toDate(r.dismissed_at) ?? new Date(),
      });

      // Create has_tour edge: users → feature_tours
      if (r.user_id) {
        try {
          await surreal.relate(
            new RecordId('users', String(r.user_id)),
            new Table('has_tour'),
            new RecordId('feature_tours', compositeId),
            { created_at: new Date() },
          );
        } catch (edgeErr) {
          console.warn(
            `Failed to create has_tour edge for user ${r.user_id}, tour ${r.feature_id}: ${(edgeErr as Error).message}`,
          );
        }
      }

      result.succeeded++;
    } catch (e) {
      result.failed++;
      result.errors.push(`user=${r.user_id},feature=${r.feature_id}: ${(e as Error).message}`);
    }
  }
  return result;
}

async function migrateChunks(db: Database.Database, surreal: Surreal) {
  const result: MigrationResult = { table: 'chunks', attempted: 0, succeeded: 0, failed: 0, errors: [] };
  const rows = db.prepare('SELECT * FROM chunks').all();
  result.attempted = rows.length;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    try {
      const data: SurrealRow = {
        chunk_id: r.chunk_id ?? null,
        slug: r.chunk_id ?? null,
        text: r.text ?? null,
        title: r.title ?? null,
        date: r.date ?? null,
        tags: toJSON<string[]>(r.tags),
        section: r.section ?? null,
        embedding: toJSON<number[]>(r.embedding),
        type: r.type ?? null,
      };
      await surreal.create(new RecordId('chunks', String(r.chunk_id ?? r.id))).content(data);
      result.succeeded++;
    } catch (e) {
      result.failed++;
      result.errors.push(`id=${r.id}: ${(e as Error).message}`);
    }
  }
  return result;
}

async function migrateRateLimits(db: Database.Database, surreal: Surreal) {
  const result: MigrationResult = { table: 'rate_limits', attempted: 0, succeeded: 0, failed: 0, errors: [] };
  const rows = db.prepare('SELECT * FROM rate_limits').all();
  result.attempted = rows.length;

  for (const row of rows) {
    const r = row as Record<string, unknown>;
    try {
      await surreal.create(new Table('rate_limits')).content({
        ip: r.ip ?? null,
        timestamp: toDate(r.timestamp) ?? new Date(),
      });
      result.succeeded++;
    } catch (e) {
      result.failed++;
      result.errors.push(`id=${r.id}: ${(e as Error).message}`);
    }
  }
  return result;
}

async function migrateCentroids(db: Database.Database, surreal: Surreal): Promise<MigrationResult> {
  // Use pre-computed centroids from JSON (authoritative, avoids float drift)
  // Only migrate the 3 classes consumers actually use (tool, rag, meta)
  const allowedClasses: QueryClass[] = ['tool', 'rag', 'meta'];
  const centroidEntries = Object.entries(centroidData.centroids).filter(([k]) =>
    (allowedClasses as string[]).includes(k),
  );

  // Compute hashes matching build-index.ts centroidHashForClass():
  // SHA256(JSON.stringify({ queries: seed_queries_for_class, model, dims }))
  const hashes: Record<string, string> = {};
  for (const cls of allowedClasses) {
    const qs = SEED_QUERIES.filter((q) => q.class === cls);
    const data = JSON.stringify({ queries: qs, model: centroidData.model, dims: centroidData.dimensions });
    hashes[cls] = createHash('sha256').update(data).digest('hex');
  }

  const result: MigrationResult = {
    table: 'centroids',
    attempted: centroidEntries.length,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  for (const [cls, vector] of centroidEntries) {
    try {
      // DELETE needs string interpolation (SurrealDB 2.x doesn't allow $param in record ID position)
      // INSERT uses parameterized queries (safe)
      await surreal.query(
        `DELETE centroids:${cls};
         INSERT INTO centroids (id, class, vector, dims, model, hash)
         VALUES (centroids:${cls}, $class, $vector, $dims, $model, $hash);`,
        {
          class: cls,
          vector,
          dims: centroidData.dimensions,
          model: centroidData.model,
          hash: hashes[cls],
        },
      );
      result.succeeded++;
    } catch (e) {
      result.failed++;
      result.errors.push(`class=${cls}: ${(e as Error).message}`);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const MIGRATION_ORDER = [
  migrateUserAgents,
  migrateModels,
  migrateUsers,
  migratePageExperience,
  migratePagePosts,
  migrateChats,
  migrateMessages,
  migrateToolCalls,
  migrateReactions,
  migrateChatEvents,
  migrateLeads,
  migrateContactIntents,
  migrateLlmCache,
  migrateFeatureTours,
  migrateChunks,
  migrateRateLimits,
  migrateCentroids,
] as const;

async function main() {
  console.log('=== SQLite → SurrealDB Data Migration ===\n');
  console.log(`SQLite: './prod/woss.db'`);
  console.log(`SurrealDB: ws://localhost:10101 (ns:woss, db:woss)\n`);

  const sqlite = new Database('./prod/woss.db', { readonly: true, fileMustExist: true });

  let surreal: Surreal | null = null;
  try {
    surreal = await initSurreal();
    console.log('Connected to SurrealDB.\n');
  } catch (e) {
    console.error('Failed to connect to SurrealDB:', (e as Error).message);
    sqlite.close();
    process.exit(1);
  }

  const results: MigrationResult[] = [];

  for (const migrateFn of MIGRATION_ORDER) {
    const tableName = migrateFn.name
      .replace('migrate', '')
      .replace(/([A-Z])/g, '_$1')
      .toLowerCase()
      .replace(/^_/, '');
    console.log(`--- Migrating ${tableName} ---`);

    const result = await migrateFn(sqlite, surreal);
    results.push(result);

    console.log(`  ${result.succeeded}/${result.attempted} succeeded`);
    if (result.failed > 0) {
      console.log(`  ${result.failed} FAILED`);
      for (const err of result.errors.slice(0, 5)) {
        console.log(`    ${err}`);
      }
      if (result.errors.length > 5) {
        console.log(`    ... and ${result.errors.length - 5} more errors`);
      }
    }
    console.log('');
  }

  // Summary
  console.log('=== Migration Summary ===\n');

  let totalAttempted = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;

  for (const r of results) {
    totalAttempted += r.attempted;
    totalSucceeded += r.succeeded;
    totalFailed += r.failed;
    const status = r.failed === 0 ? '✓' : '✗';
    console.log(
      `  ${status} ${r.table.padEnd(20)} ${String(r.succeeded).padStart(5)}/${String(r.attempted).padStart(5)} ${r.failed > 0 ? `(${r.failed} failed)` : ''}`,
    );
  }

  console.log(`\n  Total: ${totalSucceeded}/${totalAttempted} succeeded, ${totalFailed} failed\n`);

  sqlite.close();
  await closeSurreal();

  if (totalFailed > 0) {
    console.log('Migration completed with errors. Review the output above.');
    process.exit(1);
  } else {
    console.log('Migration completed successfully.');
  }
}

main().catch((e) => {
  console.error('Migration failed:', (e as Error).message);
  process.exit(1);
});
