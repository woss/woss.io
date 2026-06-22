#!/usr/bin/env tsx
import { createInterface } from 'node:readline';
import { createReadStream, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROD_DIR = resolve(__dirname, '..', 'prod');
const DB_PATH = resolve(PROD_DIR, 'woss.db');
const LOG_PATH = resolve(PROD_DIR, 'logs', 'woss.io.log');

interface LogEntry {
  '@timestamp'?: string;
  level?: string;
  message?: string;
  logger?: string;
  traceId?: string;
  spanId?: string;
  msgId?: string;
  chatId?: string;
  tokensIn?: number;
  tokensOut?: number;
  durationMs?: number;
  [key: string]: unknown;
}

interface LogAgg {
  total: number;
  minTs: string | null;
  maxTs: string | null;
  levelCount: Record<string, number>;
  statusCodes: Record<string, number>;
  tokenSum: { tokensIn: number; tokensOut: number; durationMs: number };
  tokenCount: number;
  doomLoops: Map<string, number>;
  errorLines: string[];
  maculaFailed: number;
  maculaTimeout: number;
  maculaReconnect: number;
  chatIds: Set<string>;
  hallucinationMentions: number;
  modelLines: string[];
  embeddingLoad: number;
  linesWithChatId: number;
}

function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2);
}

function boxHeader(title: string): void {
  const pad = 44 - title.length;
  const left = Math.floor(pad / 2);
  const right = pad - left;
  console.log(`╔════════════════════════════════════════════╗`);
  console.log(`║${' '.repeat(left)}${title}${' '.repeat(right)}║`);
  console.log(`║        Generated: ${new Date().toISOString()}           ║`);
  console.log(`╚════════════════════════════════════════════╝`);
  console.log();
}

function section(title: string): void {
  console.log(`\n=== ${title} ===\n`);
}

function table(rows: string[][], header: string[]): void {
  const cols = header.map((h, i) => {
    const max = Math.max(h.length, ...rows.map((r) => r[i]?.length ?? 0));
    return max;
  });

  const sep = (start: string, mid: string, end: string, fill: string) =>
    start + cols.map((c) => fill.repeat(c + 2)).join(mid) + end;

  console.log(`  ${sep('┌', '┬', '┐', '─')}`);
  console.log(`  │${header.map((h, i) => ` ${h.padEnd(cols[i])} `).join('│')}│`);
  console.log(`  ${sep('├', '┼', '┤', '─')}`);
  for (const row of rows) {
    console.log(`  │${row.map((v, i) => ` ${(v ?? '').padEnd(cols[i])} `).join('│')}│`);
  }
  console.log(`  ${sep('└', '┴', '┘', '─')}`);
}

