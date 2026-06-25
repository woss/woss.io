---
published: false
title: "The 7-Second Classifier: Why Your Smallest Task Shouldn't Run on Your Biggest Model"
slug: 'classifier-lessons'
description: 'Two classifiers, one lesson: the tool classifier that took 7 seconds to say "none" and the relevance gate that stopped off-topic queries — and what both taught us about right-sizing your LLM pipeline.'
date: 2026-06-25
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

## A Different Problem: The Open Gate

Portfolio site with an AI chat. Visitors ask about Daniel's work — projects, experience, skills. RAG pipeline retrieves chunks from a vector store, LLM generates answers. MCP tools for GitHub queries. Clean, scoped, intentional.

Until someone asked: "Search GitHub for open source AI coding agents."

Chat `06a1bf7b-6a98-453b-8ca4-b03470c70f1e`. User submits a completely generic query. Three assistant messages return. Content: a ranked list of open-source AI coding agents — goose, deer-flow, LibreChat, plandex, Kilo. None of them Daniel's projects. None related to his portfolio. The AI was polite, thorough, and entirely wrong.

This wasn't a hallucination. It was a systemic bypass.

Five layers of defense that didn't exist:

### Layer 1: No Relevance Gate

POST /api/ask validates: text ≤ 500 chars, rate limit 10/min, max 50 msg/chat. Nothing checks whether the query belongs here at all.

### Layer 2: classifyQuery Never Rejects

classifyQuery() uses embedding centroids to sort queries into tool, rag, or hybrid. It optimizes the pipeline — it never rejects. Every query gets served.

### Layer 3: needsExternalTools Too Broad

```typescript
function needsExternalTools(text: string): boolean {
  return /open\s*source.*contribut|pr\b|pull/.test(text);
}
```

The regex matched because the query contained "open source" and the topic was generally "contribut[ion]-adjacent." No check for whether the query referenced anything about Daniel or his projects.

### Layer 4: Unrestricted MCP Tools

The model had access to search_code and search_repositories GitHub tools. The tool descriptions said nothing about scope. The model searched all of GitHub for AI coding agents.

### Layer 5: No Refusal Instruction

The system prompt guided the model to be helpful and accurate. It never told the model what not to answer.

## Exploring the Fix — Right-Size the Tool Classifier

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

## What I Actually Did for the Tool Classifier

I went with the separate model approach. The classifier always used `.slice(-2)` so context was never bloated — that was already handled.

The separate model env var let me route the classifier to `mimo-v2.5-free`. The first MiMo request told the story:

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

## Building the Relevance Gate

The other classifier needed to be built from scratch — there was nothing to right-size, because nothing existed.

### The Fix: LLM-Powered Relevance Gate

We needed something fast, cheap, and effective. Pattern matching wouldn't cover the long tail. Embedding classification adds complexity. The simplest path: ask the same LLM a binary question.

```typescript
async function isRelevant(
  question: string,
  history: { role: string; content: string }[],
  signal?: AbortSignal,
): Promise<boolean> {
  const context = history
    .slice(-2)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');
  try {
    const response = await fetch(`${config.openai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.openai.model,
        temperature: 0,
        max_tokens: 5000,
        messages: [
          {
            role: 'system',
            content: `You are a classifier. Classify the following question as relevant or not relevant to Daniel Maricic's portfolio. If the request is positive feedback or a wish to contact, hire, or collaborate, consider it relevant. Answer exactly one word: yes or no. Do not explain. Do not reason. Do not output anything else.`,
          },
          { role: 'user', content },
        ],
      }),
      signal: signal ?? AbortSignal.timeout(5000),
    });
    const body = await response.json();
    const msg = body.choices?.[0]?.message;
    const answer = (msg?.content ?? msg?.reasoning_content ?? '').trim().toLowerCase();
    return answer === 'yes';
  } catch (err) {
    log.warn`Relevance check failed: ${err} — allowing query (fail-open)`;
    return true;
  }
}
```

Key decisions:

- **Same provider/endpoint** — no new infrastructure, same auth, same reliability
- **Temperature 0** — deterministic, no creativity in the answer
- **Fail-open** — if the LLM is down, let the query through. Downtime shouldn't create false positives
- **~300 tokens per check** — at typical LLM pricing, roughly $0.0001 per call

### Placement

The gate fires in startGeneration(), after loading chat history but before embedding:

```
POST handler (saves message, returns 202)
  └─ startGeneration()
       ├─ publish user_message event
       ├─ isRelevant() ← HERE
       │    ├─ yes → continue
       │    └─ no  → publish error, lock chat, fire webhook, return
       ├─ embedText()
       ├─ checkCache()
       ├─ classifyQuery()
       └─ stream generation
