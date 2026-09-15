import 'dotenv/config';
import { Index, MetricKind, ScalarKind } from 'usearch';
import type { IndexConfig } from 'usearch';
import { VECTOR_INDEX_PATH } from './src/lib/server/schema.js';
import { existsSync } from 'node:fs';
import { downloadEmbedder, embedTexts, releaseExtractor } from './src/lib/server/embed.js';
import { configure, getConsoleSink, dispose } from '@logtape/logtape';

const SEARCH_INDEX_CONFIG: IndexConfig = {
  dimensions: 1024,
  metric: MetricKind.Cos,
  quantization: ScalarKind.BF16,
  connectivity: 16,
  expansion_add: 128,
  expansion_search: 200,
  multi: false,
};

async function main() {
  try {
    await configure({ sinks: { console: getConsoleSink() }, filters: {} });
  } catch {}

  // 1. Check the USearch index file
  console.log('VECTOR_INDEX_PATH:', VECTOR_INDEX_PATH);
  console.log('Index file exists:', existsSync(VECTOR_INDEX_PATH));
  if (existsSync(VECTOR_INDEX_PATH)) {
    const stat = await import('node:fs').then((fs) => fs.statSync(VECTOR_INDEX_PATH));
    console.log('Index file size:', stat.size, 'bytes');
  }

  // 2. Load the index and inspect it
  const idx = new Index(SEARCH_INDEX_CONFIG);
  if (existsSync(VECTOR_INDEX_PATH)) {
    idx.load(VECTOR_INDEX_PATH);
  }

  console.log('Index dimensions:', idx.dimensions());
  console.log('Index size:', idx.size());
  console.log('Index capacity:', idx.capacity());

  console.log('\n--- Test 1: search with random vector (should return results) ---');
  const randomVec = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) randomVec[i] = Math.random() - 0.5;
  const r1 = idx.search(randomVec, 10, 0);
  console.log('Random search:', {
    keyCount: r1.keys.length,
    keys: Array.from(r1.keys),
    distances: Array.from(r1.distances),
  });

  console.log('\n--- Test 2: search with zero vector ---');
  const zeroVec = new Float32Array(1024);
  const r2 = idx.search(zeroVec, 10, 0);
  console.log('Zero search:', {
    keyCount: r2.keys.length,
    keys: Array.from(r2.keys),
    distances: Array.from(r2.distances),
  });

  console.log('\n--- Test 3: embed a real query and search ---');
  await downloadEmbedder();
  const queryEmbed = await embedTexts(['How many years of experience does Daniel have?']);
  console.log('Query result type:', typeof queryEmbed[0], 'keys:', Object.keys(queryEmbed[0]));
  console.log('Query data length:', queryEmbed[0].data.length);
  const qv = new Float32Array(queryEmbed[0].data);
  const r3 = idx.search(qv, 10, 0);
  console.log('Real query results:', {
    keyCount: r3.keys.length,
    keys: Array.from(r3.keys),
    distances: Array.from(r3.distances),
  });

  await releaseExtractor();
  await dispose();
}

main().catch(console.error);
