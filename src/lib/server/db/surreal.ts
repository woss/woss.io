/**
 * SurrealDB client singleton.
 *
 * Provides a lazy-initialised SurrealDB connection for use across the server.
 * Works in both SvelteKit ($env/dynamic/private) and standalone (process.env) contexts.
 *
 * Import the class directly for type usage:
 * ```ts
 * import { Surreal } from 'surrealdb';
 * import { getSurreal } from '$lib/server/db/surreal';
 * const db: Surreal = getSurreal();
 * ```
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Surreal, createRemoteEngines } from 'surrealdb';
import { createLogger, CAT } from '$lib/server/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SurrealOptions {
  url?: string;
  user?: string;
  pass?: string;
  ns?: string;
  db?: string;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _db: Surreal | null = null;
let _initialized = false;
let _initPromise: Promise<Surreal> | null = null;

// ---------------------------------------------------------------------------
// Lazy env loader — works in SvelteKit and standalone contexts
// ---------------------------------------------------------------------------

async function loadEnv(): Promise<SurrealOptions> {
  try {
    const { env } = (await import('$env/dynamic/private')) as {
      env: Record<string, string | undefined>;
    };
    return {
      url: env.SURREAL_DB_URL,
      user: env.SURREAL_DB_USER,
      pass: env.SURREAL_DB_PASS,
      ns: env.SURREAL_DB_NS,
      db: env.SURREAL_DB_DB,
    };
  } catch {
    return {
      url: process.env.SURREAL_DB_URL ?? 'ws://localhost:10101',
      user: process.env.SURREAL_DB_USER ?? 'admin',
      pass: process.env.SURREAL_DB_PASS ?? 'admin',
      ns: process.env.SURREAL_DB_NS ?? 'woss',
      db: process.env.SURREAL_DB_DB ?? 'woss',
    };
  }
}

// ---------------------------------------------------------------------------
// Schema application
// ---------------------------------------------------------------------------

/**
 * Apply `schema.surql` to the connected database.
 *
 * Statements are idempotent DEFINE TABLE/FIELD/INDEX — safe to run on every
 * startup. If the schema file is missing a warning is logged and the app
 * continues without error.
 */
async function applySchema(db: Surreal): Promise<void> {
  const log = createLogger(CAT.db);
  const schemaPath = resolve(process.cwd(), 'src/scripts/schema.surql');

  let raw: string;
  try {
    raw = readFileSync(schemaPath, 'utf-8');
  } catch {
    log.warn(`Schema file not found at ${schemaPath} — skipping schema application`);
    return;
  }

  const stmts = raw
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n')
    .split(';\n')
    .map((s) => s.trim())
    .filter(Boolean);

  let applied = 0;
  for (const stmt of stmts) {
    try {
      await db.query(stmt);
      applied++;
    } catch (cause) {
      const msg = (cause as Error).message ?? '';
      if (/already exists/i.test(msg)) {
        continue;
      }
      log.warn(`Schema statement failed: ${msg}\n  Statement: ${stmt.slice(0, 120)}`);
    }
  }
  log.info(`Schema applied: ${applied} statements`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the SurrealDB client singleton.
 *
 * When `opts` is provided it is merged over the auto-detected environment
 * values, allowing callers (e.g. build-index.ts) to override specific fields
 * while falling back to env defaults for the rest.
 *
 * Idempotent — subsequent calls return the existing instance.
 */
export async function initSurreal(opts?: SurrealOptions): Promise<Surreal> {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const env = await loadEnv();

    const url = opts?.url ?? env.url ?? 'ws://localhost:10101';
    const user = opts?.user ?? env.user ?? 'admin';
    const pass = opts?.pass ?? env.pass ?? 'admin';
    const ns = opts?.ns ?? env.ns ?? 'woss';
    const dbName = opts?.db ?? env.db ?? 'woss';

    try {
      const db = new Surreal({ engines: createRemoteEngines() });
      await db.connect(url, {
        namespace: ns,
        database: dbName,
        authentication: { username: user, password: pass },
      });

      await applySchema(db);

      _db = db;
      _initialized = true;
      return _db;
    } catch (cause) {
      throw new Error(
        `Failed to connect to SurrealDB at ${url} (ns=${ns}, db=${dbName}): ${(cause as Error).message}`,
        {
          cause,
        },
      );
    }
  })();

  try {
    return await _initPromise;
  } finally {
    _initPromise = null;
  }
}

/**
 * Return the initialised SurrealDB client.
 *
 * Throws if `initSurreal()` has not been called yet.
 */
export function getSurreal(): Surreal {
  if (!_db || !_initialized) {
    throw new Error('SurrealDB not initialized. Call initSurreal() first.');
  }
  return _db;
}

/**
 * Close the SurrealDB connection and reset the singleton state.
 */
export async function closeSurreal(): Promise<void> {
  if (_db) {
    try {
      await _db.close();
    } catch (cause) {
      console.warn('Error closing SurrealDB connection:', (cause as Error).message);
    }
  }
  _db = null;
  _initialized = false;
  _initPromise = null;
}

// Re-export the Surreal type so consumers can annotate without a separate import.
export type { Surreal };
