export const DATA_DIR = './data';
export const DB_PATH = './data/woss.db';
export const DB_WAL_PATH = './data/woss.db-wal';
export const DB_SHM_PATH = './data/woss.db-shm';
export const VECTOR_INDEX_PATH = './data/woss.usearch';

export function initDatabase(db: import('better-sqlite3').Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chunk_id TEXT UNIQUE,
      text TEXT,
      title TEXT,
      date TEXT,
      tags TEXT,
      section TEXT,
      embedding TEXT,
      type TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT,
      name TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // Migration for existing DBs: ALTER TABLE messages ADD COLUMN from_cache INTEGER DEFAULT 0;
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      chat_id TEXT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      sources TEXT DEFAULT '[]',
      reasoning TEXT DEFAULT '',
      error TEXT,
      irrecoverable INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      model_id INTEGER,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      max_tokens INTEGER DEFAULT 0,
      query_type TEXT,
      deleted_at TEXT,
      user_agent_id INTEGER,
      trace_id TEXT,
      from_cache INTEGER DEFAULT 0
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS page_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      hash TEXT,
      content TEXT,
      toc TEXT,
      title TEXT,
      description TEXT,
      date TEXT,
      tags TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      excerpt TEXT,
      header_image TEXT,
      featured INTEGER DEFAULT 0,
      position INTEGER,
      part_of_series INTEGER REFERENCES page_posts(id),
      workflow_files TEXT,
      updated_at TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_experience (
      slug TEXT PRIMARY KEY,
      hash TEXT,
      content TEXT,
      company TEXT,
      role TEXT,
      start_date TEXT,
      end_date TEXT,
      duration TEXT,
      skills TEXT,
      description TEXT,
      published INTEGER DEFAULT 1,
      updated_at TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question TEXT,
      question_embedding TEXT,
      answer TEXT,
      sources TEXT,
      tool_calls TEXT DEFAULT '[]',
      message_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT,
      model_name TEXT,
      actual_model_name TEXT,
      max_tokens INTEGER,
      UNIQUE(provider, model_name, actual_model_name)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT,
      user_id TEXT,
      reaction_type TEXT,
      reason TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(message_id, user_id)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chats (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      title TEXT DEFAULT 'New Chat',
      created_at TEXT DEFAULT (datetime('now')),
      deleted_at TEXT,
      locked INTEGER DEFAULT 0,
      off_topic_count INTEGER DEFAULT 0,
      user_agent_id INTEGER,
      trace_id TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT,
      type TEXT,
      data TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      name TEXT,
      email TEXT,
      company_name TEXT,
      role TEXT,
      message TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS contact_intents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      chat_id TEXT,
      text TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ua TEXT UNIQUE,
      ip TEXT,
      device_type TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      name TEXT,
      server_id TEXT,
      tool_input TEXT,
      tool_output TEXT,
      result_size INTEGER DEFAULT 0,
      started_at TEXT,
      finished_at TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT,
      timestamp TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS feature_tours (
      user_id TEXT NOT NULL REFERENCES users(id),
      feature_id TEXT NOT NULL,
      dismissed_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, feature_id)
    )
  `);
}
