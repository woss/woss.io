# Query Classification: Centroid vs Zero-Shot

Classify queries as `tool` / `rag` / `hybrid` before running RAG, so tool-only queries skip embedding search entirely.

## The Problem

Current `+server.ts` flow:

```
embedText(text) → searchChunks() → RAG prompt → [maybe] load MCP tools → stream
                └─ always runs, even for "show me Daniel's PRs" ──┘
```

Tool-only queries (GitHub PRs, repos, issues) don't need RAG. Running embedding search on them wastes ~30ms and pollutes the prompt with irrelevant experience chunks.

## The Architecture

Three query classes:

| Class    | Example                                  | RAG  | Tools |
| -------- | ---------------------------------------- | ---- | ----- |
| `tool`   | "show me Daniel's PRs"                   | skip | load  |
| `rag`    | "what projects did Daniel found"         | run  | skip  |
| `hybrid` | "Daniel's experience and his recent PRs" | run  | load  |

Both approaches (centroid, zero-shot) share the same classification output. The difference is how the classification decision is computed.

---

## Phase 1 — Centroid

### How It Works

Uses the **existing** BGE embedding (computed at line 184 of `+server.ts`) and compares it against pre-computed centroid vectors.

No additional model, no additional embedding call. Just two cosine similarity computations (~2K ops).

### Input

The embedding vector is already available before RAG search:

```typescript
// +server.ts line 184
embedding = await embedText(text);                    // ← already computed
// line 230-234 — this is what we'd skip for tool-only:
const results = searchChunks(embedding.data, ...);     // ← conditional
```

### Implementation

#### 1. Centroid data file

Pre-computed vectors stored as JSON (one-time generation script):

```json
{
  "tool": [0.023, -0.041, 0.087, ...],
  "rag":  [-0.015, 0.032, -0.064, ...]
}
```

Generating centroids — run once, at build or first deploy:

```typescript
// scripts/compute-centroids.ts
import { embedText } from '../src/lib/server/embed.ts';

const toolSeeds = [
  "show me Daniel's pull requests",
  'search GitHub for repos',
  'find my open issues',
  'what commits has he made',
  'list pull requests',
];

const ragSeeds = [
  "describe Daniel's experience",
  'what projects did he found',
  'tell me about his background',
  'what skills does he have',
  'where did he work',
];

function average(vectors: number[][]): number[] {
  const n = vectors.length;
  const dim = vectors[0].length;
  const avg = new Array(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) avg[i] += vec[i] / n;
  }
  return avg;
}

// Use existing embedText() — same pipeline as RAG
const toolVecs = await Promise.all(toolSeeds.map((s) => embedText(s).then((r) => r.data)));
const ragVecs = await Promise.all(ragSeeds.map((s) => embedText(s).then((r) => r.data)));

const centroids = {
  tool: average(toolVecs),
  rag: average(ragVecs),
};

await Deno.writeTextFile('src/lib/tool-classifier-centroids.json', JSON.stringify(centroids));
```

#### 2. Classification utility

```typescript
// src/lib/query-classifier.ts
import type { Centroids } from './types.ts';

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function classifyQuery(embedding: number[], centroids: Centroids): 'tool' | 'rag' | 'hybrid' {
  const toolSim = cosineSimilarity(embedding, centroids.tool);
  const ragSim = cosineSimilarity(embedding, centroids.rag);

  const THRESHOLD = 0.1; // tunable — gap needed to pick one over the other

  if (toolSim > ragSim && toolSim - ragSim > THRESHOLD) return 'tool';
  if (ragSim > toolSim && ragSim - toolSim > THRESHOLD) return 'rag';
  return 'hybrid';
}
```

#### 3. Integration in `+server.ts`

Insert after line 184 (embedding computed), before line 228 (search begins):

```typescript
// 3b. Classify query — skip RAG for tool-only queries
const centroids = JSON.parse(await Deno.readTextFile('src/lib/tool-classifier-centroids.json')) as Centroids;

const queryType = classifyQuery(embedding.data, centroids);
```

Then wrap the search block:

```typescript
let sources: Source[] = [];
let ragChunks: RagChunk[] = [];
let typeFilter: 'experience' | 'post' = 'experience';
let messages: LLMMessage[];

if (queryType !== 'tool') {
  // 4. RAG search (same as before)
  publishLive(chatId, 'status', { step: 'searching' });
  typeFilter = /\b(blog|post|article|writing|tutorial|guide)\b/i.test(text)
    ? 'post' : 'experience';
  const results = searchChunks(embedding.data, maxChunks, typeFilter);
  const filtered = results.filter((r) => r.score < 1.5).slice(0, maxChunks);
  ragChunks = filtered.map((r) => ({ title: r.chunk.title, text: r.chunk.text, score: r.score }));
  sources = /* dedup by slug as before */;
}

// 5. Load history
const history = ctxMessages.map((m) => ({ role: m.role, content: m.content }));

// 6. Build prompt (pass empty chunks for tool-only)
const messages = buildRagPrompt(text, ragChunks, history);
```

And adjust the tools section:

