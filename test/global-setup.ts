/**
 * Vitest globalSetup — starts an in-memory SurrealDB on port 10102
 * once before ALL test files, kills it after all tests finish.
 *
 * Runs in a SEPARATE process from the test runner, so vitest
 * cannot kill the child process prematurely.
 */

import { spawn, type ChildProcess } from 'node:child_process';

let surrealProcess: ChildProcess | null = null;

const SURREAL_PORT = 10102;
const SURREAL_URL = `ws://127.0.0.1:${SURREAL_PORT}`;
const SURREAL_USER = 'root';
const SURREAL_PASS = 'root';
const SURREAL_NS = 'test';
const SURREAL_DB = 'test';

export async function setup() {
  // 1. Check if already running
  try {
    const { Surreal } = await import('surrealdb');
    const db = new Surreal();
    await db.connect(SURREAL_URL, {
      namespace: SURREAL_NS,
      database: SURREAL_DB,
      authentication: { username: SURREAL_USER, password: SURREAL_PASS },
    });
    await db.close();
    console.log(`[global-setup] SurrealDB already running on :${SURREAL_PORT}`);
    return;
  } catch {
    // Not running — spawn it
  }

  // 2. Spawn in-memory SurrealDB
  console.log(`[global-setup] Starting SurrealDB on :${SURREAL_PORT}...`);
  surrealProcess = spawn('surreal', ['start', '--no-banner', '--bind', `127.0.0.1:${SURREAL_PORT}`, 'memory'], {
    stdio: 'ignore',
    detached: false,
  });

  // 3. Wait for readiness
  const { Surreal } = await import('surrealdb');
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('SurrealDB start timeout (15s)')), 15_000);
    const poll = async () => {
      try {
        const db = new Surreal();
        await db.connect(SURREAL_URL, {
          namespace: SURREAL_NS,
          database: SURREAL_DB,
          authentication: { username: SURREAL_USER, password: SURREAL_PASS },
        });
        await db.close();
        clearTimeout(timeout);
        resolve();
      } catch {
        setTimeout(poll, 200);
      }
    };
    poll();
  });

  console.log(`[global-setup] SurrealDB ready on :${SURREAL_PORT}`);
}

export async function teardown() {
  if (surrealProcess) {
    console.log(`[global-setup] Killing SurrealDB (pid ${surrealProcess.pid})`);
    surrealProcess.kill('SIGTERM');
    surrealProcess = null;
  }
}
