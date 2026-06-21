---
published: false
title: "The 7-Second Classifier: Why Your Smallest Task Shouldn't Run on Your Biggest Model"
slug: 'llm-task-classifier'
description: 'How woss.io was using a 284B-parameter reasoning model to answer "is this github, macula, or none?" — and the lessons from routing it to something saner.'
date: 2026-06-16
tags:
  - LLM
  - tool classifier
  - prompt engineering
  - optimization
  - woss.io
featured: false
part_of_series: 'building-woss-io'
---

## A 7-Second Classification

I opened the logs to check on a user message: "Tell me about Daniel."

A reasonable question. The kind of question this system handles dozens of times a day. What I found in the logs stopped me:

Here's the full breakdown of that request, traced through every step:

| Step                                    | Timestamp              | Duration                           |
| --------------------------------------- | ---------------------- | ---------------------------------- |
| **Chat created**                        | 22:12:35.060           | —                                  |
| **Page loaded**                         | 22:12:35.101           | +41ms                              |
| **User types "Tell me about Daniel"**   | 22:12:37.169           | +2,068ms                           |
| **Rate limit check**                    | 22:12:37.178           | +9ms                               |
| **LLM availability**                    | 22:12:37.180→37.848    | 668ms                              |
| **User message SSE sent**               | 22:12:37.859           | +11ms                              |
| **Tool classifier (deepseek-v4-flash)** | 22:12:37.862→44.780    | **6,918ms** — classified as `none` |
| **Embedding generation**                | 22:12:44.826→45.275    | 449ms                              |
| **RAG query type**                      | 22:12:45.276           | +1ms                               |
| **LLM stream (big-pickle)**             | 22:12:45.288→13:15.943 | 30,655ms — 2,422 tokens out        |
| **Done**                                | 22:13:15.943           | —                                  |

**Total from user message → done: ~38.8s**

**Seven seconds.** A model took seven seconds to decide that "tell me about Daniel" doesn't require GitHub or Macula tools.

This classifier's job: emit exactly one of four words — `github`, `macula`, `both`, or `none`. And a 284B-parameter reasoning model was spending 7,000 tokens of internal monologue to reach the same conclusion.

Easy to miss — it worked, just not efficiently.

## How We Got Here

The tool classifier at `classifyToolNeeds` had a simple job: catch short ambiguous messages like "yup do it" or "3 more?" that keyword checks can't handle, and route them to the right toolset (or none). It lived in a separate file with its own timeout, its own temperature setting, even its own `reasoning_effort: 'none'` flag.

But it shared one thing with the main chat pipeline: **the exact same model**.

```typescript
// tool-classifier.ts (simplified)
body: JSON.stringify({
  model: config().openai.model,  // ← same model as main LLM
  ...
})
```

If the main chat used `deepseek-v4-flash` (a giant reasoning model), the classifier also used `deepseek-v4-flash`. The `reasoning_effort: 'none'` flag was meant to suppress chain-of-thought, but as the logs showed, DeepSeek still produced verbose reasoning — the response included hundreds of words of self-talk before arriving at `"none"`.

The classifier's prompt was tiny — maybe 20 lines, a few hundred tokens. Running a 284B-parameter model on it means paying for millions of idle parameters while the model figures out it needs to output `none`.

## Exploring the Fix

Once I noticed the problem, I had a few directions to go.

### Separate Model (the simple fix)

Add a `TOOL_CLASSIFY_MODEL` environment variable. Route the classifier to a nano-class model — `gpt-5-nano` or `mimo-v2.5-nano` (or whichever small model your provider serves).

```typescript
model: config().openai.toolClassifyModel ?? config().openai.model,
```

Estimated improvement: **7s → <500ms**. A 14x speedup. The trade-off is maintaining the env var and ensuring the tiny model stays available.

### Local Tiny Model (the radical fix)

Run a local model through Ollama — `qwen2.5:0.5b` or similar. No network round-trip, no API latency, no external dependency.

Estimated improvement: **7s → <100ms**. But adds an infrastructure dependency, and the model needs to run on the server. For a classification task this simple, even a 500M-parameter model is overkill — but at least it's local overkill.

### Smarter Keyword Rules (the no-model fix)

The classifier only fires when keyword checks are inconclusive. The current rules already handle obvious cases (`"show repos"` → github, `"show photos"` → macula). But many ambiguous cases aren't ambiguous at all once you expand the pattern set.

A few patterns that could eliminate the LLM call entirely:

