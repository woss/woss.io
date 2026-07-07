/**
 * Semantic cache for LLM responses.
 * Uses SurrealDB vector search for similar-question lookup + answer storage.
 * Same embedding model as the RAG pipeline (bge-large-en-v1.5, 1024-dim).
 *
 * Cache key: question embedding vector → cosine similarity search
 * On hit (similarity ≥ threshold): return cached answer immediately
 * On miss: store new (question, answer) pair for future hits
 */
import { config } from './config.ts';
import { db } from '$lib/server/db';

/** @group Configuration */

/**
 * Cosine-distance threshold for cache hits.
 * Cosine distance: 0 = identical, 1 = opposite.
 * 0.04 ≈ 96% similarity — catches exact repeats and close paraphrases.
 */
const HIT_THRESHOLD = 0.04;

/** @group Internal helpers */

/**
 * Strip <tool_calls>...</tool_calls> blocks from LLM responses.
 * Defense-in-depth: prevents cached XML tool calls from being rendered.
 */
function stripToolCallXml(text: string): string {
  return text.replace(/<tool_calls>[\s\S]*?<\/tool_calls>/g, '');
}

/** @group Public API */

/**
 * Check the semantic cache for a question with similar embedding.
 *
 * @param embedding - Query embedding vector (1024-dim Float32Array-compatible)
 * @returns Cached { answer, sources } if a similar entry exists, null otherwise
 */
export async function checkCache(
  embedding: number[],
): Promise<{ answer: string; sources: string; toolCalls?: { name: string; serverId: string }[] } | null> {
  const hits = await db.llmCache.searchCache(embedding, 1);
  if (hits.length === 0) return null;

  const hit = hits[0];
  // Check cosine distance threshold (lower = more similar)
  if (hit.score !== undefined && hit.score > HIT_THRESHOLD) return null;

  // TTL check — treat expired entries as cache misses
  if (hit.createdAt) {
    const createdAt = new Date(hit.createdAt).getTime();
    if (createdAt < Date.now() - config().llmCache.ttlSec * 1000) return null;
  }

  return { answer: stripToolCallXml(hit.answer), sources: hit.sources, toolCalls: hit.toolCalls };
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
export async function storeCache(
  embedding: number[],
  question: string,
  answer: string,
  sources: string,
  messageId?: string,
  toolCalls?: { name: string; serverId: string }[],
): Promise<void> {
  if (!answer) return; // Don't cache empty answers

  const toolCallsStr = toolCalls?.map((tc) => JSON.stringify(tc)).join('\n');
  await db.llmCache.setCached(question, stripToolCallXml(answer), embedding, sources, toolCallsStr, messageId);
}
