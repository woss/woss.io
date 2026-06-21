/**
 * Script: cleanup-empty-chats.ts
 *
 * Soft-deletes all chats with 3 or fewer user messages (0-3 messages).
 * Sets deleted_at on the chat record and all its messages.
 *
 * Usage: pnpm tsx src/scripts/cleanup-empty-chats.ts
 */
import Database from 'better-sqlite3';
import { DB_PATH } from '../lib/server/schema';

function main(): void {
  const db = new Database(DB_PATH);

  // Find all non-deleted chats with <= 3 user messages
  const emptyChats = db
    .prepare(
      `SELECT c.id,
            c.title,
            (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND m.role = 'user' AND m.deleted_at IS NULL) AS msg_count
     FROM chats c
     WHERE c.deleted_at IS NULL
       AND (SELECT COUNT(*) FROM messages m WHERE m.chat_id = c.id AND m.role = 'user' AND m.deleted_at IS NULL) <= 3
     ORDER BY c.created_at ASC`,
    )
    .all() as { id: string; title: string; msg_count: number }[];

  if (emptyChats.length === 0) {
    console.log('No empty chats found. Nothing to delete.');
    db.close();
    return;
  }

  console.log(`Found ${emptyChats.length} chat(s) with <= 3 user messages:\n`);
  for (const chat of emptyChats) {
    console.log(`  ${chat.id}  "${chat.title}"  (${chat.msg_count} msg(s))`);
  }
  console.log('');

  // Soft-delete each chat and its messages
  const deleteChatStmt = db.prepare("UPDATE chats SET deleted_at = datetime('now') WHERE id = ?");
  const deleteMessagesStmt = db.prepare(
    "UPDATE messages SET deleted_at = datetime('now') WHERE chat_id = ? AND deleted_at IS NULL",
  );

  const del = db.transaction((chats: { id: string }[]) => {
    for (const chat of chats) {
      deleteChatStmt.run(chat.id);
      deleteMessagesStmt.run(chat.id);
    }
  });

  del(emptyChats);

  console.log(`Deleted ${emptyChats.length} chat(s) and their messages.`);
  db.close();
}

main();