| Pattern                         | Classification |
| ------------------------------- | -------------- |
| "show me" (after photo context) | macula         |
| "list repos"                    | github         |
| "your projects"                 | github         |
| "open source"                   | github         |
| "pictures/photos/images"        | macula         |
| "portfolio"                     | macula         |

The more patterns the keyword layer catches, the fewer LLM classifications needed. And keyword checks are milliseconds, not seconds.

### Trim Prompt Context (already done)

The classifier already sliced history to the last 2 exchanges via `.slice(-2)` — this was never a problem. But it's worth checking: any time the caller loads 50 messages but the callee only needs 2, the unnecessary DB fetch is a minor micro-optimization target.

## What I Actually Did

I went with the separate model approach. The classifier always used `.slice(-2)` so context was never bloated — that was already handled.

The separate model env var let me route the classifier to `mimo-v2.5-free`. The first MiMo request told the story:

### The First MiMo Request

The MiMo experiment lasted exactly one request. The log for chat `4d0e8274` told the story:

| Problem             | Detail                                                                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Field name mismatch | MiMo returns reasoning in a `reasoning` field, not `reasoning_content`. The TypeScript interface only checks `reasoning_content`, so all output was silently dropped.                                           |
| Token limit         | `max_tokens: 500`. MiMo burned every single token on internal reasoning — `finish_reason: "length"` — and never emitted `content`. The actual classification was somewhere in the reasoning text, inaccessible. |
| Empty answer        | `rawAnswer = ""` → classifier fell back to `"none"`. Correct result, but by accident.                                                                                                                           |

The classifier got the right answer (`"none"`) despite the data never reaching the response parser. The code's fail-safe pattern masked the gap.

Lesson: MiMo is a reasoning model — it thinks before it speaks. For a one-word classification task, that thinking is wasted latency. The `reasoning_effort: 'none'` flag doesn't suppress the `reasoning` field — the model still produces it, and still hits token limits on it.

I pulled MiMo from the classifier route. It fell back to the main model (DeepSeek V4 Flash). The `TOOL_CLASSIFY_MODEL` env var stays as an option for future experiments, but defaults to unset.

The real win wasn't a faster model — it was having the option to swap models per-component, even if the first swap candidate didn't work out.

### A Related Problem: The RAG Query Classifier

The tool classifier isn't the only classifier in the system. There's a parallel classification step — `classifyQuery` in `query-classifier.ts` — that determines whether a query needs RAG context (`rag`), tool execution (`tool`), both (`hybrid`), or neither (`meta`).

The original RAG classifier had its own gate bug. RAG retrieval was guarded by a `needsAnyTool` flag — if the tool classifier said no tools, RAG was skipped entirely. This created a blind spot: queries that needed neither GitHub nor Macula tools (like "summarize the conversation" or "What projects have you worked on?") got no RAG context either.

The fix was trivial — remove the gate:

```typescript
// Before
if (needsAnyTool) {
  ragResults = await retrieveContext(query);
}

// After
ragResults = await retrieveContext(query);
```

RAG now runs on every query, independent of tool classification. The classifiers still serve their original purpose — the tool classifier determines which MCP tools to load, the query classifier determines how to route the request — but neither can starve the model of context anymore.

The lesson applies to both classifiers: a classifier should gate what it classifies, not what its neighbors do. The tool classifier decides which tools. It shouldn't also decide whether RAG runs.

## The Deeper Lesson

This is a case study in a pattern I've seen across the entire woss.io stack: defaulting to the biggest model.

When you set up a pipeline, you pick a model. The model works. So it gets reused everywhere — for generation, for classification, for routing, for guardrails. And why wouldn't it? It's already loaded, already configured, already working.

But each reuse comes at a cost. A large model doesn't just answer slower — it also reasons more, generates more tokens, and costs more. For a task that requires none of that power, you're paying the full tax for zero benefit.

The right architecture isn't one model that does everything. It's a spectrum:

- 0.5B model → classification, keyword matching, simple routing
- 3B model → relevance checking, polite responses, short-form generation
- Large model → deep reasoning, complex answers, multi-tool orchestration

Each level handles what it's good at. The big model only fires when the small models signal that it's needed. This isn't just about cost — it's about latency, about reliability, about designing a system where every component is appropriately sized for its job.

The seven-second classifier is fixed now. But the pattern lives on in every pipeline that defaults to "the big model" for "a small task." It's worth checking yours.
