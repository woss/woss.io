# Sequelize Migration Plan

**Goal:** Replace raw `better-sqlite3` SQL queries with Sequelize ORM across the full stack. No backward compatibility — rewrite in place.

**Current state (15 tables, ~31 consumer files):**

- 15 tables: `users`, `chats`, `messages`, `models`, `chat_events`, `reactions`, `tool_calls`, `leads`, `contact_intents`, `user_agents`, `chunks`, `page_posts`, `page_experience`, `llm_cache`, `rate_limits`
- Raw SQL via `better-sqlite3` in `src/lib/server/db.ts` (32 exported functions)
- 24 route files + 4 server modules + 1 build script = 29 consumers
- No migration system — `CREATE TABLE IF NOT EXISTS` in `schema.ts` + manual `migrate.sql`
- USearch for vector search (KNN) — stays independent

**What Sequelize brings:**

- Typed models (`InferAttributes` / `InferCreationAttributes`)
- Associations (HasMany, BelongsTo, etc.) — no manual JOINs
- Built-in validations at model level
- Migration CLI (`sequelize-cli`) with `up`/`down`
- Transaction support
- `paranoid: true` (soft-delete) — drop manual `deleted_at` checks
- Query builder — no raw SQL strings

---

## Phase 1: Setup

- `pnpm add sequelize sequelize-cli sqlite3`
- `pnpm add -D @types/sequelize` (if needed)
- Create `.sequelizerc` with paths:
  - `config`: `config/`
  - `models`: `src/lib/server/db/models/`
  - `migrations`: `src/lib/server/db/migrations/`
  - `seeders`: `src/lib/server/db/seeders/`
- Create `config/config.json` with SQLite dialect + storage path (`data/woss.db`)
- Create `src/lib/server/db/sequelize.ts` — initializes Sequelize instance, exports it

## Phase 2: Models + Initial Migration

### 2a. Model files (15)

Place under `src/lib/server/db/models/`. Each extends `Model<InferAttributes<T>, InferCreationAttributes<T>>`.

| Model            | Table             | Key Associations                                                    |
| ---------------- | ----------------- | ------------------------------------------------------------------- |
| `User`           | `users`           | hasMany Chat, hasMany Reaction, hasMany Lead, hasMany ContactIntent |
| `Chat`           | `chats`           | belongsTo User, hasMany Message, hasMany ChatEvent                  |
| `Message`        | `messages`        | belongsTo Chat, belongsTo Model, hasMany Reaction, hasMany ToolCall |
| `Model`          | `models`          | hasMany Message                                                     |
| `ChatEvent`      | `chat_events`     | belongsTo Chat                                                      |
| `Reaction`       | `reactions`       | belongsTo Message, belongsTo User                                   |
| `ToolCall`       | `tool_calls`      | belongsTo Message                                                   |
| `Lead`           | `leads`           | belongsTo User                                                      |
| `ContactIntent`  | `contact_intents` | belongsTo User                                                      |
| `UserAgent`      | `user_agents`     | standalone (no FK)                                                  |
| `Chunk`          | `chunks`          | standalone (metadata — vector search via USearch)                   |
| `PagePost`       | `page_posts`      | standalone                                                          |
| `PageExperience` | `page_experience` | standalone                                                          |
| `LlmCache`       | `llm_cache`       | standalone                                                          |
| `RateLimit`      | `rate_limits`     | standalone                                                          |

### 2b. Associations

Register in a `src/lib/server/db/associations.ts` file, imported after models. Covers:

- `User.hasMany(Chat)`, `Chat.belongsTo(User)`
- `Chat.hasMany(Message)`, `Message.belongsTo(Chat)`
- `Chat.hasMany(ChatEvent)`, `ChatEvent.belongsTo(Chat)`
- `Message.belongsTo(Model)`, `Model.hasMany(Message)`
- `Message.hasMany(Reaction)`, `Reaction.belongsTo(Message)` + `Reaction.belongsTo(User)`
- `Message.hasMany(ToolCall)`, `ToolCall.belongsTo(Message)`
- `User.hasMany(Lead)`, `Lead.belongsTo(User)`
- `User.hasMany(ContactIntent)`, `ContactIntent.belongsTo(User)`

### 2c. Initial Migration

Generate via `npx sequelize-cli migration:generate --name create-all-tables`.

One migration file creating all 15 tables with:

- All columns matching current schema (types, defaults, nullability)
- Foreign key constraints matching associations above
- Indexes on FKs, `session_id`, `state`, timestamps
- `paranoid: true` columns (`deleted_at`) on `chats`, `messages`
- `down` migration that drops all tables

Apply with `npx sequelize-cli db:migrate`.

Remove current `src/lib/server/db/schema.ts` (auto-DDL) and `src/scripts/migrate.sql`.

## Phase 3: Replace Service Layer

Rewrite `src/lib/server/db.ts` (32 exported functions) into organized service modules.

