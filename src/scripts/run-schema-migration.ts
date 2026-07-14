/**
 * Run migrate.surql via SurrealDB RPC (WebSocket).
 * Usage: bun src/scripts/run-schema-migration.ts
 */
import { initSurreal, closeSurreal } from '../lib/server/db/surreal';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sql = readFileSync(resolve(import.meta.dirname, 'migrate.surql'), 'utf-8');

// Extract individual statements (terminated by ;), strip comments and blank lines
const statements = sql
  .split(/\n/)
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(/;\s*\n/)
  .map((s) => s.trim() + ';')
  .filter((s) => s.length > 1); // more than just ";"

console.log(`Running ${statements.length} statements from migrate.surql...\n`);

const db = await initSurreal();

let passed = 0;
let failed = 0;

for (let i = 0; i < statements.length; i++) {
  const stmt = statements[i];
  const preview = stmt.split('\n')[0].substring(0, 80);
  try {
    await db.query(stmt);
    console.log(`OK   [${i + 1}] ${preview}`);
    passed++;
  } catch (err: any) {
    const msg = err.message || String(err);
    // REMOVE TABLE is idempotent — "not exist" is fine
    if (stmt.startsWith('REMOVE TABLE') && msg.includes('does not exist')) {
      console.log(`OK   [${i + 1}] ${preview} (already removed)`);
      passed++;
    } else {
      console.log(`FAIL [${i + 1}] ${preview}`);
      console.log(`  ${msg}`);
      failed++;
    }
  }
}

await closeSurreal();

console.log(`\n=== ${passed} OK, ${failed} failed out of ${statements.length} ===`);
if (failed > 0) process.exit(1);
