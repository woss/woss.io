import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock surrealdb v2 SDK BEFORE any imports — vitest hoists vi.mock() to the
// top. The factory creates a new Surreal mock class where every call to `new`
// returns a fresh instance with freshly-minted vi.fn() methods so the
// per-instance call-counts are always accurate.
// ---------------------------------------------------------------------------

vi.mock('surrealdb', () => {
  return {
    // Regular function (not arrow) so `new Surreal()` works — vitest's
    // vi.fn implementation is called via Reflect.construct which fails
    // on arrow functions.
    Surreal: vi.fn(function () {
      return {
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
      };
    }),
    createRemoteEngines: vi.fn(() => ({})),
  };
});

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import { initSurreal, getSurreal, closeSurreal } from './surreal';
import { Surreal } from 'surrealdb';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the mock instance returned by the last `new Surreal()` call. */
function getLastMockInstance(): Record<string, ReturnType<typeof vi.fn>> {
  const ctor = vi.mocked(Surreal);
  const results = ctor.mock.results;
  if (results.length === 0) throw new Error('Surreal was never instantiated');
  return results[results.length - 1].value as Record<string, ReturnType<typeof vi.fn>>;
}

// ===========================================================================
// SurrealDB singleton tests
// ===========================================================================

describe('SurrealDB singleton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Reset module-level state so the next test starts fresh.
    try {
      await closeSurreal();
    } catch {
      // closeSurreal may throw if _db.close() fails or _db is null — swallow.
    }
  });

  // -------------------------------------------------------------------------
  // 1. getSurreal() before init
  // -------------------------------------------------------------------------

  it('throws when getSurreal() is called before initSurreal()', () => {
    expect(() => getSurreal()).toThrow('SurrealDB not initialized');
  });

  // -------------------------------------------------------------------------
  // 2. initSurreal() with no opts — happy path
  // -------------------------------------------------------------------------

  it('initialises and connects using environment defaults', async () => {
    const db = await initSurreal();
    expect(db).toBeDefined();

    const instance = getLastMockInstance();
    // .env has SURREAL_DB_URL=ws://localhost:10101
    expect(instance.connect).toHaveBeenCalledOnce();
    expect(instance.connect).toHaveBeenCalledWith('ws://localhost:10101', {
      namespace: 'woss',
      database: 'woss',
      authentication: { username: 'admin', password: 'admin' },
    });
  });

  // -------------------------------------------------------------------------
  // 3. Idempotent init
  // -------------------------------------------------------------------------

  it('is idempotent — second initSurreal() returns the same instance', async () => {
    const db1 = await initSurreal();
    const db2 = await initSurreal();

    expect(db1).toBe(db2);

    // Surreal constructor should only have been called once
    const ctor = vi.mocked(Surreal);
    expect(ctor).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 4. getSurreal() after init
  // -------------------------------------------------------------------------

  it('getSurreal() returns the same instance after initSurreal()', async () => {
    const db = await initSurreal();
    const retrieved = getSurreal();

    expect(retrieved).toBe(db);
  });

  // -------------------------------------------------------------------------
  // 5. closeSurreal() behaviour
  // -------------------------------------------------------------------------

  it('closeSurreal() calls close() on the connection and resets state', async () => {
    await initSurreal();
    const instance = getLastMockInstance();

    await closeSurreal();

    expect(instance.close).toHaveBeenCalledOnce();
    // After close, getSurreal must throw again
    expect(() => getSurreal()).toThrow('SurrealDB not initialized');
  });

  it('closeSurreal() is safe to call when not initialised (no-op)', async () => {
    // Should not throw
    await closeSurreal();
    // State unchanged
    expect(() => getSurreal()).toThrow('SurrealDB not initialized');
  });

  // -------------------------------------------------------------------------
  // 6. post-close guard
  // -------------------------------------------------------------------------

  it('throws again when getSurreal() is called after closeSurreal()', async () => {
    await initSurreal();
    await closeSurreal();

    expect(() => getSurreal()).toThrow('SurrealDB not initialized');
  });

  // -------------------------------------------------------------------------
  // 7. Opts merge
  // -------------------------------------------------------------------------

  it('merges opts with default env values', async () => {
    // Override url, user, ns via opts; pass and db fall through to defaults
    const db = await initSurreal({
      url: 'ws://custom-url:8000',
      user: 'custom-user',
      ns: 'custom-ns',
    });
    expect(db).toBeDefined();

    const instance = getLastMockInstance();

    expect(instance.connect).toHaveBeenCalledWith('ws://custom-url:8000', {
      namespace: 'custom-ns',
      database: 'woss',
      authentication: { username: 'custom-user', password: 'admin' },
    });
  });

  it('uses hardcoded defaults when env and opts are both absent', async () => {
    // This test validates the ?? chain fallback behaviour.
    // It relies on $env/dynamic/private returning undefined values for
    // SURREAL_DB_* (or the catch path falling through to process.env
    // which is also unset) so that the ?? chain lands on the literals.
    //
    // We keep the test deterministic by clearing relevant env keys.
    // Note: SvelteKit's $env/dynamic/private may shadow process.env,
    // so this guard tests the catch fallback path exclusively.
    delete process.env.SURREAL_DB_URL;
    delete process.env.SURREAL_DB_USER;
    delete process.env.SURREAL_DB_PASS;
    delete process.env.SURREAL_DB_NS;
    delete process.env.SURREAL_DB_DB;

    const db = await initSurreal();
    expect(db).toBeDefined();

    // The hardcoded defaults define the expected arguments
    const instance = getLastMockInstance();

    expect(instance.connect).toHaveBeenCalledWith('ws://localhost:10101', {
      namespace: 'woss',
      database: 'woss',
      authentication: { username: 'admin', password: 'admin' },
    });
  });

  // -------------------------------------------------------------------------
  // 8. Partial opts — only override a single field
  // -------------------------------------------------------------------------

  it('accepts partial opts (single field override)', async () => {
    const db = await initSurreal({ db: 'test-db' });
    expect(db).toBeDefined();

    const instance = getLastMockInstance();
    expect(instance.connect).toHaveBeenCalledWith('ws://localhost:10101', {
      namespace: 'woss',
      database: 'test-db',
      authentication: { username: 'admin', password: 'admin' },
    });
  });

  // -------------------------------------------------------------------------
  // 9. Error handling
  // -------------------------------------------------------------------------

  it('throws a descriptive error when the connect call fails', async () => {
    // Override the Surreal mock constructor for the next call only
    vi.mocked(Surreal).mockImplementationOnce(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error('Connection refused by server')),
        close: vi.fn(),
      };
    });

    await expect(initSurreal()).rejects.toThrow(
      'Failed to connect to SurrealDB at ws://localhost:10101 (ns=woss, db=woss): Connection refused by server',
    );
  });

  it('does not mutate module state when initSurreal fails', async () => {
    vi.mocked(Surreal).mockImplementationOnce(function () {
      return {
        connect: vi.fn().mockRejectedValue(new Error('timeout')),
        close: vi.fn(),
      };
    });

    // First call fails
    await expect(initSurreal()).rejects.toThrow();

    // getSurreal should still throw — state was not mutated
    expect(() => getSurreal()).toThrow('SurrealDB not initialized');

    // A second call should succeed (with the normal mock)
    const db = await initSurreal();
    expect(db).toBeDefined();
    expect(getSurreal()).toBe(db);
  });

  // -------------------------------------------------------------------------
  // 10. Property-based: idempotency
  // -------------------------------------------------------------------------

  it('is idempotent — closeSurreal(); initSurreal() creates a fresh instance', async () => {
    const db1 = await initSurreal();
    await closeSurreal();

    const db2 = await initSurreal();
    expect(db2).toBeDefined();
    expect(db2).not.toBe(db1);

    // Constructor called exactly twice (once per init)
    const ctor = vi.mocked(Surreal);
    expect(ctor).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // 11. Empty opts object
  // -------------------------------------------------------------------------

  it('accepts an empty opts object', async () => {
    const db = await initSurreal({});
    expect(db).toBeDefined();
    const instance = getLastMockInstance();
    expect(instance.connect).toHaveBeenCalledOnce();
  });
});
