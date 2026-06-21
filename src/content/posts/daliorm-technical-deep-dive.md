---
published: true
title: 'DaliORM: Technical Deep Dive into Our Type-Safe Migration System for SurrealDB'
slug: 'daliorm-technical-deep-dive'
description: 'Technical architecture of DaliORM — a type-safe migration system for SurrealDB. CLI commands, programmatic API, and schema management with a migration-first approach.'
date: 2026-06-07
featured: true
tags:
  - DaliORM
  - SurrealDB
  - database migrations
  - schema management
  - TypeScript ORM
  - CLI tools
  - programmatic API
  - database schema
  - database tools
  - migration system
  - dali
audience: developers

header_image: '[DaliORM logo](https://u.macula.link/OhwxSXORQUCgirpGcMJfDg-7?preset=sys_lg)'
---

This is a technical reference for developers who already know DaliORM from the [announcement post](./daliorm-announcement). It covers the migration system architecture, CLI command design, schema definition APIs, programmatic integration, and the DDL layer that powers everything.

## Quick Start

```typescript
// schema.ts
import { defineTable } from '@woss/dali-orm/sdk/table';
import { string, int, bool, datetime } from '@woss/dali-orm/sdk/schema/column';

export const users = defineTable(
  'user',
  {
    id: string('id'),
    email: string('email').unique(),
    name: string('name'),
    created_at: datetime('created_at').default('now'),
  },
  {
    indexes: [{ name: 'email_idx', fields: ['email'], type: 'unique' }],
  },
);

export default { users };
```

```bash
# Generate migration from schema
npx dali-orm generate add_users_table

# Apply migrations
npx dali-orm migrate up

# Check status
npx dali-orm migrate status
```

## Installation

```bash
# Using pnpm (recommended for monorepo)
pnpm add @woss/dali-orm

# Using npm
npm install @woss/dali-orm

# Using bun
bun add @woss/dali-orm
```

Requirements:

- Node.js >= 18
- SurrealDB >= 2.0

## CLI Commands

### migrate

Manage database migrations with subcommands: `dev`, `deploy`, `up`, `down`, `reset`, `status`, `resume`.

```bash
# Dev workflow — generate migration + validate on shadow + apply to target
npx dali-orm migrate dev add_users_table

# Deploy to production — validate pending on shadow + apply (REQUIRES shadow config)
npx dali-orm migrate deploy

# Show migration status
npx dali-orm migrate status

# Apply all pending migrations
npx dali-orm migrate up

# Apply up to specific version
npx dali-orm migrate up --to 20240101_init

# Rollback last migration
npx dali-orm migrate down

# Rollback N steps
npx dali-orm migrate down --steps 2

# Rollback all migrations
npx dali-orm migrate reset

# Resume interrupted migration
npx dali-orm migrate resume
```

**Options:**

- `-c, --config <path>` - Config file path
- `-n, --dry-run` - Show what would be done
- `-f, --force` - Skip confirmation prompts
- `--to <version>` - Target version for `up`
- `--steps <n>` - Number of steps for `down`

**Note:** `push` command removed. Use `migrate dev` or `migrate deploy` instead.

### generate

Generate migration files from schema definitions. Supports offline mode with snapshot comparison.

```bash
# Generate migration with name
npx dali-orm generate add_users_table

# Generate with explicit options
npx dali-orm generate add_email_field --schema ./schema --output ./migrations

# Offline mode (no database connection, uses snapshots)
npx dali-orm generate add_users_table --offline

# Use custom snapshot directory
npx dali-orm generate add_users_table --snapshots ./meta/snapshots

# Force full migration (ignore snapshots)
npx dali-orm generate add_users_table --full
```

**Options:**

- `-m, --name <name>` - Migration name
- `-s, --schema <path>` - Schema file or directory
- `-o, --output <path>` - Output directory for migrations
- `--version <ver>` - Version number
- `--offline` - Skip database connection
- `--snapshots <dir>` - Snapshot directory (default: `./meta/snapshots`)
- `--full` - Generate full migration, ignore snapshots

### push

Push schema changes directly to database without creating migration files.

