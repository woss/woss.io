---
published: true
title: 'Type-Safe SurrealDB: Meet the ORM That Ships'
slug: 'daliorm-announcement'
featured: true
description: 'Introducing DaliORM — a type-safe query builder for SurrealDB. Your schema becomes your TypeScript, your queries chain like they should, and compile-time validation catches errors before runtime.'
date: 2026-06-12
tags:
  - SurrealDB
  - orm
  - TypeScript
  - database
  - query builder
  - migrations
  - dali
audience: general
header_image: '[Future in the city](https://u.macula.link/HR7CSIPkTFOBV8xVNmVUxg-7?preset=sys_lg)'
---

DaliORM is in early alpha. Expect breaking changes and bugs as I iterate toward 1.0. Don't use it in production, but feedback and contributions are welcome.

You've used SurrealDB and you know SurrealQL — raw queries, hand-rolled validation, runtime errors at 2 AM. DaliORM gives you type-safe query building without abstraction overhead. Your schema becomes your TypeScript, your queries chain like they should, and compile-time validation catches errors before runtime. Pure type inference with no code generation and immutable builders that map 1:1 to SurrealQL. Define your schema once, and types, autocomplete, and migrations all derive from it. Migration-first, Drizzle-inspired.

## Why I Built This

SurrealDB is genuinely exciting. It's not just another document store. It's a multi-model database that handles documents and graphs in one system. You can model complex relationships without the ORM dance that other databases require. Live queries keep your UI in sync automatically. The embedded mode makes it perfect for testing and edge deployments. And the flexible schema means you're not fighting rigidity when your data evolves.

TypeScript should work the same way. The type system catches bugs before they hit production. Autocomplete accelerates your workflow. Refactoring becomes safe. You rename a field and your IDE updates every reference. Initially I was using the Valibot schema validation library to define my schema in code, but it felt clunky and disconnected from the actual database schema. I wanted something that was designed for this purpose, that could serve as a single source of truth for both my database and my TypeScript types. Yes, "parse don't validate" is a great approach, it tracks the shape of your data as it flows through your application, but I wanted to take it a step further and have my schema definitions directly inform my query builders and migrations. I wanted to define my tables and columns in TypeScript, and have that drive everything else. Also, I wanted to learn something new and have fun building a tool that I wish existed when I started working with SurrealDB.

Let's take the schema libraries out of the picture for a moment, shall we?

When you write raw SurrealQL, your IDE sees strings and TypeScript sees `any`. A typo in a column name doesn't error at compile time. It crashes at runtime. Refactoring means grep-based manual labor across your codebase.

I built this ORM to bridge that gap. Not by hiding SurrealQL behind abstraction, but by making TypeScript understand it.

```ts
const email = 'user@example.com';
const result = await db.query(`SELECT * FROM user WHERE email = $email`, { email });
// ^ TypeScript sees "any". Result is "any".
// Typos? Runtime crashes. Refactoring? Manual grep.
```

Defining your schema only mentally and in migration files means they inevitably drift. You end up validating the same data in five different places.