```typescript
// 6b. Load MCP tools
let mcpToolDefs: any[] | null = null;
if (queryType !== 'rag' && needsExternalTools(text)) { ... }
```

### Key Properties

| Property          | Value                                          |
| ----------------- | ---------------------------------------------- |
| Extra model load  | None                                           |
| Extra embedding   | Zero (reuses line 184)                         |
| Latency per query | ~0.01ms (two dot products)                     |
| Cold start cost   | ~1s to compute centroids from seeds (one-time) |
| Accuracy          | Good — BGE space separates tool/rag categories |
| Maintenance       | Add seed queries if new tool patterns emerge   |

### Risks

- **Centroid quality**: depends on seed query selection. Bad seeds → poor classification.
- **BGE space**: trained for retrieval, not separation. Tool vs rag may overlap for ambiguous queries.
- **Threshold sensitivity**: 0.1 gap might be too tight or too loose. Needs tuning against real queries.

---

## Phase 2 — Zero-Shot Classifier

### How It Works

Loads a separate classifier model (`DistilBERT-MNLI` or `BART-Large-MNLI`) via `@huggingface/transformers` and uses NLI (natural language inference) to classify queries.

Same `classifyQuery()` signature — drop-in replacement for Phase 1.

### Implementation

```typescript
// src/lib/query-classifier.ts — zero-shot variant
import { pipeline } from '@huggingface/transformers';

let _classifier: any = null;
async function getClassifier() {
  if (_classifier) return _classifier;
  _classifier = await pipeline(
    'zero-shot-classification',
    'Xenova/distilbert-base-uncased-mnli', // 270MB model
  );
  return _classifier;
}

export async function classifyQuery(text: string): Promise<'tool' | 'rag' | 'hybrid'> {
  const classifier = await getClassifier();
  const result = await classifier(text, ['tool', 'rag']);
  // result = { labels: ['tool', 'rag'], scores: [0.87, 0.13] }

  const THRESHOLD = 0.6; // minimum confidence for a class
  const GAP = 0.15; // minimum gap between classes

  if (result.scores[0] > THRESHOLD && result.scores[0] - result.scores[1] > GAP) return 'tool';
  if (result.scores[1] > THRESHOLD && result.scores[1] - result.scores[0] > GAP) return 'rag';
  return 'hybrid';
}
```

Note: `classifyQuery` now takes raw `text` instead of an embedding vector. Integration changes:

```typescript
// +server.ts — after line 180, before embedding
const queryType = await classifyQuery(text); // uses separate model

// If tool-only, we can actually SKIP embedding entirely
```

### Key Properties

| Property          | Value                                      |
| ----------------- | ------------------------------------------ |
| Extra model load  | DistilBERT-MNLI ~270MB                     |
| Extra embedding   | One classifier call per query              |
| Latency per query | ~200-400ms (model inference)               |
| Cold start cost   | ~5-10s to download + load classifier model |
| Accuracy          | Best — NLI understands nuanced semantics   |
| Maintenance       | Model updates from HuggingFace             |

### Risks

- **Model size**: 270MB-1.6GB additional on disk + memory.
- **Cold start**: first query after deploy triggers model download. Can be mitigated with pre-download script.
- **Transformers.js stability**: zero-shot pipeline on ONNX runtime is newer than feature-extraction. Might have edge cases.
- **Memory pressure**: BGE-large + DistilBERT = ~2GB total at runtime. On a small VPS this matters.

---

## Phase Comparison

| Dimension                | Phase 1 — Centroid                      | Phase 2 — Zero-Shot                                  |
| ------------------------ | --------------------------------------- | ---------------------------------------------------- |
| **Extra disk**           | 8KB (centroid JSON)                     | 270MB-1.6GB (classifier model)                       |
| **Extra RAM**            | None                                    | ~300-700MB at inference                              |
| **Latency per query**    | ~0.01ms (two dot products)              | ~200-400ms (full inference pass)                     |
| **Embedding calls**      | 0 (reuses line 184)                     | 0 (works on raw text, no embed needed)               |
| **Cold start**           | ~1s (compute centroids from seeds)      | ~5-10s (download + load model)                       |
| **Accuracy expectation** | Good — BGE clusters tool/rag well       | Best — NLI captures nuanced semantics                |
| **Hybrid detection**     | Gap threshold (tunable)                 | Confidence + gap threshold (tunable)                 |
| **Ecosystem stability**  | Rock-solid (same pipeline already runs) | Newer (`zero-shot` pipeline, less tested)            |
| **Migration difficulty** | Baseline (build first)                  | Drop-in replacement (same `classifyQuery` signature) |
| **When to choose**       | Pragmatic, fast, zero cost              | Highest accuracy, more resources                     |

## Migration Path

```
Phase 1 (Centroid)
  ↓ test, tune thresholds
Phase 2 optional upgrade
  ↓ same classifyQuery() signature
```

Phase 1 is the default. If centroid accuracy proves insufficient, Phase 2 replaces it without changing any integration code. The `classifyQuery()` interface stays the same; only its internals change.
