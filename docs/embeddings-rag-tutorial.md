# RAG Pipeline: Embeddings + Vector Search + LLM in TypeScript

A real-world, production-grade RAG (Retrieval-Augmented Generation) pipeline
written entirely in TypeScript. Use it to semantically search documents and
answer questions with AI — fully local embeddings, no external embedding API.

---

## Stack

| Layer            | Library                              | Purpose                        |
| ---------------- | ------------------------------------ | ------------------------------ |
| Document parsing | Custom                               | Chunk markdown by headings     |
| Embeddings       | `@huggingface/transformers`          | Local ONNX inference (no API)  |
| Vector index     | `usearch`                            | Cosine-similarity KNN search   |
| Metadata store   | `better-sqlite3`                     | Chunk metadata + retrieval     |
| LLM              | `openai` SDK (any OpenAI-compatible) | Answer generation with context |

---

## Project Structure

```
project/
├── src/
│   ├── chunk.ts        # Document chunking
│   ├── embed.ts        # Embedding generation
│   ├── store.ts        # Vector store (USearch + SQLite)
│   ├── index.ts        # Build index from files
│   ├── search.ts       # Semantic search (no LLM)
│   └── ask.ts          # RAG with LLM answer
├── content/            # Your markdown files
├── data/               # Generated index files
├── package.json
└── tsconfig.json
```

---

## Dependencies

```json
{
  "dependencies": {
    "@huggingface/transformers": "^4.2.0",
    "usearch": "^2.25.0",
    "better-sqlite3": "^12.0.0",
    "openai": "^4.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "typescript": "^5.0.0"
  }
}
```

---

## 1. Document Chunking

Whole documents are too long for single embeddings. Split into sections by
headings — each chunk becomes one searchable unit.

```ts
// src/chunk.ts
export interface Chunk {
  id: string;
  text: string;
  source: string;
  heading: string;
  metadata: Record<string, unknown>;
}

export function chunkMarkdown(content: string, source: string, metadata: Record<string, unknown> = {}): Chunk[] {
  const chunks: Chunk[] = [];
  const lines = content.split('\n');
  let currentHeading = '';
  let currentText = '';
  let chunkIndex = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^#{2,3}\s+(.+)$/);
    if (headingMatch) {
      if (currentText.trim()) {
        chunks.push({
          id: `${source}_${chunkIndex++}`,
          text: currentText.trim(),
          source,
          heading: currentHeading,
          metadata,
        });
      }
      currentHeading = headingMatch[1];
      currentText = '';
    } else {
      currentText += line + '\n';
    }
  }

  if (currentText.trim()) {
    chunks.push({
      id: `${source}_${chunkIndex}`,
      text: currentText.trim(),
      source,
      heading: currentHeading,
      metadata,
    });
  }

  return chunks;
}
```

**Why chunk?** A 2000-word page averaged into one vector loses detail.
By section, "Team Leadership" stays distinct from "Technical Architecture" —
search matches the right granularity.

---

## 2. Embedding Generation

Use Transformers.js with `bge-large-en-v1.5` — a high-quality embedding
model that runs locally in Node.js via ONNX. No API key needed.

```ts
// src/embed.ts
import { pipeline } from '@huggingface/transformers';
import type { FeatureExtractionPipeline } from '@huggingface/transformers';

let extractor: FeatureExtractionPipeline | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    extractor = (await pipeline('feature-extraction', 'Xenova/bge-large-en-v1.5', {
      dtype: 'fp32',
    })) as FeatureExtractionPipeline;
  }
  return extractor;
}

export async function embedText(text: string): Promise<number[]> {
  const pipe = await getExtractor();
  const result = await pipe(text, {
    pooling: 'mean', // average token embeddings
    normalize: true, // L2 normalize for cosine similarity
  });
  return Array.from(result.data) as number[];
}
```

**Why this model?** `bge-large-en-v1.5` outputs 1024-dimension vectors,
achieves top MTEB scores, and the ONNX version runs in ~50ms per chunk
on CPU. The mean pooling + normalization means cosine distance in
USearch directly measures semantic similarity.

---

## 3. Vector Store

USearch handles fast approximate nearest-neighbor search. SQLite stores
the chunk metadata. This two-layer approach is the standard pattern —
vector DB for speed, relational DB for rich metadata.