There are other TypeScript ORMs for SurrealDB — [Surqlize](https://github.com/surrealdb/surqlize) (official) uses code generation with `t.*` builders, [SurrealORM](https://github.com/SurrealORM/orm) is decorator-based and early alpha, [Cerial](https://github.com/cerial-orm/cerial) is Prisma-like with schema files and code generation, and TypeSurrealDB takes a class decorator approach. This ORM takes a different path: no code generation, just pure TypeScript inference with no build step. Immutable query builders safe for concurrency. Queries map 1:1 to SurrealQL with no hidden abstraction. Schema drives migrations instead of the other way around. And the core is tiny with no heavy dependencies.

I built it on the official `surrealdb` Node.js client instead of reimplementing the connection layer. WebSocket, HTTP, and embedded modes all work out of the box, and every SDK update benefits it automatically.

## Defining Schema

Your schema lives in code. It's compile-time validated. Instead of keeping schema definitions in your head or in separate migration files, you define them directly in TypeScript. This gives you type inference everywhere—query builders know your columns, conditions know your types, results know your shape.

```typescript
import { defineTable } from '@woss/dali-orm/sdk/table';
import { string, datetime } from '@woss/dali-orm/sdk/schema/column/simple-builders';

export const users = defineTable('user', {
  id: string('id'),
  name: string('name'),
  email: string('email'),
  role: string('role'), // 'author', 'editor', 'publisher'
  bio: string('bio').optional(),
  created_at: datetime('created_at'),
});
```

TypeScript infers the full shape of your table. When you use `users` in queries, it knows exactly what columns exist and what types they hold.

The ORM gives you a solid set of column types to work with:

- `string()`, `int()`, `float()`, `bool()`, `uuid()` - Basic types
- `datetime()`, `duration()`, `decimal()` - Time and precision types
- `array()` - Arrays for multi-value fields
- `object()` - Nested objects for complex structures
- `record(table)` - Foreign keys to other tables

Column builders live under `@woss/dali-orm/sdk/schema/column/simple-builders`. The `record()` builder is at `@woss/dali-orm/sdk/schema/column/record`.

For graph databases, relations matter as much as the data itself. SurrealDB handles this with edge tables, and the ORM supports them too:

```typescript
import { defineRelationTable } from '@woss/dali-orm/sdk/table';

export const wrote = defineRelationTable(
  'wrote',
  {
    id: string('id'),
    created_at: datetime('created_at'),
  },
  {
    in: 'user', // source table
    out: 'article', // target table
  },
);
```

This defines an edge table called "wrote" that connects users (as authors) to articles. The `in` and `out` fields define directionality—users write articles.

Register your tables in an `OrmSchema` and pass it when connecting:

```typescript
import { createOrmSchema } from '@woss/dali-orm';

const schema = createOrmSchema({
  tables: { users, articles, wrote, edited, published },
});
```

Now TypeScript knows your schema. Everywhere your code uses it.

## Building Queries

All builders are immutable. Every method returns a new instance. This might feel different if you're used to mutating query objects, but it matters—you can safely pass queries around without worrying they'll change unexpectedly. Concurrent code stays safe.

Query builders need two things: a driver instance (from your connected ORM) and a table definition. Get the driver with `orm.getDriver()`:

```typescript
const driver = orm.getDriver();
```

### SELECT

```typescript
import { select, eq, and, gte } from '@woss/dali-orm/query';

// Basic select
const query = select(driver, users);
// TypeScript infers: query is SelectBuilder<typeof users>

// Select specific fields
const byFields = select(driver, users).fields('name', 'email');
// TypeScript infers: byFields returns { name: string, email: string, id: string }[]

// Filter with where (callback form)
const filtered = select(driver, users).where((w) => w.eq('role', 'author'));
// TypeScript validates 'role' exists in schema and value 'author' matches type

// Filter with standalone conditions
const filtered2 = select(driver, users).where(eq('role', 'author'));
// Same result, different style—eq() returns a SerializedCondition

// Complex conditions
const active = select(driver, users).where(and(eq('active', true), gte('age', 18)));
// and() composes conditions, TypeScript validates all fields

// Ordering, limit, offset
const paginated = select(driver, users).orderBy('name', 'ASC').limit(10).start(20);

// Execute
const results = await paginated.execute();
// results is typed as User[]
```

The chainable API means you build up complex queries piece by piece. Each method returns a new query builder with the modification applied. The original query stays unchanged—this is the immutability at work.

These are the main methods available on select queries:

- `.fields(...names)` - Choose specific columns to return
- `.columns(selection)` - Drizzle-style object column selection with columnRef
- `.where(fn)` - Add filter conditions (callback or SerializedCondition)
- `.orderBy(column, 'ASC'|'DESC')` - Sort results
- `.limit(n)` - Cap how many results you get
- `.start(n)` - Skip results (pagination offset)
- `.groupBy(...columns)` - Group results
- `.fetch(...tables)` - Include related records
- `.traverse(direction, edge, target, alias)` - Traverse graph relations
- `.timeout(ms)` - Set query timeout
- `.execute()` - Run the query and return typed results
- `.toSQL()` - Get generated SurrealQL string and params

### INSERT

```typescript
import { insert } from '@woss/dali-orm/query';

const query = insert(driver, users).one({
  id: 'user:123',
  name: 'Jane Smith',
  email: 'jane@example.com',
  role: 'author',
  created_at: new Date().toISOString(),
});

const [result] = await query.execute();
// Inserts the record and returns it
```

The `insert` builder takes your driver and table definition. Add a single record with `.one()` or multiple with `.many()`:

```typescript
await insert(driver, users)
  .many([
    { name: 'Alice', email: 'alice@example.com', role: 'author' },
    { name: 'Bob', email: 'bob@example.com', role: 'editor' },
  ])
  .execute();
```

TypeScript validates that you provide all required fields—miss one and the compiler catches it.

### UPDATE

```typescript
import { update } from '@woss/dali-orm/query';

await update(driver, users).id('user:123').set('name', 'Jane Doe').set('bio', 'Writer and editor').execute();
```

Update a specific record by ID with `.id()`, then chain `.set()` calls for each field you want to change. Each `.set()` returns a new builder, so you can keep chaining. For bulk updates, set all data at once with `.data(obj)`.

### DELETE

```typescript
import { delete_ } from '@woss/dali-orm/query';

await delete_(driver, users).id('user:123').execute();
```

Delete works similarly—specify the record ID and execute. The function is named `delete_` (trailing underscore) because `delete` is a reserved word in JavaScript.

### RELATE

Graph relations connect records in SurrealDB. The `relate` builder handles this:

```typescript
import { relate } from '@woss/dali-orm/query';

await relate(driver, wrote).from('user:123').to('article:456').set('created_at', new Date().toISOString()).execute();
```

You specify the edge table definition (from `defineRelationTable()`), then `.from()` the source record and `.to()` the target record. The ORM builds the proper SurrealQL RELATE statement. Set properties on the edge itself with `.set()`.

The `.from()` maps to SurrealDB's `in` field, `.to()` maps to `out`. This matches the direction you declared in `defineRelationTable()`.

## Conditions

Filters in queries use composable helpers. You can use them two ways:

**Callback form** (fluent builder, best for simple queries):

```typescript
select(driver, users).where((w) => w.eq('role', 'author').gte('age', 18));
```

**Standalone condition form** (composable, best for reusable logic):

```typescript
import { eq, ne, gt, gte, lt, lte, and, or, not } from '@woss/dali-orm/query';

// Equality
eq('active', true);
ne('role', 'admin');

// Comparison
gt('age', 18);
gte('score', 100);
lt('price', 50);
lte('quantity', 10);

// Logical composition
and(eq('active', true), gte('age', 18));
or(eq('role', 'author'), eq('role', 'editor'));
not(eq('status', 'archived'));
```

Conditions compose naturally. Use `and()` and `or()` to build complex filters from simple pieces.

Additional conditions available: `contains()`, `inside()`, `isNull()`, `isNotNull()`, `intersects()`, `containsAll()`, `containsAny()`, `containsNone()`, `outside()`.

## Transactions

When you need multiple operations to succeed or fail together, wrap them in a transaction. The ORM handles the commit/rollback automatically.

```typescript
await orm.transaction(async (tx) => {
  // All queries execute within a single transaction
  await tx.query('CREATE user:john SET name = "John"');
  await tx.query('CREATE post:1 SET title = "Hello", author = user:john');

  // Return value is returned from transaction()
  return { success: true };
});
// Automatically commits on success, rolls back on error
```

The transaction object gives you raw query execution:

- `.query(sql, vars)` - Execute raw SQL within the transaction

If any operation throws, the transaction rolls back cleanly. No manual cleanup required.

## Type Safety in Action

TypeScript infers types from your schema, so you get autocomplete and validation in your editor and at compile time.

```typescript
import { insert, select } from '@woss/dali-orm/query';
import { DaliORM } from '@woss/dali-orm';
import { users, schema } from './schema';

const orm = await DaliORM.connect({
  nodeDriver: {
    url: 'ws://localhost:10101',
    namespace: 'test',
    database: 'test',
    auth: { username: 'root', password: 'root' },
  },
  schema,
});

const driver = orm.getDriver();

// Insert - TypeScript knows required fields
const [user] = await insert(driver, users)
  .one({
    id: 'user:123',
    name: 'Jane',
    email: 'jane@example.com',
    // bio: 'optional field - can skip',
    // ^ No error - bio is optional
    // Missing required fields like name? Compile error.
  })
  .execute();

// Select - TypeScript knows return shape
const result = await select(driver, users).execute();
// result is User[]

// Query builder - autocomplete works
const query = select(driver, users)
  .fields('id', 'name') // autocomplete: column names from schema
  .where((w) => w.eq('role', 'author')) // autocomplete: column names
  .orderBy('name'); // autocomplete: columns
```

How does this work? TypeScript uses the schema definition from `defineTable()` to validate queries at compile time. The schema is defined as a TypeScript type that query builders reference. When you write `w.eq('role', 'author')`, TypeScript looks up `role` in the schema's column definitions, validates the column exists and matches the expected type, and checks the value `'author'` is compatible with that column type. This all happens during compilation, before any code runs.

That means these errors surface at compile time, not runtime:

- Missing required fields
- Invalid column names
- Type mismatches
- Unknown tables

## Migration System

Schema changes require migrations. The ORM includes a MigrationRunner that keeps your database in sync with your code.

The migration engine takes heavy inspiration from [Drizzle ORM](https://orm.drizzle.team/) (beta)—the best migration system in the TypeScript ecosystem. I aim for that same clarity: simple files, clear direction, and no magic.

### Configuration

```typescript
// dali-orm.config.ts
import type { Config } from '@woss/dali-orm/migration/config';

const config: Config = {
  url: 'ws://localhost:10101',
  namespace: 'main',
  database: 'main',
  auth: { user: 'admin', pass: 'admin' },
  migrations: {
    dir: './migrations',
    table: '__migrations',
  },
  schema: {
    dir: './src',
    pattern: 'schema.ts',
  },
};

export default config;
```

The config covers connection details, authentication at different levels, and where to find migrations and schema files.

Auth options:

- Root auth: `{ user: 'root', pass: 'password' }`
- Namespace auth: `{ user: 'user', pass: 'pass', namespace: 'ns' }`
- Database auth: `{ user: 'user', pass: 'pass', namespace: 'ns', database: 'db' }`
- Record auth: `{ table: 'users', namespace: 'ns', database: 'db' }`

### Run Migrations

```typescript
import { DaliORM } from '@woss/dali-orm';
import { MigrationRunner } from '@woss/dali-orm/migration/api';

// Connect
const orm = await DaliORM.connect({
  nodeDriver: {
    url: 'ws://localhost:10101',
    namespace: 'main',
    database: 'main',
    auth: { username: 'admin', password: 'admin' },
  },
});

const driver = orm.getDriver();

// Run migrations
const runner = new MigrationRunner(driver, {
  migrationsDir: './migrations',
  migrationsTable: '__migrations',
});

await runner.init();
const result = await runner.up();
// Applies pending migrations
// result.applied = ['001_initial', '002_add_users']
// result.skipped = ['001_initial']
```

Migrations live in `./migrations/` as timestamped files. The runner tracks which ones have been applied in the database itself, so running migrations twice is safe. It skips what's already done.

You can also use the CLI:

```bash
npx dali-orm migrate up
npx dali-orm migrate status
npx dali-orm generate
```

## Trying It Out

The repo includes a working todo app example:

### Prerequisites

- SurrealDB running at `ws://localhost:10101`
- Docker installed

Start SurrealDB:

```bash
docker compose up -d
```

### Running the Example

```bash
cd examples/todo-app
pnpm install
pnpm dev
```

This starts a SvelteKit app connected to SurrealDB via DaliORM. Check the schema at `examples/todo-app/schema.ts` to see how tables are defined, and `examples/todo-app/migrations/` to see how migrations work.

### Example Queries to Try

In Surrealist run:

```sql
-- All users
SELECT * FROM user;

-- Authors only
SELECT * FROM user WHERE role = 'author';

-- Published articles
SELECT * FROM article WHERE status = 'published';

-- Articles with authors
SELECT *, ->wrote->user AS author FROM article;

-- Relations for article
SELECT * FROM wrote WHERE out = 'article:abc123';
```

The ORM doesn't hide SurrealQL from you. It builds strings, executes them, and returns results. There's no hidden abstraction layer you can't debug. If something goes wrong, you can see exactly what the ORM generated.

Set `DEBUG=dali-orm:*` to watch queries being built. For more targeted output, use `DEBUG=dali-orm:kit:generate` for code generation, `DEBUG=dali-orm:kit:driver:node` for connection details, or `DEBUG=dali-orm:kit:runner` for migration steps. The debug output shows generated SQL, connection progress, and migration status.

## Installation

```bash
pnpm add @woss/dali-orm
```

## Quick Start

```typescript
import { DaliORM, createOrmSchema } from '@woss/dali-orm';
import { defineTable } from '@woss/dali-orm/sdk/table';
import { string } from '@woss/dali-orm/sdk/schema/column/simple-builders';
import { select, insert } from '@woss/dali-orm/query';

// Define schema
const users = defineTable('user', {
  id: string('id'),
  name: string('name'),
  email: string('email'),
});

const schema = createOrmSchema({ tables: { users } });

// Connect
const orm = await DaliORM.connect({
  nodeDriver: {
    url: 'ws://localhost:10101',
    namespace: 'test',
    database: 'test',
    auth: { username: 'root', password: 'root' },
  },
  schema,
});

const driver = orm.getDriver();

// Insert
await insert(driver, users).one({ id: 'user:1', name: 'Jane', email: 'jane@example.com' }).execute();

// Query
const results = await select(driver, users).execute();
// results is { id: string, name: string, email: string }[]
```

Query builders compile to SurrealQL with immutability by default and TypeScript inference throughout. Go try it — run the demo.
