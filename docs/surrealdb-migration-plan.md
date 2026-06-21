# SurrealDB Migration Plan

**Goal:** Replace `better-sqlite3` + USearch with SurrealDB JS SDK. Single DB
service (`$lib/server/db`) with typed interfaces for future swapability.

## Current Stack (12 tables, ~910 lines db.ts)

- **DB:** better-sqlite3 (sync, embedded)
- **Vector search:** USearch (2 indices — woss.usearch 1024-dim RAG chunks,
  cache.usearch 1024-dim LLM cache)
- **Build index:** tsx script, reads markdown → chunks → embeds → SQLite + USearch
- **Consumer files:** 26 route/service files + 5 raw getDb() users (rate-limiter,
  llm-cache, generate.ts, build-index.ts, api/ask/+server)

## Target Stack

- **DB:** SurrealDB (async, network, document-native)
- **Vector search:** SurrealDB native ANN (DEFINE INDEX ... ANN TYPE mlas
  DISTANCE cosine) — eliminates USearch entirely
- **DB service:** $lib/server/db as typed interface + SurrealDatabaseService
  implementation

## Phase 1 — Setup (1.5 hrs)

- `pnpm add surrealdb.js`
- SurrealDB for dev:
  - Docker: `docker run -p 8000:8000 surrealdb/surrealdb start --log trace
--user root --pass root`
  - Or binary: `surreal start --log trace --user root --pass root`
- `.env` additions:
  - `SURREAL_DB_URL=http://localhost:8000`
  - `SURREAL_DB_USER=root`
  - `SURREAL_DB_PASS=root`
  - `SURREAL_DB_NS=woss`
  - `SURREAL_DB_DB=woss`
- Create `src/scripts/migrate.surql` — full schema DEFINE TABLE/DEFINE FIELD
  for all 15 tables with typed fields, record links, and ANN indices

## Phase 2 — Schema (1 hr)

### src/scripts/migrate.surql

15 SurrealDB tables matching SQLite schema:

| #   | SurrealDB table | FKs (record links)                                                  | Indices                                          |
| --- | --------------- | ------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | chunks          | —                                                                   | ANN on embedding, FTS on text                    |
| 2   | users           | —                                                                   | UNIQUE on email                                  |
| 3   | chats           | user_id→users, user_agent_id→agents                                 | —                                                |
| 4   | messages        | user_id→users, chat_id→chats, model_id→models, user_agent_id→agents | —                                                |
| 5   | models          | —                                                                   | UNIQUE (provider, model_name, actual_model_name) |
| 6   | reactions       | message_id→messages, user_id→users                                  | UNIQUE (message_id, user_id)                     |
| 7   | tool_calls      | message_id→messages                                                 | —                                                |
| 8   | chat_events     | chat_id→chats                                                       | —                                                |
| 9   | page_posts      | part_of_series→page_posts (self-ref)                                | UNIQUE on slug                                   |
| 10  | page_experience | —                                                                   | —                                                |
| 11  | llm_cache       | message_id→messages (optional)                                      | ANN on question_embedding                        |
| 12  | leads           | user_id→users                                                       | —                                                |
| 13  | contact_intents | user_id→users, chat_id→chats                                        | —                                                |
| 14  | user_agents     | —                                                                   | UNIQUE on ua                                     |
| 15  | rate_limits     | —                                                                   | —                                                |

Key SurrealDB type mappings:

| SQLite              | SurrealDB                |
| ------------------- | ------------------------ |
| INTEGER PRIMARY KEY | auto-generated record ID |
| TEXT                | string                   |
| INTEGER (bool)      | bool                     |
| REAL                | float                    |
| TEXT (datetime)     | datetime                 |
| TEXT (JSON array)   | array\<string\>          |
| TEXT (embedding)    | array\<float\>           |
| FOREIGN KEY         | record\<linked_table\>   |
| UNIQUE constraint   | DEFINE INDEX ... UNIQUE  |
| DEFAULT value       | DEFAULT value            |
| DATETIME('now')     | DEFAULT now()            |

### Vector Search (replaces both USearch indices)