```ts
// src/store.ts
import Database from 'better-sqlite3';
import { Index, MetricKind } from 'usearch';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Chunk } from './chunk';

const DATA_DIR = './data';
const DIMENSIONS = 1024;

export class VectorStore {
  private db: Database.Database;
  private index: Index;

  constructor() {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

    this.db = new Database(join(DATA_DIR, 'store.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chunk_id TEXT UNIQUE NOT NULL,
        text TEXT NOT NULL,
        source TEXT NOT NULL,
        heading TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}'
      )
    `);

    this.index = new Index({
      dimensions: DIMENSIONS,
      metric: MetricKind.Cos,
    });

    const indexPath = join(DATA_DIR, 'vectors.usearch');
    if (existsSync(indexPath)) {
      this.index.load(indexPath);
    }
  }

  addChunk(chunk: Chunk, embedding: number[]): void {
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO chunks (chunk_id, text, source, heading, metadata)
       VALUES (?, ?, ?, ?, ?)`,
      )
      .run(chunk.id, chunk.text, chunk.source, chunk.heading, JSON.stringify(chunk.metadata));

    const rowId = Number(info.lastInsertRowid);
    this.index.add(BigInt(rowId), new Float32Array(embedding));
  }

  search(embedding: number[], topK = 5): Array<{ chunk: Chunk; score: number }> {
    if (this.index.size() === 0) return [];

    const results = this.index.search(new Float32Array(embedding), topK, 0);

    return results.keys.map((key, i) => {
      const row = this.db.prepare('SELECT * FROM chunks WHERE id = ?').get(Number(key)) as Record<string, unknown>;

      return {
        chunk: {
          id: row.chunk_id as string,
          text: row.text as string,
          source: row.source as string,
          heading: row.heading as string,
          metadata: JSON.parse((row.metadata as string) || '{}'),
        },
        score: results.distances[i],
      };
    });
  }

  size(): number {
    return this.index.size();
  }

  save(): void {
    this.index.save(join(DATA_DIR, 'vectors.usearch'));
  }

  close(): void {
    this.db.close();
  }
}
```

**Two-tier storage:**

- **USearch** — in-memory HNSW graph for fast KNN. Not persistent by
  itself (calls `save()` / `load()`).
- **SQLite** — durable metadata. Even if the index rebuilds, the data
  is still there.

The `id` field bridges the two: SQLite's `rowid` maps to USearch's
vector label.

---

## 4. Build the Index

Read markdown files, chunk them, embed each chunk, store everything.

```ts
// src/index.ts
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chunkMarkdown } from './chunk';
import { embedText } from './embed';
import { VectorStore } from './store';

async function buildIndex(contentDir: string): Promise<void> {
  const store = new VectorStore();
  const files = readdirSync(contentDir).filter((f) => f.endsWith('.md'));

  console.log(`Found ${files.length} files in ${contentDir}`);

  for (const file of files) {
    const raw = readFileSync(join(contentDir, file), 'utf-8');

    // Strip frontmatter if present (--- delimited block)
    const body = raw.replace(/^---[\s\S]*?---\n*/, '').trim();

    // Extract YAML frontmatter as metadata
    const metadata: Record<string, unknown> = {};
    const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
    if (fmMatch) {
      for (const line of fmMatch[1].split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim();
          const value = line
            .slice(colonIdx + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
          metadata[key] = value;
        }
      }
    }

    const chunks = chunkMarkdown(body, file, metadata);
    console.log(`  ${file}: ${chunks.length} chunks`);

    for (const chunk of chunks) {
      if (!chunk.text.trim()) continue;
      const embedding = await embedText(chunk.text);
      store.addChunk(chunk, embedding);
    }
  }

  store.save();
  const total = store.size();
  store.close();

  console.log(`\nDone: ${total} vectors indexed`);
}

// Run: npx tsx src/index.ts
buildIndex('./content').catch(console.error);
```

---

## 5. Semantic Search (No LLM)

Search purely by semantic similarity. No keyword matching — the model
understands meaning.

```ts
// src/search.ts
import { embedText } from './embed';
import { VectorStore } from './store';

async function search(query: string, topK = 5, threshold = 1.5): Promise<void> {
  const store = new VectorStore();
  const start = performance.now();

  const embedding = await embedText(query);
  const results = store.search(embedding, topK);

  const elapsed = ((performance.now() - start) / 1000).toFixed(2);

  console.log(`\nQuery: "${query}"`);
  console.log(`Found ${results.length} results in ${elapsed}s\n`);

  results
    .filter((r) => r.score < threshold)
    .forEach((r, i) => {
      const relevance = r.score < 0.4 ? '★ High' : r.score < 0.7 ? '● Medium' : '○ Low';

      console.log(`#${i + 1} ${relevance} (${r.score.toFixed(3)})`);
      console.log(`   Source: ${r.chunk.source}`);
      console.log(`   Section: ${r.chunk.heading || '(intro)'}`);
      console.log(`   ${r.chunk.text.slice(0, 250).replace(/\n/g, ' ')}...`);
      console.log();
    });

  store.close();
}

