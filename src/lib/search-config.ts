import { MetricKind, ScalarKind } from 'usearch';
import type { IndexConfig } from 'usearch';

export const EMBEDDING_MODEL = 'Xenova/bge-large-en-v1.5';
export const EMBEDDING_DIM = 1024;

export const SEARCH_INDEX_CONFIG: IndexConfig = {
  dimensions: EMBEDDING_DIM,
  metric: MetricKind.Cos,
  quantization: ScalarKind.BF16,
  connectivity: 16,
  expansion_add: 128,
  expansion_search: 200,
  multi: false,
};
