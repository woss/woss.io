/**
 * Local text embeddings via Transformers.js (ONNX).
 * No server required — model runs in-process.
 *
 * Two exports:
 *   embedText(single)  — one query → one vector (for API routes)
 *   embedTexts(batch)  — N texts → N vectors (for indexing)
 */
import { env, pipeline } from '@huggingface/transformers';
import { join } from 'node:path';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { EMBEDDING_MODEL } from '../search-config.ts';
import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.content);

// Persist HuggingFace model cache inside shared data volume so it survives container rebuilds
env.cacheDir = join(process.cwd(), 'data', '.hf-cache');

let _extractor: FeatureExtractionPipeline | null = null;
let _extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

/**
 * Get or create the feature-extraction pipeline (lazy init, cached after first call).
 *
 * Uses a promise-based mutex to prevent thundering herd: concurrent callers
 * await the same pending promise instead each triggering their own ~1.3 GB model load.
 */
async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (_extractor) return _extractor;
  if (!_extractorPromise) {
    _extractorPromise = pipeline('feature-extraction', EMBEDDING_MODEL, {
      dtype: 'fp32',
    }).then((p) => {
      _extractor = p;
      return _extractor;
    });
  }
  return _extractorPromise;
}

/**
 * Embed a single text string into one vector.
 * Used by API routes for query embedding.
 */
export async function embedText(text: string): Promise<{ data: number[]; dimensions: number }> {
  if (!text || !text.trim()) {
    throw new Error('Cannot embed empty text');
  }

  log.info('Generating embedding for text', { length: text.length });
  const extractor = await getExtractor();
  const result = await extractor([text], {
    pooling: 'mean',
    normalize: true,
  });
  const dimensions = result.dims[result.dims.length - 1];
  log.info('Embedding generated successfully', { dimensions });
  return { data: Array.from(result.data), dimensions };
}

/**
 * Embed multiple texts in one batch inference.
 * More efficient than N sequential calls — the ONNX model processes the batch together.
 * Returns one embedding vector per input text.
 */
export async function embedTexts(texts: string[]): Promise<Array<{ data: number[]; dimensions: number }>> {
  if (!texts.length) return [];

  log.info('Generating embeddings for batch', { batchSize: texts.length });
  const extractor = await getExtractor();
  const result = await extractor(texts, {
    pooling: 'mean',
    normalize: true,
  });
  const dims = result.dims;
  const dimensions = dims[dims.length - 1];
  const flat = Array.from(result.data);

  const embeddings: Array<{ data: number[]; dimensions: number }> = [];
  for (let i = 0; i < texts.length; i++) {
    embeddings.push({
      data: flat.slice(i * dimensions, (i + 1) * dimensions),
      dimensions,
    });
  }
  log.info('Batch embedding completed', { count: embeddings.length, dimensions });
  return embeddings;
}

/**
 * Release the cached feature-extraction pipeline to free ~1.3GB of model memory.
 * Call this when embedding is done for the current phase (e.g. after centroid compute).
 * The pipeline will be re-created on the next call to embedText / embedTexts.
 */
export async function releaseExtractor(): Promise<void> {
  if (_extractor) {
    await _extractor.dispose();
    _extractor = null;
    _extractorPromise = null;
  }
}
