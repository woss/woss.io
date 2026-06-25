---
published: true
title: 'When Your RAG Returns the Wrong Answer (and Cosine Distance Blamed the Wrong Chunk)'
slug: 'attempt-to-fix-rag-false-positive-with-cross-encoder-reranker'
description: 'A production RAG pipeline returned the wrong answer. Not because the data was missing, but because a single cosine distance threshold silently filtered out every relevant chunk and let a false positive through.'
date: 2026-06-25
tags:
  - RAG
  - vector search
  - embeddings
  - debugging
  - woss.io
featured: false
part_of_series: 'building-woss-io'
header_image: https://u.macula.link/bq6whOO3Qe6rc_2aEImxBQ-7
---

Last weekend I published new woss.io, and shared it with the world. This includes my friends to test it. I tested it quite extensively, but as I was testing, I was also changing weights, RAG and other stuff. I didn't notice one of my top experiences in copyright and IP was buried and completely excluded from the RAG search.

I found out about this when my nephew clicked the `/surprise_me` slash command and it asked this question: "Tell me about Daniel's experience with copyrights and IP?". He called me up and said, "Unc, the AI says you don't have any experience with copyrights and IP. I know you do, are you sure about that?". That sent me to the logs to see what happened.

I was shocked to see that the RAG pipeline returned a false positive and filtered out all relevant chunks. This post is about what happened, why it happened, and how I fixed it — which ended up being simpler than I expected.

## The Usual Suspects

I started with the logs. I built it as structured tracing — every log line carries traceId and spanId. From chat creation to tool classification to RAG search to LLM call, everything is logged as line-delimited JSON. When you combine the lines by traceId, you get the full request trace. I can see the entire flow of a single chat in the logs. I can see what the AI was thinking, what it was doing, and what it returned. Give it a chatId or messageId and it traces the entire flow of the chat. It can map the entire flow inside a chat for any number of messages using the `spanId` and `traceId`. But that's not the topic of this post — maybe I'll write another about the logging behind woss.io.

The site has work history, blog posts, and project write-ups that explicitly cover copyrights and intellectual property. Anagolay is a blockchain project I founded around digital rights management. At Kelp I was CTO and dealt with licensing and IP. Macula is a DAM system built around rights metadata. The data's there. But the RAG pipeline couldn't see it.

I checked them all. The ONNX embedding model loads fine. Chunks are reasonable lengths split by markdown sections. The USearch index has 221 vectors and every single one maps to a valid SQLite row. The centroid hashes match between the build pipeline and the runtime.

Everything looked fine. Production bugs hide where you're not looking.

## Where It Actually Broke

From the logs, I spotted the false positive.

Here's what I found when I pushed the actual query through the search pipeline:

```text
Query: "Tell me about Daniel's experience with copyrights and IP?"

Top USearch results (cosine distance, lower = closer):

1.  0.2874  System Prompt Position Matters      ← FAKE
2.  0.3127  About Daniel Maricic                ← THIS ONE SINCE IT HAS CURATED PROJECTS
3.  0.3255  Kelp.digital - Founder and CTO      ← THEN THIS ONE
4.  0.3297  Anagolay Network - Founder, CTO     ← AND THIS ONE
```

And then the filter:

```ts
// Old: one brittle threshold
const SOURCE_SCORE_THRESHOLD = 0.3;
const filtered = results.filter((r) => r.score < SOURCE_SCORE_THRESHOLD);
```

Apply the filter and what passes? One result. The blog post about system prompt positioning, a piece about how to order LLM instructions. Zero relevance to copyright or IP, score 0.2874, just barely under the wire.

The Kelp and Anagolay chunks? Both around 0.33, just above the threshold, filtered out. This caught me off guard. The system returned exactly one false positive and dropped everything useful.

This is the single worst failure mode for a RAG system: not just a bad answer, but an answer that looks correct to the user because it returned _something_. If the user asks "tell me about Daniel and IP" and gets back "here's what I found about system prompts", that's worse than saying "I don't know." It's misleading.

Here is the full trace from the logs, processed:

