/**
 * Focused verification tests for surreal-service.ts changes (task 20.1):
 * 1. healthCheck() — RETURN 1 (was SELECT 1 FROM users LIMIT 1)
 * 2. transaction() — BEGIN/COMMIT/CANCEL (was BEGIN/COMMIT/CANCEL TRANSACTION)
 *
 * Uses the already-running SurrealDB on port 10102.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initSurreal, closeSurreal } from './surreal';
import { SurrealDatabaseService } from './surreal-service';

const SURREAL_URL = 'ws://127.0.0.1:10102';
let service: SurrealDatabaseService;

beforeAll(async () => {
  await initSurreal({
    url: SURREAL_URL,
    user: 'root',
    pass: 'root',
    ns: 'verify_test',
    db: 'verify_test',
  });
  service = new SurrealDatabaseService();
}, 15_000);

afterAll(async () => {
  try {
    await closeSurreal();
  } catch {
    /* ignore */
  }
});

describe('healthCheck (task 20.1 — RETURN 1)', () => {
  it('returns true when db is reachable', async () => {
    const result = await service.healthCheck();
    expect(result).toBe(true);
  });
});

describe('transaction (task 20.1 — BEGIN/COMMIT/CANCEL)', () => {
  it('wraps fn in BEGIN/COMMIT and returns result', async () => {
    const result = await service.transaction(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('rolls back on fn error and rethrows', async () => {
    await expect(service.transaction(() => Promise.reject(new Error('fn failed')))).rejects.toThrow('fn failed');
  });

  it('can run SurrealDB queries inside transaction', async () => {
    const result = await service.transaction(async () => {
      const { getSurreal } = await import('./surreal');
      const db = getSurreal();
      const res = await db.query('RETURN 42');
      return (res as any)[0];
    });
    expect(result).toBe(42);
  });
});