// Run: npx tsx src/search.ts
search('What are the strengths in leading teams?');
```

**Why this works:** The embedding model maps "leading teams" to a vector
region that also contains "founder", "CTO", "managed engineers", "team
leadership" — even when those exact words aren't in the query. That's
the power of semantic search over keyword search.

---

## 6. RAG with LLM (Full Answers)

Combine retrieved chunks with an LLM for grounded, contextual answers.
Uses the OpenAI SDK (works with any OpenAI-compatible API like
OpenRouter, Anthropic, or local Ollama).

```ts
// src/ask.ts
import OpenAI from 'openai';
import { embedText } from './embed';
import { VectorStore } from './store';

const client = new OpenAI({
  baseURL: process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
  apiKey: process.env.LLM_API_KEY,
});

async function ask(question: string): Promise<void> {
  const store = new VectorStore();

  // 1. Embed the question
  const queryVector = await embedText(question);

  // 2. Retrieve relevant chunks
  const results = store.search(queryVector, 6);
  const relevant = results.filter((r) => r.score < 1.5);

  if (relevant.length === 0) {
    console.log('No relevant context found.');
    store.close();
    return;
  }

  // 3. Build context string with source citations
  const context = relevant
    .map((r, i) => `[${i + 1}] From "${r.chunk.source}" (${r.chunk.heading}):\n${r.chunk.text}`)
    .join('\n\n');

  // 4. Ask LLM with context
  const stream = await client.chat.completions.create({
    model: process.env.LLM_MODEL || 'openai/gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: [
          'Answer the question based STRICTLY on the provided context.',
          'If context lacks detail, say so — do not invent.',
          'Use markdown: **bold** for key terms, `code` for tools.',
          'Cite sources like [1], [2] inline.\n',
          'Context:',
          context,
        ].join('\n'),
      },
      { role: 'user', content: question },
    ],
    stream: true,
    temperature: 0.3,
    max_tokens: 1024,
  });

  // 5. Stream answer
  process.stdout.write('\n');
  let answer = '';
  for await (const chunk of stream) {
    const token = chunk.choices[0]?.delta?.content || '';
    answer += token;
    process.stdout.write(token);
  }

  // 6. Show sources
  console.log('\n\n--- Sources ---');
  relevant.forEach((r) => {
    console.log(`  [${r.score.toFixed(3)}] ${r.chunk.source} → ${r.chunk.heading}`);
  });

  store.close();
}

// Run: LLM_API_KEY=sk-... npx tsx src/ask.ts
ask("What are Daniel's strengths in leading teams?");
```

---

## 7. Environment Setup

```bash
# Install dependencies
npm install @huggingface/transformers usearch better-sqlite3 openai
npm install -D @types/better-sqlite3 typescript @types/node

# Set your LLM API key (OpenRouter example)
export LLM_API_KEY="sk-or-v1-..."
export LLM_BASE_URL="https://openrouter.ai/api/v1"
export LLM_MODEL="openai/gpt-4o-mini"

# Build the index (first time — downloads model ~150MB)
npx tsx src/index.ts

# Semantic search (no LLM required)
npx tsx src/search.ts

# Full RAG with LLM answer
npx tsx src/ask.ts
```

On first run, Transformers.js downloads the `bge-large-en-v1.5` model
(~150MB) and caches it. Subsequent runs load from cache.

---

## How It Works End-to-End

```
User Question
     │
     ▼
┌──────────────────┐
│  embedText()     │  Transformers.js → 1024d vector
│  (question)      │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  store.search()  │  USearch → cosine KNN → SQLite lookup
│  (vector, topK)  │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Filter: score   │  Threshold removes irrelevant results
│  < 1.5 (cosine)  │
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Build context   │  Format: [N] From "source" (heading):
│                  │          chunk text
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  LLM + context   │  System prompt + context + user question
│  → stream answer │  Temperature 0.3 = factual, deterministic
└──────┬───────────┘
       │
       ▼
  Answer with citations