```surql
DEFINE INDEX idx_chunks_embedding ON chunks FIELDS embedding
  ANN TYPE mlas DISTANCE cosine;

DEFINE INDEX idx_cache_embedding ON llm_cache FIELDS question_embedding
  ANN TYPE mlas DISTANCE cosine;
```

Chunks table additionally has FTS for text search:

```surql
DEFINE INDEX idx_chunks_fts ON chunks FIELDS text
  FT WITH analyzation DEFAULT;
```

## Phase 3 — Database Service Layer (5-6 hrs)

### 3a. Connection Manager

`src/lib/server/db/surreal.ts` — SurrealDB client singleton:

- `initSurreal(opts?)` — connect using env vars (NS/DB scope)
- `getSurreal()` — return singleton, throw if not initialized
- `closeSurreal()` — disconnect
- Env adapter pattern for SvelteKit-free init (used by build-index.ts)

### 3b. Repository Interfaces

`src/lib/server/db/interfaces.ts` — typed interfaces matching current function
signatures but async:

```typescript
export interface IUserRepo {
  getOrCreateUser(githubUser: GithubUser): Promise<User>;
  getUserByGithubId(githubId: number): Promise<User | null>;
  getUser(id: string): Promise<User | null>;
  updateUser(id: string, updates: Partial<User>): Promise<void>;
}

export interface IChatRepo {
  createChat(userId: string, opts?: ChatOpts): Promise<Chat>;
  getChats(userId: string): Promise<Chat[]>;
  getChat(id: string): Promise<Chat | null>;
  updateChat(id: string, updates: Partial<Chat>): Promise<void>;
  deleteChat(id: string): Promise<void>;
  hardDeleteOldChats(cutoff: Date): Promise<number>;
  ensureChat(id: string, userId: string, userAgentId?: string): Promise<Chat>;
}

export interface IMessageRepo {
  getMessages(chatId: string): Promise<Message[]>;
  addMessage(msg: NewMessage): Promise<Message>;
  getLastMessagesCount(chatId: string, count: number): Promise<Message[]>;
  hardDeleteOldMessages(cutoff: Date): Promise<number>;
  setAssistantMessageContent(id: string, content: string): Promise<void>;
  getChatSummaryForApi(chatId: string): Promise<ChatSummary>;
}

export interface IEventRepo {
  /* insertEvent, getEvents */
}
export interface IReactionRepo {
  /* upsertReaction, removeReaction, getReaction */
}
export interface IToolCallRepo {
  /* getToolCalls, getToolCall, insertToolCall, updateToolCall */
}
export interface IContentRepo {
  /* getRelatedBusinessPages, getPosts, getExperiences, searchChunks */
}
export interface ILeadRepo {
  /* createLead */
}
export interface IContactIntentRepo {
  /* createContactIntent */
}
export interface IUserAgentRepo {
  /* getOrCreateUserAgent, getUserAgents */
}
export interface ILlmCacheRepo {
  /* getCached, setCached, getCacheStats */
}
export interface IRateLimitRepo {
  /* getRateLimit, incrementRateLimit, resetRateLimit */
}
export interface IVectorRepo {
  /* searchChunks, searchCache */
}

export interface IDatabaseService
  extends
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
    IVectorRepo {
  init(): Promise<void>;
  close(): Promise<void>;
  transaction<T>(fn: (tx: IDatabaseService) => Promise<T>): Promise<T>;
}
```

### 3c. SurrealDatabaseService Implementation

`src/lib/server/db/surreal-service.ts` — implements IDatabaseService using
SurrealQL queries via surrealdb.js SDK:

```typescript
export class SurrealDatabaseService implements IDatabaseService {
  private db: Surreal;
  private initialized = false;

  async init(opts?: { url: string; user: string; pass: string; ns: string; db: string }): Promise<void> {
    this.db = new Surreal();
    await this.db.connect(opts?.url ?? process.env.SURREAL_DB_URL!);
    await this.db.signin({
      user: opts?.user ?? process.env.SURREAL_DB_USER!,
      pass: opts?.pass ?? process.env.SURREAL_DB_PASS!,
    });
    await this.db.use({
      ns: opts?.ns ?? process.env.SURREAL_DB_NS!,
      db: opts?.db ?? process.env.SURREAL_DB_DB!,
    });
    this.initialized = true;
  }

  async close(): Promise<void> {
    if (this.initialized) await this.db.close();
    this.initialized = false;
  }

  // User operations
  async getOrCreateUser(githubUser: GithubUser): Promise<User> {
    const [result] = await this.db.query<[User[]]>('SELECT * FROM users WHERE email = $email', {
      email: githubUser.email,
    });
    if (result.length > 0) return result[0];
    const [created] = await this.db.create('users', {
      id: crypto.randomUUID(),
      email: githubUser.email,
      name: githubUser.name,
    });
    return created;
  }

  // ... all remaining methods follow same pattern
}
```

