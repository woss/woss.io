/**
 * Semantic cache for LLM responses.
 * Uses USearch (ANN index) for similar-question lookup + shared SQLite for answer storage.
 * Same embedding model as the RAG pipeline (bge-large-en-v1.5, 1024-dim).
 *
 * Cache key: question embedding vector → cosine similarity search
 * On hit (similarity ≥ threshold): return cached answer immediately
 * On miss: store new (question, answer) pair for future hits
 *
 * SQLite lives in vectors.db (shared with RAG index and chat history),
 * USearch index is separate (cache.usearch) since it indexes question embeddings,
 * not content chunk embeddings.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Index, MetricKind, ScalarKind } from 'usearch';
import { EMBEDDING_DIM } from '../search-config.ts';
import { getDb } from './db.ts';
import { config } from './config.ts';
import { CAT, createLogger } from './logger';

const log = createLogger(CAT.llm);

/** @group Configuration */

const CACHE_INDEX_PATH = join(process.cwd(), 'data', 'cache.usearch');

/**
 * Cosine-distance threshold for cache hits.
 * USearch cosine distance: 0 = identical, 1 = opposite.
 * 0.04 ≈ 96% similarity — catches exact repeats and close paraphrases.
 */
const HIT_THRESHOLD = 0.04;

/** @group State */

let _index: Index | null = null;

/** @group Internal helpers */

/**
 * Strip <tool_calls>...</tool_calls> blocks from LLM responses.
 * Defense-in-depth: prevents cached XML tool calls from being rendered.
 */
function stripToolCallXml(text: string): string {
  return text.replace(/<tool_calls>[\s\S]*?<\/tool_calls>/g, '');
}

function getIndex(): Index {
  if (_index) return _index;

  const idx = new Index({
    dimensions: EMBEDDING_DIM,
    metric: MetricKind.Cos,
    connectivity: 16,
    expansion_add: 200,
    expansion_search: 200,
    quantization: ScalarKind.F32,
    multi: false,
  });

  if (existsSync(CACHE_INDEX_PATH)) {
    idx.load(CACHE_INDEX_PATH);
  }

  _index = idx;
  return idx;
}

function saveIndex(): void {
  if (_index) {
    _index.save(CACHE_INDEX_PATH);
  }
}

/** @group Public API */

/**
 * Check the semantic cache for a question with similar embedding.
 *
 * @param embedding - Query embedding vector (1024-dim Float32Array-compatible)
 * @returns Cached { answer, sources } if a similar entry exists, null otherwise
 */
export function checkCache(
  embedding: number[],
): { answer: string; sources: string; toolCalls?: { name: string; serverId: string }[] } | null {
  const idx = getIndex();
  if (idx.size() === 0) return null;

  const query = new Float32Array(embedding);
  const results = idx.search(query, 1, 0);

  if (!results.keys.length) return null;

  const cacheId = Number(results.keys[0]);
  const distance = results.distances[0];

  if (distance > HIT_THRESHOLD) return null;

  const db = getDb();
  const row = db.prepare('SELECT answer, sources, tool_calls, created_at FROM llm_cache WHERE id = ?').get(cacheId) as
    | { answer: string; sources: string; tool_calls: string | null; created_at: string }
    | undefined;

  if (!row) return null;

  // TTL check — treat expired entries as cache misses
  const createdAt = new Date(row.created_at).getTime();
  if (createdAt < Date.now() - config().llmCache.ttlSec * 1000) return null;
  const toolCalls: { name: string; serverId: string }[] = row.tool_calls ? JSON.parse(row.tool_calls) : [];
  return { answer: stripToolCallXml(row.answer), sources: row.sources, toolCalls };
}

/**
 * Store a question-answer pair in the semantic cache.
 * The embedding is indexed for future similarity lookups.
 *
 * @param embedding - Query embedding vector (1024-dim)
 * @param question  - Original question text (for debugging)
 * @param answer    - LLM-generated answer (markdown)
 * @param sources   - JSON-stringified source array
 */
export function storeCache(
  embedding: number[],
  question: string,
  answer: string,
  sources: string,
  messageId?: string,
  toolCalls?: { name: string; serverId: string }[],
): void {
  if (!answer) return; // Don't cache empty answers

  const db = getDb();
  const idx = getIndex();

  const result = db
    .prepare('INSERT INTO llm_cache (question, answer, sources, tool_calls, message_id) VALUES (?, ?, ?, ?, ?)')
    .run(question, stripToolCallXml(answer), sources, JSON.stringify(toolCalls ?? []), messageId ?? null);

  const vector = new Float32Array(embedding);
  try {
    idx.add(BigInt(result.lastInsertRowid), vector);
    saveIndex();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn`[llm-cache] failed to add to index: ${msg}`;
    // Index may have stale entries from cache clearing. Non-fatal — cache will
    // still work on next insertion with a fresh ID.
  }
}
