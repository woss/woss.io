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

import { Surreal, createRemoteEngines } from 'surrealdb';

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
