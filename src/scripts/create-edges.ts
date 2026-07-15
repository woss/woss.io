/**
 * One-shot migration: create has_message edges from existing chat_id values.
 * Usage: bun src/scripts/create-edges.ts
 */
import { initSurreal, closeSurreal } from '../lib/server/db/surreal';
import { RecordId, Table } from 'surrealdb';

const db = await initSurreal();

// Fetch all messages that have a chat_id
const [rows] = await db.query<[{ id: RecordId; chat_id: string }[]]>(
  'SELECT id, chat_id FROM messages WHERE chat_id IS NOT NONE',
);

console.log(`Found ${rows.length} messages with chat_id`);

let created = 0;

// Parse a SurrealDB record ID string (e.g. "chats:⟨uuid⟩" or "chats:abc123") into a RecordId
function parseRecordId(raw: string | RecordId): RecordId {
  if (raw instanceof RecordId) return raw;
  // Handle "table:id" format — strip table prefix
  const colonIdx = raw.indexOf(':');
  if (colonIdx === -1) return new RecordId('messages', raw);
  const table = raw.substring(0, colonIdx);
  const id = raw.substring(colonIdx + 1);
  return new RecordId(table, id);
}

for (const row of rows) {
  const chatRecordId = parseRecordId(row.chat_id);
  const msgRecordId = parseRecordId(row.id);

  try {
    await db.relate(chatRecordId, new Table('has_message'), msgRecordId, {
      created_at: new Date(),
    });
    created++;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to create edge for ${String(msgRecordId)}: ${msg}`);
  }
}

console.log(`Created ${created} has_message edges`);

await closeSurreal();
