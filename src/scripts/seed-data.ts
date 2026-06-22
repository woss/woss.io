import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import { embedTexts } from '../lib/server/embed.ts';
import type { SeedQuery } from '../lib/chat/suggested-questions.ts';
import { SEED_QUERIES } from '../lib/chat/suggested-questions.ts';
import type { Logger } from '@logtape/logtape';
import { EMBEDDING_DIM, EMBEDDING_MODEL } from '../lib/search-config.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Result of embedding seed queries and computing centroids */
export interface EmbedResult {
  queries: SeedQuery[];
  vectors: number[][];
  toolCentroid: number[];
  ragCentroid: number[];
  metaCentroid: number[];
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Compute element-wise average of a set of vectors of equal length */
export function averageVector(vecs: number[][]): number[] {
  const dim = vecs[0].length;
  const avg = new Array(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) avg[i] += v[i] / vecs.length;
  return avg;
}

// ---------------------------------------------------------------------------
// Embedding pipeline
// ---------------------------------------------------------------------------

/**
 * Embed all seed queries and compute tool/rag centroids.
 * Uses BGE large en v1.5 via existing embedText pipeline.
 * @returns queries, their vectors, and the two centroids
 */
export async function embedAndComputeCentroids(log: Logger): Promise<EmbedResult> {
  log.debug`Embedding ${SEED_QUERIES.length} seed queries (${SEED_QUERIES.filter((q) => q.class === 'tool').length} tool, ${SEED_QUERIES.filter((q) => q.class === 'rag').length} rag, ${SEED_QUERIES.filter((q) => q.class === 'hybrid').length} hybrid, ${SEED_QUERIES.filter((q) => q.class === 'meta').length} meta)...`;
  const vectors = (await embedTexts(SEED_QUERIES.map((q) => q.text))).map((r) => r.data);

  const toolVecs = vectors.filter((_, i) => SEED_QUERIES[i].class === 'tool');
  const ragVecs = vectors.filter((_, i) => SEED_QUERIES[i].class === 'rag');
  const metaVecs = vectors.filter((_, i) => SEED_QUERIES[i].class === 'meta');

  log.debug`Embedded ${SEED_QUERIES.length} seed queries...`;
  const toolCentroid = averageVector(toolVecs);
  const ragCentroid = averageVector(ragVecs);
  const metaCentroid = averageVector(metaVecs);

  return { queries: SEED_QUERIES, vectors, toolCentroid, ragCentroid, metaCentroid };
}

/**
 * Save centroid data to data/centroid.json.
 * Writes queries, vectors, and centroids for later inspection/loading.
 */
export async function saveCentroids(result: EmbedResult, log: Logger): Promise<void> {
  log.debug`Saving centroids to data/centroid.json...`;
  await storeCentroidHash(
    JSON.stringify({ queries: SEED_QUERIES, model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIM }),
    log,
  );

  const centroidData = {
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIM,
    queries: result.queries.map((q, i) => ({
      text: q.text,
      class: q.class,
      vector: result.vectors[i],
    })),
    centroids: {
      tool: result.toolCentroid,
      rag: result.ragCentroid,
      meta: result.metaCentroid,
    },
  };
  const data = JSON.stringify(centroidData, null, 2);
  await writeFile('./data/centroid.json', data, 'utf-8');
}

async function storeCentroidHash(data: string, log: Logger): Promise<void> {
  const hash = hashCentroidData(data);
  log.debug`Centroid hash: ${hash.slice(0, 12)}...`;
  await writeFile(
    './data/centroid-hash.json',
    JSON.stringify({ hash, comment: 'Hash of seed queries for change detection' }),
    'utf-8',
  );
}

export async function readCentroidHash(): Promise<string | null> {
  try {
    const content = await readFile('./data/centroid-hash.json', 'utf-8');
    const parsed = JSON.parse(content);
    return parsed.hash;
  } catch {
    return null;
  }
}

export async function centroidDataChanged(log: Logger): Promise<boolean> {
  const newHash = hashCentroidData(
    JSON.stringify({ queries: SEED_QUERIES, model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIM }),
  );
  const existingHash = await readCentroidHash();
  const changed = newHash !== existingHash;
  log.debug`centroidDataChanged: changed=${changed}`;
  return changed;
}

export function hashCentroidData(data: string): string {
  const hash = createHash('sha256').update(data).digest('hex');
  return hash;
}