```bash
# Push schema changes
npx dali-orm push

# Dry run (show what would change)
npx dali-orm push --dry-run

# Force push (skip confirmations)
npx dali-orm push --force
```

### pull

Pull schema from database and write to schema file.

```bash
# Pull all tables
npx dali-orm pull

# Pull specific table
npx dali-orm pull users
```

### diff

Show schema differences between database and schema definitions.

```bash
# Show diff
npx dali-orm diff

# Verbose output
npx dali-orm diff --verbose
```

### query

Run raw SurrealQL queries against the database.

```bash
npx dali-orm query "SELECT * FROM user"
npx dali-orm query "CREATE user SET email = 'test@example.com'"
```

## Configuration

### dali-orm.config.ts

Create a config file in your project root:

```typescript
import type { OrmConfig } from '@woss/dali-orm/sdk/driver/config/types.js';

const config: OrmConfig = {
  url: 'ws://localhost:8000',
  namespace: 'myapp',
  database: 'mydb',
  auth: {
    type: 'root',
    username: 'root',
    password: 'root',
  },
  migrations: {
    dir: './migrations',
    table: '__migrations',
  },
  schema: {
    dir: './schema',
    pattern: 'schema.ts',
  },
  snapshots: {
    dir: './meta/snapshots',
  },
  shadow: {
    namespace: 'myapp_shadow',
    database: 'shadow_db',
  },
};

export default config;
```

### Environment Variables

```bash
# Database connection
SURREALDB_URL=ws://localhost:8000
SURREALDB_NAMESPACE=myapp
SURREALDB_DATABASE=mydb

# Authentication
SURREALDB_USERNAME=root
SURREALDB_PASSWORD=root
```

Configuration priority: CLI options > config file > environment variables.

## Schema Definition

### defineTable()

Define a normal table with columns and optional configuration:

```typescript
import { defineTable } from '@woss/dali-orm/sdk/table';
import { string, int, bool, datetime, array, object, record } from '@woss/dali-orm/sdk/schema/column';

export const posts = defineTable(
  'post',
  {
    id: string('id'),
    title: string('title'),
    content: string('content'),
    published: bool('published').default(false),
    tags: array('tags').optional(),
    author: record('user'),
    created_at: datetime('created_at').default('now'),
  },
  {
    indexes: [
      { name: 'author_idx', fields: ['author'] },
      { name: 'published_idx', fields: ['published'] },
    ],
    changefeed: '7d',
  },
);
```

### defineRelationTable()

Define relation tables for graph relationships:

```typescript
export const likes = defineRelationTable(
  'likes',
  {
    id: string('id'),
    created_at: datetime('created_at').default('now'),
  },
  {
    in: 'user',
    out: 'post',
    enforced: true,
  },
);
```

### Column Builders

| Builder                 | Type     | Example                                 |
| ----------------------- | -------- | --------------------------------------- |
| `string(name)`          | string   | `string('email').unique()`              |
| `int(name)`             | int      | `int('age').default(0)`                 |
| `float(name)`           | float    | `float('price')`                        |
| `bool(name)`            | bool     | `bool('active').default(true)`          |
| `datetime(name)`        | datetime | `datetime('created_at').default('now')` |
| `duration(name)`        | duration | `duration('timeout')`                   |
| `decimal(name)`         | decimal  | `decimal('amount', 10, 2)`              |
| `array(name)`           | array    | `array('tags').optional()`              |
| `object(name)`          | object   | `object('metadata')`                    |
| `record(table)`         | record   | `record('user')`                        |
| `uuid(name)`            | uuid     | `uuid('id')`                            |
| `geometry(name)`        | geometry | `geometry('location')`                  |
| `tuple(name, elements)` | tuple    | `tuple('coords', [float(), float()])`   |

### Chain Methods

```typescript
string('email')
  .unique() // UNIQUE constraint
  .optional() // option<string> type
  .default('anonymous') // DEFAULT value
  .readonly() // READONLY field
  .flexible() // FLEXIBLE field (schemaless)
  .assert('$value != ""'); // ASSERT expression
```

## Migration Workflow

### 1. Generate Migrations

Write your schema in `schema.ts`, then generate a migration:

```bash
npx dali-orm generate add_users_table
```