```ascii
Chat `998e5a3d-b9e8-4137-b497-a39d64149d83` on 2026-06-23
═══════════════════════════════════════════════════════════

traceId: e78415125f611c5021c5025417fcac55  [ASK ACTION - 380ms]
│
└─ spanId: 048e3f833d7ecf5d
   ├─ 19:16:39.510  Chat ask action (textLength=57)
   ├─ 19:16:39.533  Rate limit check (ip=x.x.x.x, remaining=7)
   ├─ 19:16:39.550  isAvailable: fetching from provider
   └─ 19:16:39.930  isAvailable: status=200

traceId: 019ef5e9-c97c-746a-94c7-05b8cd075ee3  [MESSAGE EXCHANGE - 14.7s]
│
└─ spanId: 019ef5e9-c991-753d-b9ea-20eb91f69efc  (root span, all same)
   ├─ 19:16:39.953  📝 ask: "Tell me about Daniel's experience..."
   ├─ 19:16:39.954  SSE event: user_message
   ├─ 19:16:39.991  Generating embedding (length=57)
   ├─ 19:16:40.071  Embedding generated (1024 dims)
   ├─ 19:16:40.072  Query classification scores (rag=0.82, tool=0.73, meta=0.63)
   ├─ 19:16:40.072  🎯 queryType="rag"
   ├─ 19:16:40.120  📚 RAG-only mode (no external tools)
   ├─ 19:16:40.121  Starting LLM stream (round 1/1)
   ├─ 19:16:40.122  MCP tool defs: none
   ├─ 19:16:40.123  chatStreamWithTools (3 messages, 0 tools)[ 14.5s LLM generation gap ]
   ├─ 19:16:54.613  RAW_LLM_OUTPUT (answer: "don't have info...")
   ├─ 19:16:54.636  ✅ done (1645 in / 1086 out / 14488ms)
   └─ 19:16:54.637  SSE event: done (dataLength=388)
```

## Why Cosine Distance Broke Here

The root issue: cosine distance measures _vector similarity_, not _semantic relevance_. Those aren't the same thing.

The embedding model maps text to a 1024-dimensional space. Two texts can land close in that space without being semantically connected. Maybe they share technical vocabulary, maybe they're both about LLMs. The proximity doesn't mean relevance. The query mentions "copyrights" and "IP" but the embedding vector might be closer to a text about "system prompts" than to a text about "intellectual property" because of noise in the other 1021 dimensions of the vector. This one took me a while to fully trace through.

Bi-encoders have this limitation. That's what embedding models are. They compress everything into a single vector and lose the fine-grained interactions between query terms and document terms. They're fast: USearch can search 221 vectors in under a millisecond. Speed comes at the cost of precision.

## The Attempt: A Cross-Encoder Re-ranker

My first instinct was a two-stage pipeline. Stage one: bi-encoder vector search gets candidates. Stage two: a cross-encoder re-ranker examines each query-chunk pair and scores actual relevance. The cross-encoder would gate what reaches the LLM — if a chunk scores below a threshold, it's out, no matter how close the vectors are.

This is a well-known pattern. Cross-encoders don't compress text into vectors. They take two pieces of text — query and chunk — and run them through full transformer attention together. The query's words attend to the chunk's words directly. It can answer "does this chunk actually answer this question?" instead of "is this vector close to that vector?"

I knew the trade-offs going in. Processing 24 query-chunk pairs takes 500-1500ms versus <1ms for vector search. For a chat app that already runs for seconds, that overhead is acceptable. The model ships as a single ONNX file — Transformers.js loads it natively.

I picked `Xenova/bge-reranker-base` and kicked off the download. 1.1GB of ONNX weights.

```sh
  Xenova/bge-reranker-base: 1% (12MB/1100MB)
  Xenova/bge-reranker-base: 1% (13MB/1100MB)
  Xenova/bge-reranker-base: 1% (14MB/1100MB)
```

I built a progress bar for this thing. Single-line overwrite with `\r`, updates only when percentage changes, download speed in MB/s:

```sh
  Downloading cross-encoder model...
  ██████░░░░ 60%  8.7 MB/s
  ✓ Cross-encoder model downloaded
```