### Module structure

- `src/lib/server/db/users.ts` — `createUser`, `getUserByGithubId`, `getUser`, `updateUser`
- `src/lib/server/db/chats.ts` — `createChat`, `getChats`, `getChat`, `updateChat`, `deleteChat`, `hardDeleteOldChats`
- `src/lib/server/db/messages.ts` — `getMessages`, `addMessage`, `getLastMessagesCount`, `hardDeleteOldMessages`, `setAssistantMessageContent`, `getChatSummaryForApi`
- `src/lib/server/db/events.ts` — `insertEvent`, `getEvents`
- `src/lib/server/db/reactions.ts` — `upsertReaction`, `removeReaction`, `getReaction`
- `src/lib/server/db/tools.ts` — `getToolCalls`, `getToolCall`, `insertToolCall`, `updateToolCall`
- `src/lib/server/db/content.ts` — `getRelatedBusinessPages`, `getPagePosts`, `getPageExperiences`, `searchChunks` (metadata only, USearch keeps KNN)
- `src/lib/server/db/leads.ts` — `createLead`
- `src/lib/server/db/contact-intents.ts` — `createContactIntent`
- `src/lib/server/db/agents.ts` — `getOrCreateUserAgent`, `getUserAgents`, etc.
- `src/lib/server/db/cache.ts` — `getCached`, `setCached`, `getCacheStats`
- `src/lib/server/db/rate-limits.ts` — `getRateLimit`, `incrementRateLimit`, `resetRateLimit`

### Complex query handling

| Current function                          | Sequelize approach                                                         |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| `addMessage` cascade logic                | Transaction with `Chat.update({messageCount})` after `Message.create`      |
| `getOrCreateUserAgent`                    | `Model.findOrCreate({ where: { hash } })`                                  |
| `searchChunks` (vector + metadata filter) | USearch returns IDs → `Chunk.findAll({ where: { id: ids, ... } })`         |
| `getChatSummaryForApi`                    | Eager loading: `Chat.findByPk(id, { include: [Message, Model] })`          |
| `upsertReaction`                          | `Reaction.findOrCreate` or manual upsert with `ON CONFLICT`                |
| `hardDeleteOldChats`                      | `Chat.destroy({ where: { deletedAt: { [Op.lt]: cutoff } }, force: true })` |

### Transaction pattern

Wrap multi-step operations (e.g., `addMessage`) in `sequelize.transaction()`:

```ts
const result = await sequelize.transaction(async (t) => {
  const message = await Message.create({ ... }, { transaction: t });
  await Chat.increment('message_count', { by: 1, where: { id: chatId }, transaction: t });
  return message;
});
```

## Phase 4: Update Consumer Files

### 24 route files

Mostly import swaps — `import { getMessages } from '$lib/server/db'` → `import { getMessages } from '$lib/server/db/messages'`.

Route files by group:

- `/chat/*` routes → `chats.ts`, `messages.ts`, `events.ts`, `reactions.ts`, `tools.ts`
- `/api/*` routes → `users.ts`, `leads.ts`, `contact-intents.ts`
- `/sitemap.xml` → `content.ts`
- `/rss.xml` → `content.ts`

### 4 server modules

- `rate-limiter.ts` → `rate-limits.ts`
- `llm-cache.ts` → `cache.ts`
- `generate.ts` (already uses db.ts) → service modules
- `chat-helpers.ts` → service modules

### 1 build script

- `build-index.ts` → needs `import { Sequelize } from 'sequelize'` and custom initialization (outside SvelteKit). Use env adapter pattern (same as logger fix) or pass env vars explicitly.

## Phase 5: Cleanup

- Remove `better-sqlite3` from `package.json`
- Remove `@types/better-sqlite3`
- Remove `src/lib/server/db.ts` (old functions)
- Remove `src/lib/server/db/schema.ts`
- Remove `src/scripts/migrate.sql`
- Remove manual DB init (`getDb()`, WAL pragma, connection cleanup)
- Verify `pnpm build` passes
- Verify `pnpm build-index` passes

---

## Key Considerations

| Challenge                                   | Approach                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| USearch vector index                        | Stays independent — Sequelize handles metadata queries, USearch KNN                          |
| `better-sqlite3` sync API → Sequelize async | All callers already handle Promises in routes — minimal impact                               |
| `paranoid: true` soft delete                | Drop manual `deleted_at IS NULL` checks in 5+ files — use `{ paranoid: false }` where needed |
| `addMessage` cascade in transaction         | Preserve logic in service method, use `sequelize.transaction()`                              |
| Build script env                            | Same `$env` issue as logger — use env adapter or pass vars explicitly                        |
| Raw SQL views / aggregates                  | Replace with `Model.findAll({ attributes: [fn, col] })`                                      |
| Migration order (prod DB)                   | `sequelize-cli` handles ordering; snapshot DB before first run                               |
