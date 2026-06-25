---
published: true
title: 'When Your RAG Returns the Wrong Answer (and Cosine Distance Blamed the Wrong Chunk)'
slug: 'rag-false-positives-reranker'
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
---

Last weekend I published new woss.io, and shared it with the world. This includes my friends to test it. I tested it quite extensively, but as I was testing, I was also changing weights, RAG and other stuff. I didn't notice one of my top experiences in copyright and IP was buried and completely excluded from the RAG search.

I found out about this when my nephew clicked the `/surprise_me` slash command and it asked this question: "Tell me about Daniel's experience with copyrights and IP?". He called me up and said, "Unc, the AI says you don't have any experience with copyrights and IP. I know you do, are you sure about that?". That sent me to the logs to see what happened.

I was shocked to see that the RAG pipeline returned a false positive and filtered out all relevant chunks. I had to fix this, and the fix ended up being a combination: wider cosine threshold and a cross-encoder re-ranker to make sure the right chunks come first. This post is about what happened, why it happened, and how I fixed it.

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

## The Fix: A Cross-Encoder Re-ranker

The fix is a two-stage pipeline. First, fast bi-encoder search gets candidates. Then a slower but more accurate cross-encoder re-ranks them.

The USearch index config sets `expansion_search` to 200 (default is 50), giving the first stage a wider net. More candidates gives the cross-encoder better raw material to work with — a false positive at rank 1 shouldn't leave you stuck with it.

A cross-encoder doesn't convert text into a vector. It takes two pieces of text, the query and the chunk, and processes them together through a full transformer attention layer. The query's words can attend to the chunk's words directly. The model can ask "does this chunk actually answer this question?" instead of "is this vector close to that vector?"

I went with `Xenova/bge-reranker-base` — it ships as a single self-contained ONNX file, which is what the Transformers.js runtime expects. The larger BGE-reranker-v2-m3 scores better on benchmarks, but its ONNX export uses external data files that this runtime can't load. For a personal site, the accuracy difference is noise anyway.

The trade-off is speed. Processing 24 query-chunk pairs takes 500-1500ms versus <1ms for a vector search. For a chat application that already takes seconds to generate a response, that's acceptable overhead.

The new filter logic looks like this:

```ts
const SOURCE_SCORE_THRESHOLD = 0.5; // relaxed — cross-encoder re-orders above this

const reranked = await rerankSearchResults(text, results);
const hasReranker = reranked.length > 0 && reranked.some((r) => r.rerankerScore > 0);

const filtered = hasReranker
  ? reranked.filter((r) => r.cosineScore < SOURCE_SCORE_THRESHOLD)
  : results.filter((r) => r.score < SOURCE_SCORE_THRESHOLD);
```

When the cross-encoder is active, it re-orders the chunks by relevance score. The cosine threshold is the gate — catch-all for truly far chunks. If the cross-encoder fails to load (model not cached yet, OOM), the system falls back to cosine-only with the same threshold. The key difference: without the re-ranker, the false positive is at rank 1. With it, the relevant chunk is at rank 1.

Here's what the same search looks like after re-ranking — results sorted by cross-encoder relevance score:

```
Top USearch results (cosine distance, lower = closer):

1.  0.2874  System Prompt Position Matters      ← rank 1 false positive
2.  0.3127  About Daniel Maricic
3.  0.3255  Kelp.digital - Founder and CTO
4.  0.3297  Anagolay Network - Founder, CTO

After cross-encoder re-ranking (relevance score, higher = closer):

1.  0.0064  Kelp.digital - Founder and CTO      ← promoted to rank 1
2.  0.0032  System Prompt Position Matters      ← demoted to rank 2
3.  0.0012  About Daniel Maricic
4.  0.0008  Anagolay Network - Founder, CTO
```

The cross-encoder scores are tiny — bge-reranker-base maps everything to the lower end of its range for this domain — but the ORDERING is meaningful. Kelp.digital goes from rank 3 to rank 1. The false positive goes from rank 1 to rank 2. Combined with the relaxed cosine threshold (0.3 → 0.5), the relevant content now reaches the LLM.

The scores aren't cleanly separable into a threshold. What they give you is a better ordering. And that's enough — the LLM gets relevant context first, the false positive sinks to where it matters less.

### You Have to Download 1.1GB Before Anything Happens

What the code above doesn't show: this thing is 1.1GB. Transformers.js fires progress events for every file chunk during download. If you just log them all, your build output fills with thousands of lines that look like this:

```sh
  Xenova/bge-reranker-base: 1% (12MB/1100MB)
  Xenova/bge-reranker-base: 1% (13MB/1100MB)
  Xenova/bge-reranker-base: 1% (14MB/1100MB)
```

I ended up writing a single-line progress bar that overwrites in place with `\r` and updates only when the percentage changes, plus a download speed in MB/s:

```sh
  Downloading cross-encoder model...
  ██████░░░░ 60%  8.7 MB/s
  ✓ Cross-encoder model downloaded
```

I probably spent more time on this progress bar than it deserved, but it's oddly satisfying to watch. The embedding model is another 1.3GB, so the full `build-index` run downloads about 2.4GB of ONNX weights before it even starts processing content. The progress bar at least makes the wait visible instead of wondering if the process hung.

## What Stuck

Cosine distance gets candidates into the room, but the difference between 0.28 and 0.33 is meaningless when the wrong chunk has the better score. And the threshold you set will be wrong — you'll only find out in production. I set 0.3 based on intuition and never validated it against actual query results. Running the embedding through the index and looking at the scores — that's what revealed the problem. Unit tests with mock data. I had plenty of those, but they couldn't surface this because they used made-up scores. Only real production data at real query time showed the gap.

The cross-encoder re-ranker addresses the ordering problem. It promotes relevant chunks above false positives so the LLM sees better context first. But the absolute scores from bge-reranker-base turned out to be less useful than I expected — low confidence across the board for this domain. The real fix was a combination: wider cosine threshold + cross-encoder ordering.

The AI now answers "what about Daniel and copyrights" better than before. Some false positive content still reaches the LLM, but it's buried below the relevant chunks. The improvement isn't dramatic — it's the difference between an answer based on one wrong piece of context and an answer based on several relevant pieces with a wrong one lower in the stack.

That's the bar. Not that the answer is perfect, but that the _reasoning_ behind it holds up.

---

The full source for this fix is at [github.com/woss-io/woss.io](https://github.com/woss-io/woss.io) in `src/lib/server/reranker.ts` and `src/lib/server/pipeline/orchestrator.ts` if you want to see exactly how it works.