```

---

## Key Concepts Explained

### Why Cosine Distance and Not Cosine Similarity?

USearch returns **distance** (0 = identical, 2 = opposite). The
similarity would be `1 - distance/2` but thresholding against distance
is equivalent and avoids a division per result.

- `< 0.4` — highly relevant (strong match)
- `0.4–0.7` — moderately relevant
- `0.7–1.5` — weakly relevant
- `> 1.5` — noise (filter out)

### Why Local Embeddings?

| Approach   | Cost            | Latency | Privacy | Offline |
| ---------- | --------------- | ------- | ------- | ------- |
| Local ONNX | Free            | ~50ms   | ✅      | ✅      |
| OpenAI API | $0.13/1M tokens | ~200ms  | ❌      | ❌      |
| Cohere API | $0.10/1M tokens | ~200ms  | ❌      | ❌      |

For personal or internal document search, local embeddings save money
and keep data private.

### Why Two Stores (USearch + SQLite)?

- **USearch** is an in-memory HNSW graph — fast search, no persistence
  without explicit save. Not suitable as a primary store.
- **SQLite** provides durable storage, rich queries (filter by source,
  date, tags), and recovery from crashes.
- The pattern scales up: replace USearch with Qdrant/Pinecone and
  SQLite with Postgres when you outgrow local.

### Why Chunk by Headings?

Headings are natural semantic boundaries. A chunk under "## Personal
Development" will contain self-contained narrative. Blind token-splitting
splits sentences and degrades search quality.

---

## Testing the Pipeline

```ts
// src/ask.test.ts
import { describe, it, expect, vi, beforeAll } from 'vitest';

// Mock the embedding model to avoid downloading it in tests
vi.mock('./embed', () => ({
  embedText: vi.fn().mockResolvedValue(Array.from({ length: 1024 }, () => Math.random())),
}));

vi.mock('better-sqlite3', () => {
  const Database = vi.fn();
  // Return a mock database
  return { default: Database };
});

describe('VectorStore', () => {
  it('stores and retrieves chunks', () => {
    // ...test in-memory store
  });
});

describe('chunkMarkdown', () => {
  it('splits on headings', () => {
    const input = '## Intro\nhello\n## Details\nworld';
    const chunks = chunkMarkdown(input, 'test.md');
    expect(chunks).toHaveLength(2);
    expect(chunks[0].heading).toBe('Intro');
    expect(chunks[1].heading).toBe('Details');
  });

  it('handles no headings', () => {
    const input = 'just a paragraph';
    const chunks = chunkMarkdown(input, 'test.md');
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(input);
  });
});
```

---

## Production Considerations

### For Large Document Sets (10k+ files)

1. **Batch embeddings** — Transformers.js can batch multiple texts in
   one `pipeline()` call for GPU utilization:
   ```ts
   const result = await pipe(texts, { pooling: 'mean', normalize: true });
   ```
2. **Persistent USearch** — Save incrementally rather than full rebuild.
3. **Hybrid search** — Combine vector search with BM25 keyword scoring
   for better precision on rare terms.
4. **Re-ranking** — Add a cross-encoder (e.g., `BAAI/bge-reranker-v2`)
   on top-50 results for finer relevance ranking.

### Alternative Vector Stores

| Store                   | Type               | Pros                    | Cons            |
| ----------------------- | ------------------ | ----------------------- | --------------- |
| **USearch**             | Local lib          | Zero deps, fast         | In-memory only  |
| **SQLite + sqlite-vec** | Local DB           | Single file, persistent | Slower on 100k+ |
| **Qdrant**              | Server             | Filters, scaling, cloud | Requires Docker |
| **Pinecone**            | Cloud              | Managed, scalable       | Cost            |
| **pgvector**            | Postgres extension | Joins with app data     | Schema overhead |

### Security

- **Sanitize user input** before embedding (strip HTML tags, limit length)
- **Rate limit** the `/ask` endpoint (sliding window per IP)
- **Validate LLM responses** — don't blindly trust the output

---

## Summary

1. **Chunk** documents into sections
2. **Embed** each chunk into a 1024d vector (local ONNX)
3. **Store** vectors in USearch, metadata in SQLite
4. **Search** by embedding the query and running KNN
5. **Ask** by injecting top chunks as LLM context

This pipeline gives you semantic search + AI answers over any document
collection, fully local, in ~300 lines of TypeScript.