Key SurrealQL patterns:

- `CREATE/DELETE/UPSERT` for CRUD
- `SELECT ... WHERE ...` for queries
- `UPDATE ... SET ... WHERE ...` for mutations
- `RETURN AFTER` for INSERT-style operations
- `array<record<chunks>>` for message sources
- `vector::distance()` for inline vector ops (debugging)

### 3d. New db.ts entry point

`src/lib/server/db/index.ts` — re-exports SurrealDatabaseService singleton:

```typescript
import { SurrealDatabaseService } from './surreal-service';

export const db = new SurrealDatabaseService();
export type { IDatabaseService } from './interfaces';
```

All 26 consumer files use `import { db } from '$lib/server/db'` — same import
path as before. Import changes are zero — only `await` additions needed per
call site.

### 3e. Transaction Abstraction

Added to IDatabaseService:

```typescript
export interface IDatabaseService {
  transaction<T>(fn: (tx: IDatabaseService) => Promise<T>): Promise<T>;
}
```

SurrealDB transactions use SurrealQL `BEGIN TRANSSACTION; ... COMMIT;` via
raw query. The transaction callback receives a scoped service instance that
shares the same SurrealDB connection.

## Phase 4 — Consumer Refactoring (3-4 hrs)

### 26 route files + 4 service modules

Add `await` to all function calls from db.ts. No structural changes beyond
that — same function names, same arguments, same return shapes.

Example conversions:

```typescript
// Before (sync):
const user = createUser(githubUser);
const chat = getChat(chatId);
const messages = getMessages(chatId);

// After (async):
const user = await db.createUser(githubUser);
const chat = await db.getChat(chatId);
const messages = await db.getMessages(chatId);
```

### 5 raw getDb() users

| File            | Current pattern      | New pattern                           |
| --------------- | -------------------- | ------------------------------------- |
| rate-limiter.ts | getDb().prepare(...) | db.getRateLimit() / increment / reset |
| llm-cache.ts    | getDb().prepare(...) | db.getCached() / setCached()          |
| generate.ts     | db = getDb()         | Injected SurrealDatabaseService       |
| build-index.ts  | getDb() + USearch    | SurrealDatabaseService + native ANN   |
| api/ask/+server | getDb()              | `import { db } from '$lib/server/db'` |

#### build-index.ts Rewrite

Env adapter pattern (same as logger fix):

```typescript
// src/scripts/build-index.ts
import { SurrealDatabaseService } from '../lib/server/db/surreal-service';

async function buildIndex(): Promise<void> {
  const db = new SurrealDatabaseService();
  await db.init({
    url: process.env.SURREAL_DB_URL!,
    user: process.env.SURREAL_DB_USER!,
    pass: process.env.SURREAL_DB_PASS!,
    ns: process.env.SURREAL_DB_NS!,
    db: process.env.SURREAL_DB_DB!,
  });

  // Phase 1: Read markdown, parse frontmatter (same as before)
  // Phase 2: Chunk + embed (same embedTexts call)
  // Phase 3: UPSERT into SurrealDB chunks table
  // Phase 4: Two-pass series resolution (same logic, SurrealQL instead of SQL)
  // Phase 5: No USearch — vector index auto-maintained by SurrealDB

  await db.close();
}
```

No USearch rebuild step — SurrealDB's ANN index is automatically maintained
as documents are created/updated/deleted. Removes ~100 lines of USearch
rebuild code.

#### USearch Removal

- `pnpm rm usearch`
- Delete `data/woss.usearch`, `data/cache.usearch`
- Remove USearch import, index.save(), index.add(), BigInt key generation
- Remove `ChunkRow.embedding` JSON serialization — SurrealDB stores
  `array<float>` directly