This creates a timestamped migration file in `./migrations/`:

```
migrations/
  20260505_add_users_table.surql
```

### 2. Review Migration

Open the generated `.surql` file. It contains `UP` and `DOWN` sections:

```sql
-- UP
DEFINE TABLE IF NOT EXISTS user SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS id ON TABLE user TYPE string;
DEFINE FIELD IF NOT EXISTS email ON TABLE user TYPE string UNIQUE;
DEFINE FIELD IF NOT EXISTS name ON TABLE user TYPE string;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE user TYPE datetime DEFAULT time::now();

-- DOWN
REMOVE TABLE user;
```

### 3. Apply Migrations

```bash
npx dali-orm migrate up
```

### 4. Rollback

```bash
# Rollback last migration
npx dali-orm migrate down

# Rollback all
npx dali-orm migrate reset
```

### Journal System (Resumable Migrations)

DaliORM uses a journal (`meta/_journal.json`) to track migration progress. If a migration fails midway, you can resume:

```bash
npx dali-orm migrate resume
```

The journal tracks per-statement checkpoints. If statement 3 of 5 fails, only statements 1-2 are kept, and statement 3 is retried on resume.

### Snapshot System (Drizzle-style)

Snapshots (`meta/snapshots/`) capture schema state after each migration. This enables incremental migration generation:

```bash
# First migration (no snapshot) - generates full schema
npx dali-orm generate init --offline

# Later migration (has snapshot) - generates only changes
npx dali-orm generate add_email_field --offline
```

## Programmatic API

### connect()

Connect to SurrealDB and get a `SurrealDriver`:

```typescript
import { connect } from '@woss/dali-orm/sdk/driver/orm-connection';

const driver = await connect({
  nodeDriver: {
    driver: 'node',
    url: 'ws://localhost:8000',
    namespace: 'myapp',
    database: 'mydb',
    auth: { type: 'root', username: 'root', password: 'root' },
  },
});

// Use driver methods
const users = await driver.select('user');
await driver.create('user', { email: 'test@example.com', name: 'Test' });
await driver.disconnect();
```

### MigrationRunner

Programmatic migration control:

```typescript
import { createRunner } from '@woss/dali-orm/migration/core/runner';

const runner = createRunner(driver, {
  migrationsDir: './migrations',
  journalDir: './meta',
  migrationsTable: '__migrations',
});

// Run pending migrations
const result = await runner.up();
console.log('Applied:', result.applied);

// Rollback
await runner.down(1);

// Status
const status = await runner.status();
console.log('Applied:', status.applied);
console.log('Pending:', status.pending);
```

### SchemaDiffer

Compare two schema states and generate SQL differences:

```typescript
import { SchemaDiffer } from '@woss/dali-orm/migration/core/diff';

const differ = new SchemaDiffer();
const { up, down } = differ.diff(existingTables, newTables);
```

### SurrealQLGenerator

Generate SurrealQL statements from table definitions:

```typescript
import { SurrealQLGenerator } from '@woss/dali-orm/migration/core/generator';

const generator = new SurrealQLGenerator();
const sql = generator.generateTableDefinition(table);
const fieldSql = generator.generateFieldDefinition(column);
```

### SnapshotManager

Manage schema snapshots incrementally:

```typescript
import { SnapshotManager } from '@woss/dali-orm/migration/core/snapshot';

const manager = new SnapshotManager({ dir: './meta/snapshots' });
await manager.saveSnapshot('20260505_init', tables, access);
const snapshot = await manager.loadSnapshot('20260505_init');
```

### introspectDatabase()

Introspect live database schema:

```typescript
import { introspectDatabase } from '@woss/dali-orm/migration/ddl/introspect';

const ddl = await introspectDatabase(driver, {
  exceptTables: ['_schemas'],
});
```

### ddlDiff()

Generate delta between two DDL states:

```typescript
import { ddlDiff } from '@woss/dali-orm/migration/ddl/diff';

const result = ddlDiff(oldDdl, newDdl, 'push');
console.log(result.statements); // SQL statements to apply
```

## Examples

### Todo App Migration Setup

See full example at `examples/todo-app/`.