```

This is important: the user message is already saved, so the user sees it in the UI. The gate runs in the background on the generation path, not on the request path. No added latency to the 202 response.

### Three Supporting Layers

Gate alone isn't enough. We hardened the other layers too:

**needsExternalTools() — Tightened:**

```typescript
function needsExternalTools(text: string): boolean {
  const t = text.toLowerCase();
  const referencesDaniel = /\b(daniel|woss|anagolay|idiyanale|sensio)\b/.test(t);
  if (!referencesDaniel) return false;
  return /pr|pull request|commit|issue|repo|repository|github|stars|fork/.test(t);
}
```

GitHub tools only fire when the query explicitly references Daniel or his projects.

**System prompt — Hardened:** Appended a CRITICAL — REFUSAL RULE instructing the model to refuse off-topic questions with a specific message.

**MCP tool descriptions — Scoped:** All 23 tool descriptions now end with "Only use for queries about Daniel Maricic's work."

### Debugging: The Gap Between Theory and Practice

First test: "Search GitHub for open source AI coding agents."

**Bug 1: The Thinking Model Problem.** We set `max_tokens: 5`. The LLM responded with `reasoning_content` populated and `content` empty. The model was a reasoning model that routed the classification answer to the reasoning field. Fix: read both fields as fallback — `const answer = (msg?.content ?? msg?.reasoning_content ?? '').trim().toLowerCase()`. Also bumped `max_tokens` to 5000 because reasoning models need room to think.

**Bug 2: The Silent Error.** The SSE event handler on the frontend had a guard — `if (typeof msgId !== 'string') return;` — that silently dropped the relevance gate error event because no assistant message was created. Fix: combine the guard with the dedup check — `if (typeof msgId === 'string' && messages.some((m) => m.id === msgId)) return;`.

### Chat Locking

Once a query is rejected, there's no point letting the user keep trying. The answer won't change. So we lock the chat:

- POST handler checks `isChatLocked` before processing any message — returns 400 if locked
- Relevance gate calls `lockChat()` on rejection
- The error UI hides the "Try again" button via an irrecoverable flag
- A webhook fires for observability

## A Related Problem — When Classifiers Gate Each Other

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

The lesson applies to both classifiers: a classifier should gate what it classifies, not what its neighbors do. The tool classifier decides which tools. It shouldn't also decide whether RAG runs. The relevance gate revealed the same pattern — it decides whether to answer, not which tools to load.

## Lessons

### Right-Size Your Models

This is a case study in a pattern I've seen across the entire woss.io stack: defaulting to the biggest model.

When you set up a pipeline, you pick a model. The model works. So it gets reused everywhere — for generation, for classification, for routing, for guardrails. And why wouldn't it? It's already loaded, already configured, already working.

But each reuse comes at a cost. A large model doesn't just answer slower — it also reasons more, generates more tokens, and costs more. For a task that requires none of that power, you're paying the full tax for zero benefit.

The right architecture isn't one model that does everything. It's a spectrum:

- 0.5B model → classification, keyword matching, simple routing
- 3B model → relevance checking, polite responses, short-form generation
- Large model → deep reasoning, complex answers, multi-tool orchestration

Each level handles what it's good at. The big model only fires when the small models signal that it's needed. This isn't just about cost — it's about latency, about reliability, about designing a system where every component is appropriately sized for its job.

At ~300 tokens per check on a $0.15/M input token model, the relevance gate costs roughly $0.000045 per query. Even at 1000 queries, that's $0.05. The cost of serving an off-topic query is easily 100x more. Right-sizing isn't just about speed — the economics compound.

### Defense in Depth Wins

Five layers of failure meant a single regex bypass took down the whole system. The relevance gate, tightened keyword checks, hardened system prompt, scoped tool descriptions, and chat locking each catch a different failure mode. Bypassing one still leaves four.

### Fail-Open is a Safety Valve

The relevance gate could false-positive on legitimate queries if the LLM is degraded. Fail-open (return true) means downtime of the classifier doesn't block the core product. The tool classifier followed the same pattern — if the LLM call fails, fall through to `none` and let the rest of the pipeline handle it gracefully.

### Classifiers Should Gate One Dimension

A classifier should gate what it classifies, not what its neighbors do. The tool classifier decides which tools. The relevance gate decides whether to answer. The query classifier decides how to route. When a classifier starts controlling adjacent concerns — like the tool classifier gating RAG — it creates blind spots that are hard to trace.

### Test End-to-End

Unit tests can't catch production score thresholds, silent error drops, or frontend guards that never triggered. The relevance gate was correct in unit terms — but the frontend error handler had a bug that existed for months, just never triggered because every previous error path happened to include a messageId. Only an end-to-end test revealed it.

### The Takeaway

Building AI products means building boundaries. The model is powerful and wants to be helpful — perhaps too helpful. The seven-second classifier is fixed now, and the relevance gate catches queries that shouldn't be answered at all. But the pattern lives on in every pipeline that defaults to "the big model" for "a small task," or trusts a single layer of defense to guard the gate.

It's worth checking yours.