I probably spent more time on the progress bar than it deserved, but watching it is oddly satisfying. The embedding model is another 1.3GB, so the full build-index run downloads about 2.4GB of ONNX weights before it even starts. The bar at least makes the wait visible instead of leaving you wondering if the process hung.

Then I ran it on the actual query.

```text
After cross-encoder re-ranking (relevance score, higher = closer):

1.  0.0064  Kelp.digital - Founder and CTO
2.  0.0032  System Prompt Position Matters
3.  0.0012  About Daniel Maricic
4.  0.0008  Anagolay Network - Founder, CTO
```

Near-zero across the board. Kelp.digital — the single most relevant chunk in the corpus for this query — scored 0.0064. The false positive scored 0.0032. The ordering was _technically_ correct (Kelp before System Prompt), but these scores can't be used as a relevance gate. There's no threshold you can set here — 0.15 filters out everything, 0.001 lets everything through. The model doesn't activate for this domain.

I ran diagnostics. Near-identity pairs — same text on both sides — scored 0.999. Synonym matches scored 0.99. But production-relevant pairs in the copyright/IP domain scored 0.0002-0.0064. The model was running correctly. It just doesn't zero-shot well into content-rights and legal vocabulary.

I tried `text_pair` input format. I tried manual `</s></s>` formatting. Same output either way. The model loads, the scores change meaningfully between inputs, but the activation range for this domain starts at zero.

The cross-encoder couldn't gate relevance for this use case. The code was there, the pipeline was built, and the gate didn't gate.

## The Real Fix: Simpler Than I Thought

I stepped back. The cross-encoder approach was elegant but broken for my domain. What did I actually have?

The real problem was the filter: `SOURCE_SCORE_THRESHOLD = 0.3`. I picked that number out of intuition and never validated it against real queries. The relevant chunks scored 0.3127-0.3297, just barely above the cutoff. The false positive scored 0.2874, just barely below.

The fix was widening the threshold so relevant content gets through. Combined with `expansion_search: 200` (wider recall from the vector index), the pipeline returns more candidates and lets the LLM sort them out:

```ts
const SOURCE_SCORE_THRESHOLD = 0.5; // wider threshold
const filtered = results.filter((r) => r.score < SOURCE_SCORE_THRESHOLD);
```

Same query, same index, new results:

```text
Top USearch results (cosine distance, lower = closer):

1.  0.2874  System Prompt Position Matters      ← still passes at 0.5, now 1 of 4
2.  0.3127  About Daniel Maricic                ← passes
3.  0.3255  Kelp.digital - Founder and CTO      ← passes
4.  0.3297  Anagolay Network - Founder, CTO     ← passes
```

Filtering at 0.5 instead of 0.3: three relevant chunks and one false positive make it through. The false positive is still in there, but now it's one of four instead of the only one. The LLM gets enough context to answer correctly.

That's it. I didn't need a new model or a two-stage pipeline. I needed to tune what was already there.

## What Stuck

The cross-encoder code still lives in `reranker.ts`. It's there for a future model that handles this domain better. The download step is commented out in `build-index.ts` — no point pulling 1.1GB for a gate that doesn't gate.

The real takeaway: tune what you have before adding complexity, saving you time and resources, in my case 5 hours of research coding and finding the correct ONNX. The 0.3 threshold was pulled from intuition and never validated against real queries. I spent time researching cross-encoders, downloading models, and building infrastructure that addressed the wrong problem. The actual fix was changing one number.

Running the actual query through the pipeline and looking at the scores — that's what revealed the problem. Unit tests with mock data couldn't surface this because they used made-up scores. Only real production data at real query time showed the gap.

The AI now answers "what about Daniel and copyrights" better. The false positive is still in the context window, but it's one of several relevant chunks instead of the only source of truth. That's the difference between a wrong answer and a grounded one.

The bar is not that the answer is perfect. It's that the reasoning behind it holds up.

---

The full source for this fix is at [github.com/woss-io/woss.io](https://github.com/woss-io/woss.io) in PR [15](https://github.com/woss/woss.io/pull/15).
