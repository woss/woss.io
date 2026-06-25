/**
 * Cross-encoder re-ranker via Transformers.js (ONNX).
 *
 * Uses AutoModelForSequenceClassification + AutoTokenizer directly (not pipeline)
 * so we can pass `text_pair` to the tokenizer — required for cross-encoders to
 * process query+chunk pairs through full attention.
 *
 * BGE-reranker-base is an XLMRobertaForSequenceClassification cross-encoder:
 * it takes (query, passage) pairs and outputs a relevance score (0-1).
 * This catches false positives that cosine distance misses.
 *
 * Lazy singleton pattern matches embed.ts:29-40.
 */
import { env, AutoModelForSequenceClassification, AutoTokenizer } from '@huggingface/transformers';
import { join } from 'node:path';
import { softmax } from '../utils/maths';
import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.content);

// Same cache dir as embed.ts
env.cacheDir = join(process.cwd(), 'data', '.hf-cache');

/** ONNX cross-encoder model for re-ranking. */
const RERANKER_MODEL = 'Xenova/bge-reranker-base';

// ---------------------------------------------------------------------------
// Lazy singleton (promise-based mutex)
// ---------------------------------------------------------------------------
// Use `any` for model/tokenizer types to avoid complex Transformers.js generics.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _model: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _tokenizer: any = null;
let _loading: Promise<boolean> | null = null;

async function loadReranker(): Promise<boolean> {
  if (_model && _tokenizer) return true;
  if (_loading) return _loading;

  _loading = (async () => {
    try {
      log.info(`Loading cross-encoder model: ${RERANKER_MODEL}`);
      const start = performance.now();

      _tokenizer = await AutoTokenizer.from_pretrained(RERANKER_MODEL);
      _model = await AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL, {
        dtype: 'fp32',
      });

      log.info(`Cross-encoder loaded in ${(performance.now() - start).toFixed(0)}ms`);
      return true;
    } catch (err) {
      log.error`Failed to load cross-encoder model ${RERANKER_MODEL}: ${err}`;
      _model = null;
      _tokenizer = null;
      _loading = null;
      return false;
    }
  })();

  return _loading;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Result of re-ranking a single chunk.
 * Preserves the original cosine score alongside the cross-encoder score.
 */
export interface RerankedResult {
  /** Original chunk data (passthrough). */
  chunk: { text: string };
  /** Original USearch cosine distance (0 = identical, lower = better). */
  cosineScore: number;
  /** Cross-encoder relevance score (0-1, higher = more relevant). */
  rerankerScore: number;
}

/**
 * Re-rank search results using a cross-encoder.
 *
 * Takes the original query + USearch results, runs each (query, chunk)
 * pair through the cross-encoder, and returns results sorted by
 * reranker score descending.
 *
 * Gracefully degrades: if the model fails to load, returns original
 * results with rerankerScore=0 (caller should fall back to cosine).
 */
export async function rerankSearchResults(
  query: string,
  results: Array<{ chunk: { text: string }; score: number }>,
): Promise<RerankedResult[]> {
  if (!results.length) return [];

  const loaded = await loadReranker();
  if (!loaded || !_model || !_tokenizer) {
    log.warn`Cross-encoder unavailable — falling back to cosine-only ordering`;
    return results.map((r) => ({
      chunk: r.chunk,
      cosineScore: r.score,
      rerankerScore: 0,
    }));
  }

  log.info`Re-ranking ${results.length} chunks with cross-encoder`;

  const start = performance.now();

  // 1. Tokenize with text_pair so the tokenizer produces
  //    [CLS] query [SEP] chunk [SEP] with proper token_type_ids.
  const inputs = await _tokenizer(
    results.map(() => query),
    {
      text_pair: results.map((r) => r.chunk.text),
      padding: true,
      truncation: true,
      return_tensor: true,
    },
  );

  // 2. Run cross-encoder inference
  const outputs = await _model(inputs);
  const logits = outputs.logits;

  // 3. Convert logits to scores
  //    BGE-reranker-v2-m3 outputs 2 logits per pair: [non_relevant, relevant].
  //    We take the softmax and use the score for the positive class (index 1).
  const flatLogits = Array.from(logits.data) as number[];
  const dims = logits.dims as number[];
  const numLabels = dims[dims.length - 1]; // usually 2
  const batchSize = results.length;

  const enriched: RerankedResult[] = [];
  for (let i = 0; i < batchSize; i++) {
    const row = flatLogits.slice(i * numLabels, (i + 1) * numLabels);

    let score: number;
    if (numLabels === 1) {
      // Regression model: single logit, apply sigmoid
      score = 1 / (1 + Math.exp(-row[0]));
    } else {
      // Classification model: softmax over 2+ labels
      const probs = softmax(row);
      score = probs[1] ?? probs[0]; // LABEL_1 = relevant
    }

    enriched.push({
      chunk: results[i].chunk,
      cosineScore: results[i].score,
      rerankerScore: score,
    });
  }

  // 4. Sort by reranker score descending
  enriched.sort((a, b) => b.rerankerScore - a.rerankerScore);

  log.info`Re-ranking done in ${(performance.now() - start).toFixed(0)}ms — top score: ${enriched[0].rerankerScore.toFixed(4)}`;

  return enriched;
}

/**
 * Release the cross-encoder model and tokenizer to free ~1.1 GB memory.
 */
export async function releaseReranker(): Promise<void> {
  if (_model) {
    await _model.dispose();
    _model = null;
  }
  _tokenizer = null;
  _loading = null;
  log.info('Cross-encoder model released');
}

/**
 * Eagerly download the cross-encoder model to disk cache.
 *
 * Called during `build-index` so the model is cached at
 * `data/.hf-cache/` before the server starts. Shows real-time
 * download progress via Transformers.js progress_callback.
 * The runtime lazy loader finds the cached files and skips download.
 */
export async function downloadReranker(
  onProgress?: (pct: number, loadedBytes: number, totalBytes: number) => void,
): Promise<void> {
  if (!onProgress) log.info(`Downloading cross-encoder model: ${RERANKER_MODEL}`);
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onProgressCb = (info: any) => {
      if (info.status === 'progress_total') {
        const pct = Math.round(info.progress);
        if (onProgress) {
          onProgress(pct, info.loaded, info.total);
        } else {
          log.info`${RERANKER_MODEL}: ${pct}% (${(info.loaded / 1024 / 1024).toFixed(0)}MB/${(info.total / 1024 / 1024).toFixed(0)}MB)`;
        }
      }
    };
    await AutoTokenizer.from_pretrained(RERANKER_MODEL, {
      progress_callback: onProgressCb,
    });
    const model = await AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL, {
      dtype: 'fp32',
      progress_callback: onProgressCb,
    });
    await model.dispose();
    // tokenizer is small, no explicit dispose needed
    log.info(`Cross-encoder model cached.`);
  } catch (err) {
    log.error`Failed to download cross-encoder model ${RERANKER_MODEL}: ${err}`;
    log.warn('Re-ranker will fall back to cosine-only at runtime');
  }
}