**schema.ts:**

```typescript
import { defineTable, defineRelationTable } from '@woss/dali-orm/sdk/table';
import { string, bool, datetime, array, record } from '@woss/dali-orm/sdk/schema/column';

export const users = defineTable('user', {
  id: string('id'),
  email: string('email').unique(),
  password: string('password'),
  name: string('name'),
  created_at: datetime('created_at').default('now'),
});

export const todos = defineTable('todo', {
  id: string('id'),
  title: string('title'),
  completed: bool('completed').default(false),
  owner: record('user'),
  created_at: datetime('created_at').default('now'),
});

export const todoShare = defineRelationTable(
  'todo_share',
  {
    id: string('id'),
    role: string('role').default('viewer'),
  },
  {
    in: 'user',
    out: 'todo',
  },
);

export default { users, todos, todoShare };
```

**Generate and apply:**

```bash
cd examples/todo-app
npx dali-orm generate init
npx dali-orm migrate up
```

### Offline vs Live Generation

**Offline mode** (uses snapshots, no DB connection):

```bash
npx dali-orm generate add_feature --offline
```

**Live mode** (compares against database):

```bash
npx dali-orm generate add_feature
```

### Migrate Dev/Deploy Workflow

**Dev** — Generate migration, validate on shadow, apply to target:

```bash
npx dali-orm migrate dev add_users_table
```

**Deploy** — Validate pending on shadow, then apply (REQUIRES shadow config):

```bash
npx dali-orm migrate deploy
```

**Pull** — Export database schema:

```bash
npx dali-orm pull > schema.ts
```

**Note:** The old `push` command is removed. Use `migrate dev` or `migrate deploy` instead.

## Architecture

### Migration System

```
schema.ts → generate → .surql files → migrate → Database
                    ↓
              snapshots/ (incremental state)
              _journal.json (resumable tracking)
```

### DDL Layer

- `ddl/types.ts` - SurrealDB DDL type definitions
- `ddl/introspect.ts` - Database introspection (`INFO FOR TABLE`)
- `ddl/diff.ts` - Schema delta generation
- `ddl/convert.ts` - Convert between TableDefinition and SurrealDDL
- `ddl/journal.ts` - Migration journal management
- `ddl/schemas.ts` - Valibot schemas for DDL types

### Driver Layer

```
orm-connection.ts (connect() entry point)
    ↓
BaseDriver (shared logic)
    ├── NodeDriver (WebSocket connection)
    └── EmbeddedDriver (in-process connection)
```

**BaseDriver** provides: `query()`, `select()`, `create()`, `insert()`, `update()`, `delete()`, `upsert()`, `relate()`, `live()`, `kill()`, `transaction()`

**NodeDriver** specializes: `connect()` (WebSocket), `signin()`, `signup()`, `authenticate()`

**EmbeddedDriver** specializes: `connect()` (embedded), `transformDatetimeValues()` (recursive)

### Schema Validation

All public APIs validated with Valibot schemas at runtime:

```typescript
// sdk/schemas/sdk-schema.ts
export const DriverConfigSchema = object({...});
export type DriverConfig = v.InferOutput<typeof DriverConfigSchema>;
// No manual types - Parse Don't Validate pattern
```

## Package Exports

DaliORM uses subpath exports for tree-shaking:

```typescript
// SDK
import { connect } from '@woss/dali-orm/sdk/driver/orm-connection';
import { SurrealQLGenerator } from '@woss/dali-orm/sdk/schema';
import { defineTable } from '@woss/dali-orm/sdk/table';
import { string, int, record } from '@woss/dali-orm/sdk/schema/column';

// Migration
import { MigrationRunner } from '@woss/dali-orm/migration/core/runner';
import { SnapshotManager } from '@woss/dali-orm/migration/core/snapshot';
import { SchemaDiffer } from '@woss/dali-orm/migration/core/diff';

// DDL
import { introspectDatabase } from '@woss/dali-orm/migration/ddl/introspect';
import { ddlDiff } from '@woss/dali-orm/migration/ddl/diff';

// Schemas (runtime validation)
import { DriverConfigSchema } from '@woss/dali-orm/schemas/sdk-schema';
```