## Phase 5 — Data Migration (1-2 hrs)

### Migration Script: `src/scripts/migrate-to-surreal.ts`

```typescript
import Database from 'better-sqlite3';
import { SurrealDatabaseService } from '../lib/server/db/surreal-service';

async function migrate() {
  const sqlite = new Database('data/woss.db');

  // 1. Read all data from SQLite
  const tables = ['users', 'chats', 'messages', 'models', 'reactions',
    'tool_calls', 'chat_events', 'page_posts', 'page_experience',
    'llm_cache', 'leads', 'contact_intents', 'user_agents',
    'chunks', 'rate_limits'] as const;

  // 2. For each table, SELECT * and translate to SurrealDB document format
  //    - Parse JSON strings (tags, sources, embedding)
  //    - Map rows to SurrealDB records with record links
  //    - Handle self-references (page_posts.part_of_series) in two-pass

  const db = new SurrealDatabaseService();
  await db.init({ ... });

  for (const table of tables) {
    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
    for (const row of rows) {
      const doc = translateRow(table, row);
      await db.getSurreal().upsert(`${table}:${row.id}`, doc);
    }
  }

  // 3. Verify row counts match
  for (const table of tables) {
    const [result] = await db.getSurreal().query<[number[]]>(
      `SELECT count() AS count FROM ${table} GROUP BY count`
    );
    const sqliteCount = rowsByTable[table].length;
    console.log(`${table}: SQLite=${sqliteCount} SurrealDB=${result[0]?.count ?? 0}`);
  }

  await db.close();
  sqlite.close();
}
```

Run: `tsx src/scripts/migrate-to-surreal.ts`

### Validation

- Run migration script
- Compare row counts per table
- Test ANN search returns expected chunks
- Verify all routes return 200
- Snapshot `data/woss.db` before running

---

## Effort Summary

| Phase     | Task                           | Time        | Dependencies       |
| --------- | ------------------------------ | ----------- | ------------------ |
| 1         | Setup + migrate.surql          | 1.5 hrs     | —                  |
| 2         | Schema definition              | 1 hr        | Phase 1            |
| 3a        | SurrealDB client singleton     | 0.5 hr      | Phase 2            |
| 3b        | Repository interfaces          | 1 hr        | — (parallel to 3a) |
| 3c        | SurrealDatabaseService (30 fn) | 3-4 hrs     | Phase 3a + 3b      |
| 3d        | db/index.ts entry point        | 0.25 hr     | Phase 3c           |
| 4         | Consumer refactoring (26+5)    | 3-4 hrs     | Phase 3d           |
| 5         | Data migration + validation    | 1-2 hrs     | Phase 4            |
| **Total** |                                | **~12 hrs** | (2 full days)      |

**Parallelizable:** Phases 1-2 linear, Phase 3a+3b parallel, Phase 3c linear,
Phase 4 parallelizable across files, Phase 5 linear.

---

## Key Risks & Mitigations

| Risk                               | Mitigation                                                  |
| ---------------------------------- | ----------------------------------------------------------- |
| SurrealDB ANN index != USearch KNN | Benchmark top-N recall before cutover                       |
| Async conversion introduces bugs   | Every consumer file must add `await` — test per route       |
| build-index.ts env adapter fails   | Use same pattern as logger fix (env vars passed explicitly) |
| Migration loses data               | Snapshot `data/woss.db` before migration                    |
| SurrealDB network latency          | SurrealDatabaseService uses connection pool, keep-alive     |
| No SurrealDB experience in team    | Start with simple queries, use raw SurrealQL in repos       |

---

## Open Decisions

1. **Async in interface now or later?** — Interfaces already async (network
   DB needs it). Consumers add `await` now during refactoring.

2. **Rate limiter: merge or inject?** — Merge into service via
   IRateLimitRepo. Keeps single entry point.

3. **build-index.ts env adapter** — Same fix as logger: pass env vars
   explicitly rather than relying on `$env/static/private`.

4. **Transaction scope** — Add `transaction<T>()` to IDatabaseService now.
   SurrealDB supports transactions via raw SurrealQL.
