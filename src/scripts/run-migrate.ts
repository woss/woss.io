import { Surreal, createRemoteEngines } from 'surrealdb';
import { readFileSync } from 'node:fs';

const sql = readFileSync('src/scripts/migrate.surql', 'utf-8');

const statements = sql
  .split(';')
  .map((s) => {
    const lines = s.split('\n').filter((l) => !l.trim().startsWith('--') && l.trim().length > 0);
    return lines.join('\n').trim();
  })
  .filter((s) => s.length > 0);

console.log(`Found ${statements.length} SQL statements`);

const db = new Surreal({ engines: createRemoteEngines() });
await db.connect('ws://localhost:10101', {
  namespace: 'woss',
  database: 'woss',
  authentication: { username: 'admin', password: 'admin' },
});

let ok = 0,
  fail = 0;
for (let i = 0; i < statements.length; i++) {
  try {
    await db.query(statements[i]);
    ok++;
  } catch (e) {
    fail++;
    console.log(`#${i + 1} FAIL: ${statements[i].slice(0, 80)}`);
    console.log(`   ${(e as Error).message}`);
  }
}
console.log(`\n${ok} ok, ${fail} failed`);

const info = await db.query('INFO FOR DB');
const t = info[0] as any;
console.log(`Tables: ${Object.keys(t.tables).length}`);
console.log(Object.keys(t.tables).sort().join(', '));
await db.close();