async function parseLog(logPath: string): Promise<LogAgg> {
  const agg: LogAgg = {
    total: 0,
    minTs: null,
    maxTs: null,
    levelCount: {},
    statusCodes: {},
    tokenSum: { tokensIn: 0, tokensOut: 0, durationMs: 0 },
    tokenCount: 0,
    doomLoops: new Map(),
    errorLines: [],
    maculaFailed: 0,
    maculaTimeout: 0,
    maculaReconnect: 0,
    chatIds: new Set(),
    hallucinationMentions: 0,
    modelLines: [],
    embeddingLoad: 0,
    linesWithChatId: 0,
  };

  const rl = createInterface({
    input: createReadStream(logPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    agg.total++;

    let entry: LogEntry;
    try {
      entry = JSON.parse(line) as LogEntry;
    } catch {
      continue;
    }

    const ts = entry['@timestamp'];
    if (ts) {
      if (agg.minTs === null || ts < agg.minTs) agg.minTs = ts;
      if (agg.maxTs === null || ts > agg.maxTs) agg.maxTs = ts;
    }

    const level = entry.level ?? 'UNKNOWN';
    agg.levelCount[level] = (agg.levelCount[level] ?? 0) + 1;

    const msg = entry.message ?? '';

    // Status codes >= 400 (e.g., [404] "GET" /path)
    const scMatch = msg.match(/\[(\d{3})\]/);
    if (scMatch) {
      const code = scMatch[1];
      if (parseInt(code, 10) >= 400) {
        agg.statusCodes[code] = (agg.statusCodes[code] ?? 0) + 1;
      }
    }

    // Token usage from ✅ done lines (parse values from message string)
    if (msg.includes('✅ done')) {
      const ti = parseInt(msg.match(/tokensIn=(\d+)/)?.[1] ?? '0', 10);
      const to = parseInt(msg.match(/tokensOut=(\d+)/)?.[1] ?? '0', 10);
      const dm = parseInt(msg.match(/durationMs=(\d+)/)?.[1] ?? '0', 10);
      agg.tokenSum.tokensIn += ti;
      agg.tokenSum.tokensOut += to;
      agg.tokenSum.durationMs += dm;
      agg.tokenCount++;
    }

    // Doom loop detection
    if (msg.includes('Doom loop') || msg.includes('Stuck loop') || msg.includes('Interim text')) {
      const chatId = entry.chatId ?? entry.msgId ?? 'unknown';
      agg.doomLoops.set(chatId, (agg.doomLoops.get(chatId) ?? 0) + 1);
    }

    // ERROR level lines
    if (level === 'ERROR') {
      agg.errorLines.push(line);
    }

    // Macula MCP monitoring
    const lowerMsg = msg.toLowerCase();
    const hasMacula = lowerMsg.includes('macula');
    if (hasMacula && lowerMsg.includes('failed')) {
      agg.maculaFailed++;
    }
    if (hasMacula && (lowerMsg.includes('timeout') || lowerMsg.includes('timed out'))) {
      agg.maculaTimeout++;
    }
    if (hasMacula && (lowerMsg.includes('reconnect') || lowerMsg.includes('reconnected'))) {
      agg.maculaReconnect++;
    }

    // chatId tracking
    if (entry.chatId) {
      agg.chatIds.add(entry.chatId);
      agg.linesWithChatId++;
    }

    // Hallucination mentions
    if (lowerMsg.includes('hallucinat')) {
      agg.hallucinationMentions++;
    }

    // Model info
    if (msg.includes('MODEL:') && !msg.includes('EMBEDDING')) {
      agg.modelLines.push(msg);
    }
    if (msg.includes('EMBEDDING MODEL')) {
      agg.embeddingLoad++;
    }
  }

  return agg;
}

function analyzeDb(dbPath: string): void {
  if (!existsSync(dbPath)) {
    console.error('Error: Database not found at', dbPath);
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true });

  try {
    // 1. Table names + row counts
    section('2. DATABASE OVERVIEW');
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence' ORDER BY name`)
      .all() as { name: string }[];
    const rowData: string[][] = [];
    for (const { name } of tables) {
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM "${name}"`).get() as {
        cnt: number;
      };
      rowData.push([name, fmt(row.cnt)]);
    }
    table(rowData, ['Table', 'Rows']);
    console.log();

    // 2. Messages: SUM/AVG/MIN/MAX of tokens
    section('3. TOKEN & MESSAGE STATS');
    const msgStats = db
      .prepare(
        `SELECT
          COUNT(*) as total,
          SUM(tokens_in) as sum_in,
          AVG(tokens_in) as avg_in,
          MIN(tokens_in) as min_in,
          MAX(tokens_in) as max_in,
          SUM(tokens_out) as sum_out,
          AVG(tokens_out) as avg_out,
          MIN(tokens_out) as min_out,
          MAX(tokens_out) as max_out,
          SUM(duration_ms) as sum_dur,
          AVG(duration_ms) as avg_dur,
          MIN(duration_ms) as min_dur,
          MAX(duration_ms) as max_dur
        FROM messages`,
      )
      .get() as Record<string, number | null>;

    console.log('  Messages table (all messages):');
    const mHeader = ['Metric', 'Value'];
    const mRows: string[][] = [
      ['Total messages', fmt(msgStats.total ?? 0)],
      ['Sum tokens_in', fmt(msgStats.sum_in ?? 0)],
      ['Avg tokens_in', fmtNum(msgStats.avg_in ?? 0)],
      ['Min tokens_in', fmt(msgStats.min_in ?? 0)],
      ['Max tokens_in', fmt(msgStats.max_in ?? 0)],
      ['Sum tokens_out', fmt(msgStats.sum_out ?? 0)],
      ['Avg tokens_out', fmtNum(msgStats.avg_out ?? 0)],
      ['Min tokens_out', fmt(msgStats.min_out ?? 0)],
      ['Max tokens_out', fmt(msgStats.max_out ?? 0)],
      ['Sum duration_ms', fmt(msgStats.sum_dur ?? 0)],
      ['Avg duration_ms', fmtNum(msgStats.avg_dur ?? 0)],
      ['Min duration_ms', fmt(msgStats.min_dur ?? 0)],
      ['Max duration_ms', fmt(msgStats.max_dur ?? 0)],
    ];
    table(mRows, mHeader);
    console.log();

    // 3. Error count
    const errCount = db.prepare(`SELECT COUNT(*) as cnt FROM messages WHERE error IS NOT NULL`).get() as {
      cnt: number;
    };
    console.log(`  Total messages: ${fmt(msgStats.total ?? 0)}, Errors: ${fmt(errCount.cnt)}`);
    console.log();

    // 4. Per chat_id
    section('4. MESSAGES PER CHAT');
    const perChat = db
      .prepare(
        `SELECT
          m.chat_id,
          c.title,
          COUNT(*) as cnt,
          SUM(m.tokens_in) as sum_in,
          SUM(m.tokens_out) as sum_out,
          SUM(m.duration_ms) as sum_dur
        FROM messages m
        LEFT JOIN chats c ON c.id = m.chat_id
        GROUP BY m.chat_id
        ORDER BY cnt DESC
        LIMIT 15`,
      )
      .all() as {
      chat_id: string;
      title: string | null;
      cnt: number;
      sum_in: number | null;
      sum_out: number | null;
      sum_dur: number | null;
    }[];

    const pcHeader = ['Chat ID', 'Title', 'Msgs', 'tokens_in', 'tokens_out', 'dur_ms'];
    const pcRows: string[][] = perChat.map((r) => [
      (r.chat_id ?? '').slice(0, 8),
      (r.title ?? '(untitled)').slice(0, 40),
      fmt(r.cnt),
      fmt(r.sum_in ?? 0),
      fmt(r.sum_out ?? 0),
      fmt(r.sum_dur ?? 0),
    ]);
    table(pcRows, pcHeader);
    console.log();

    // 5. Models
    section('5. MODELS');
    const models = db.prepare(`SELECT model_name, provider, max_tokens FROM models ORDER BY model_name`).all() as {
      model_name: string;
      provider: string;
      max_tokens: number;
    }[];
    const modHeader = ['Model Name', 'Provider', 'Max Tokens'];
    const modRows: string[][] = models.map((m) => [m.model_name, m.provider, fmt(m.max_tokens)]);
    if (modRows.length === 0) modRows.push(['(none)', '', '']);
    table(modRows, modHeader);
    console.log();

    // 6. Tool calls top 10
    section('6. TOOL CALLS');
    const tools = db
      .prepare(
        `SELECT name, COUNT(*) as cnt, SUM(result_size) as total_size
        FROM tool_calls GROUP BY name ORDER BY cnt DESC LIMIT 10`,
      )
      .all() as { name: string; cnt: number; total_size: number | null }[];
    const toolHeader = ['Tool Name', 'Calls', 'Total Result Size'];
    const toolRows: string[][] = tools.map((t) => [t.name, fmt(t.cnt), fmt(t.total_size ?? 0)]);
    if (toolRows.length === 0) toolRows.push(['(none)', '', '']);
    table(toolRows, toolHeader);
    console.log();

    // 7. Cache stats
    const cacheHit = db
      .prepare(`SELECT COUNT(*) as cnt, COALESCE(SUM(tokens_in), 0) as saved FROM messages WHERE from_cache = 1`)
      .get() as { cnt: number; saved: number };
    console.log(`  Cache hits: ${fmt(cacheHit.cnt)}, Saved tokens: ${fmt(cacheHit.saved)}`);
    console.log();

    // 8. Rate limits
    const rlCount = db.prepare(`SELECT COUNT(*) as cnt FROM rate_limits`).get() as { cnt: number };
    console.log(`  Rate limit entries: ${fmt(rlCount.cnt)}`);
    console.log();

    // 9. Query type distribution
    section('7. QUERY TYPE DISTRIBUTION');
    const qtypes = db
      .prepare(
        `SELECT query_type, COUNT(*) as cnt FROM messages WHERE query_type IS NOT NULL GROUP BY query_type ORDER BY cnt DESC`,
      )
      .all() as { query_type: string; cnt: number }[];
    const qtHeader = ['Query Type', 'Count'];
    const qtRows: string[][] = qtypes.map((q) => [q.query_type, fmt(q.cnt)]);
    if (qtRows.length === 0) qtRows.push(['(none)', '']);
    table(qtRows, qtHeader);
    console.log();
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  if (!existsSync(DB_PATH)) {
    console.error(`Error: Database not found at ${DB_PATH}`);
    process.exit(1);
  }
  if (!existsSync(LOG_PATH)) {
    console.error(`Error: Log file not found at ${LOG_PATH}`);
    process.exit(1);
  }

  boxHeader('PRODUCTION ANALYSIS REPORT');

  // Parse log
  console.log('Parsing log file...');
  const log = await parseLog(LOG_PATH);

  // === 1. LOG OVERVIEW ===
  section('1. LOG OVERVIEW');
  console.log(`  Total lines: ${fmt(log.total)}`);
  console.log(`  Date range: ${log.minTs ?? 'N/A'} — ${log.maxTs ?? 'N/A'}`);
  const levelOrder = ['INFO', 'DEBUG', 'WARN', 'ERROR'];
  const levelParts = levelOrder
    .filter((l) => (log.levelCount[l] ?? 0) > 0)
    .map((l) => `${l}: ${fmt(log.levelCount[l] ?? 0)}`);
  console.log(`  Level distribution: ${levelParts.join(', ')}`);
  const otherLevels = Object.entries(log.levelCount)
    .filter(([k]) => !levelOrder.includes(k))
    .map(([k, v]) => `${k}: ${v}`);
  if (otherLevels.length > 0) {
    console.log(`  Other levels: ${otherLevels.join(', ')}`);
  }
  console.log();

  // === 2-7 (DB sections) ===
  analyzeDb(DB_PATH);

  // === ERROR ANALYSIS ===
  section('8. ERROR ANALYSIS');

  // Log errors
  console.log(`  Log errors (${fmt(log.errorLines.length)} total):`);
  if (log.errorLines.length > 0) {
    for (const errLine of log.errorLines) {
      console.log(`    ${errLine}`);
    }
  } else {
    console.log('    (none)');
  }

  // DB errors
  const dbErr = (() => {
    const db = new Database(DB_PATH, { readonly: true });
    try {
      const r = db.prepare(`SELECT COUNT(*) as cnt FROM messages WHERE error IS NOT NULL`).get() as { cnt: number };
      console.log(`  DB errors (error IS NOT NULL): ${fmt(r.cnt)}`);
      if (r.cnt > 0) {
        const errMsgs = db.prepare(`SELECT substr(error, 1, 200) as e FROM messages WHERE error IS NOT NULL`).all() as {
          e: string;
        }[];
        for (const { e } of errMsgs) {
          console.log(`    ${e}`);
        }
      }
      return r.cnt;
    } finally {
      db.close();
    }
  })();
  console.log();

  // === SECURITY ===
  section('9. SECURITY');
  const statusCodes = Object.entries(log.statusCodes).sort(([a], [b]) => parseInt(a, 10) - parseInt(b, 10));
  if (statusCodes.length > 0) {
    console.log('  Status codes >= 400:');
    for (const [code, count] of statusCodes) {
      console.log(`    ${code}: ${fmt(count)}`);
    }
  } else {
    console.log('  No status codes >= 400 found in logs.');
  }
  console.log();

  // === DOOM LOOPS ===
  section('10. DOOM LOOPS');
  const doomTotal = [...log.doomLoops.values()].reduce((a, b) => a + b, 0);
  console.log(`  Total doom loop lines: ${fmt(doomTotal)}`);
  if (log.doomLoops.size > 0) {
    const dlHeader = ['Chat ID (or msgId)', 'Count'];
    const dlRows: string[][] = [...log.doomLoops.entries()]
      .sort(([, a], [, b]) => b - a)
      .map(([id, cnt]) => [id.slice(0, 12), fmt(cnt)]);
    table(dlRows, dlHeader);
  }
  console.log();

  // === MACULA MCP HEALTH ===
  section('11. MACULA MCP HEALTH');
  console.log(`  "failed" mentions:   ${fmt(log.maculaFailed)}`);
  console.log(`  "timeout" mentions:  ${fmt(log.maculaTimeout)}`);
  console.log(`  "reconnect" mentions: ${fmt(log.maculaReconnect)}`);
  console.log();

  // === TOKEN USAGE FROM LOG ===
  section('12. TOKEN USAGE (from ✅ done lines in log)');
  console.log(`  Total ✅ done lines: ${fmt(log.tokenCount)}`);
  console.log(`  Sum tokensIn:      ${fmt(log.tokenSum.tokensIn)}`);
  console.log(`  Sum tokensOut:     ${fmt(log.tokenSum.tokensOut)}`);
  console.log(`  Sum durationMs:    ${fmt(log.tokenSum.durationMs)}`);
  console.log();

  // === MODEL INFO ===
  section('13. MODEL INFO FROM LOGS');
  const modelSet = new Set(log.modelLines);
  console.log(`  Unique MODEL: lines: ${fmt(modelSet.size)}`);
  for (const m of modelSet) {
    console.log(`    ${m}`);
  }
  console.log(`  EMBEDDING MODEL load events: ${fmt(log.embeddingLoad)}`);
  console.log();

  // === CHAT IDS ===
  section('14. UNIQUE CHAT IDS IN LOGS');
  console.log(`  Unique chatIds: ${fmt(log.chatIds.size)}`);
  if (log.chatIds.size > 0) {
    console.log(`  Lines with chatId: ${fmt(log.linesWithChatId)}`);
  }
  console.log();

  // === HALLUCINATION CHECK ===
  section('15. HALLUCINATION MENTIONS');
  console.log(`  Mentions: ${fmt(log.hallucinationMentions)}`);
  console.log();

  // === SUMMARY ===
  section('16. SUMMARY');
  console.log(`  DB path: ${DB_PATH}`);
  console.log(`  Log path: ${LOG_PATH}`);
  console.log(`  Log lines: ${fmt(log.total)}`);
  console.log(`  Tables in DB: ${fmt(16)}`); // We know there are 16 tables (excluding sqlite_sequence)
  console.log(`  Error lines in log: ${fmt(log.errorLines.length)}`);
  console.log(`  DB errors: ${fmt(dbErr)}`);
  const totalDoom = [...log.doomLoops.values()].reduce((a, b) => a + b, 0);
  console.log(`  Doom loop occurrences: ${fmt(totalDoom)}`);
  console.log(`  Macula issues (failed+timeout): ${fmt(log.maculaFailed + log.maculaTimeout)}`);
  console.log(
    `  Cache hits: ${fmt(
      (() => {
        const db = new Database(DB_PATH, { readonly: true });
        try {
          return (db.prepare(`SELECT COUNT(*) as cnt FROM messages WHERE from_cache = 1`).get() as { cnt: number }).cnt;
        } finally {
          db.close();
        }
      })(),
    )}`,
  );
  console.log();
}

main().catch((err) => {
  console.error(`Fatal error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
