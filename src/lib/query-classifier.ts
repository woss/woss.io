import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.llm);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QueryClass = 'tool' | 'rag' | 'hybrid' | 'meta';

interface CentroidsData {
  tool: number[];
  rag: number[];
  meta: number[];
}

// ---------------------------------------------------------------------------
// Centroid loading — reads at module init, caches forever
// ---------------------------------------------------------------------------

let _centroids: CentroidsData | null = null;

function loadCentroids(): CentroidsData {
  if (_centroids) return _centroids;

  const centroidPath = join(process.cwd(), 'data', 'centroid.json');
  const raw = readFileSync(centroidPath, 'utf-8');
  const parsed = JSON.parse(raw);
  _centroids = parsed.centroids as CentroidsData;
  return _centroids;
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const mag = Math.sqrt(na) * Math.sqrt(nb);
  return mag > 0 ? dot / mag : 0;
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const THRESHOLD = 0.09; // tunable — gap needed to choose one class over another

/**
 * Classify a query embedding as tool, rag, or hybrid.
 * Compares cosine similarity against pre-computed tool/rag centroids.
 * Uses same BGE embedding already computed for RAG search — no extra model calls.
 *
 * @param embedding — 1024-dim BGE embedding vector from embedText()
 * @returns 'tool' if query leans toward tool (GitHub/PR/issues), 'rag' if toward experience, 'hybrid' if ambiguous
 */
export function classifyQuery(embedding: number[]): QueryClass {
  const centroids = loadCentroids();

  const toolSim = cosineSimilarity(embedding, centroids.tool);
  const ragSim = cosineSimilarity(embedding, centroids.rag);
  const metaSim = cosineSimilarity(embedding, centroids.meta);

  // Find the highest similarity
  const scores = [
    { cls: 'tool' as QueryClass, sim: toolSim },
    { cls: 'rag' as QueryClass, sim: ragSim },
    { cls: 'meta' as QueryClass, sim: metaSim },
  ];

  scores.sort((a, b) => b.sim - a.sim);
  log.debug`Query classification scores: ${JSON.stringify(scores)}`;
  const [best, second] = scores;

  if (best.sim - second.sim > THRESHOLD) return best.cls;
  return 'hybrid';
}
