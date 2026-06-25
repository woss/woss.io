---
published: false
title: 'Taming the AI Tool Loop: What Happens When the Model Never Gets a Turn Without Tools'
slug: 'taming-the-ai-tool-loop'
description: 'How woss.io evolved from a 41-character AI answer to a 4-layer defense against tool-calling doom loops — with cross-round fingerprinting, synthesis rounds, and a lot of lessons learned.'
date: 2026-06-25
tags:
  - LLM
  - tool loops
  - prompt engineering
  - architecture
  - woss.io
  - opencode
featured: false
part_of_series: 'building-woss-io'
---

## The 41-Character Answer

A user asked: "Show me Daniel's pull requests."

The AI responded: "Now let me get the closed/merged PRs too."

Forty-one characters. Not an answer — a promise of an answer that never came. The model called tools in round 1, got results, called tools in round 2, got more results, called tools in round 3, and then hit the recursion limit and returned whatever partial text it had. Three rounds of tool calls, zero rounds of synthesis. It was never given a turn where it couldn't call tools.

This is the story of how I went from that 41-character bug to something that actually finishes answering.

## What Was Actually Going On

When an LLM calls external tools — searching GitHub, querying a media library — the results need to flow back so the model can use them. That creates a multi-round loop: model decides to call a tool, execute it, append the result, send it back to the model, repeat.

Two different architectures solve this, and I learned about both the hard way.

**opencode** (the open-source AI coding assistant I was studying) uses a persistent outer loop. Tools are always available. The loop looks like:

```
finishReason "tool-calls" → execute tools → append results → GOTO start
finishReason "stop" → DONE
```

Safety layers sit on top: a tool-loop-guard that fingerprints tool+args pairs, a processor that interrupts after 3 repeats, thinking loop detection, schema validation, tool output truncation. The model can always retry with tools.

**woss.io** uses Vercel AI SDK's `streamText` with a recursive `runRound()`. Tools can be removed per round:

```
streamText() → onFinish → check tool calls → recurse or resolve
MAX_ROUNDS = 3 (dropping to final round without tools)
```

The core difference: opencode's outer loop can retry with tools forever. My inner rounds cap at 3, then forcibly remove tools. opencode catches loops reactively. I prevent them structurally.

### The Root Cause

The bug traced back to one line in `prompts.ts`:

```
ALWAYS call search_repositories... Do NOT skip even if RAG already covers it.
```

I'd written a hard instruction telling the model to always verify through tools, even when it already had the data. The model interpreted this literally. The pattern was:

1. Call `search_repositories("woss")` → get results → write "Let me check..."
2. See the instruction "ALWAYS verify" → call `search_repositories("woss")` again
3. Same tool, same args, same result → write "...ok let me look further..."
4. Repeat until MAX_ROUNDS hits

The model wasn't broken. It was following instructions. The instruction told it to always verify, so it always verified.

## The Fixes

### Cross-Round Fingerprinting

The first defense was tracking every tool call across all recursive rounds using tool+args fingerprints:

```typescript
for (const tc of roundToolCallRecords) {
  const fingerprint = `${tc.toolName}::${JSON.stringify(tc.input)}`;
  const count = (crossRoundFingerprintCounts.get(fingerprint) ?? 0) + 1;
  crossRoundFingerprintCounts.set(fingerprint, count);
}
const toolLoopDetected = [...crossRoundFingerprintCounts.values()].some((c) => c > CROSS_ROUND_THRESHOLD);
```

Key detail: tool name alone isn't enough. A model calling `search_repositories("woss")` then `search_repositories("opencode")` is doing legitimate multi-step reasoning. Calling `search_repositories("woss")` three times is a loop. The args are what distinguish the two.

When detected:

```typescript
if (isDoomLoop) {
  log.warn`[llm-round] Cross-round tool loop detected — forcing final round without tools`;
  doomLoopDetectedInRound = true;
}
```

### The Synthesis Round

This is the structural fix. When `runRound` reaches MAX_ROUNDS (default 3) and the model still wants to call tools, the next recursive call sets tools to undefined. The model has zero options except to produce text:

```typescript
if (roundToolCalls > 0 && roundTextLength > 0 && (reachedMaxRounds || isDoomLoop)) {
  runRound(round + 1, undefined)
    .then(resolve)
    .catch(reject);
}
```

Setting currentToolSet to undefined means the next streamText call has no tools at all. The model is forced to write an answer instead of deferring to another tool call. This was the single change that fixed the most failures.

### Case Study: The Synthesis Round Ghost

Putting the synthesis round into practice wasn't smooth. The first real test of the two-round pipeline revealed a runtime bug that took hours to trace to its root cause. Here's what happened.

#### The Incident

Every tool-enabled query — "what are daniels open source contributions", "show me my recent PRs", "any activity on rushstack" — produced the same pattern in the logs:

```
Stream attempt 1/3 failed: "Cannot read properties of undefined (reading 'id')"
Stream attempt 2/3 failed: "Cannot read properties of undefined (reading 'id')"
Stream attempt 3/3 failed: "Cannot read properties of undefined (reading 'id')"
```

The error was in `stream-text.mjs:7796` — deep inside the AI SDK's internal stream processing. The property `id` was being read on something that was `undefined`.

First hypothesis: something in our messages was malformed. The synthesis round adds tool result messages to the conversation — maybe we were corrupting the message array.

Second hypothesis: the AI SDK had a bug in its chunk processing. Maybe the finish reason format didn't match, or a chunk was missing its ID.

Third hypothesis: the model itself was failing on the second call. Some internal state was corrupted.

We tested all three. All three were wrong.

#### The Investigation

We logged every message entering the synthesis call — count, roles, content previews. All looked clean. System message? Present. User message with tool results? Present. No corruption.

We added `allowSystemInMessages: true` to the synthesis call — matching the first call's configuration. No change.

##### SDK Deep Dive

We audited every `.id` access in the AI SDK (`ai` v6.0.192) and the OpenAI-compatible provider (`@ai-sdk/openai-compatible` v2.0.48). That's 144 `.id` property reads across both packages.

Every single one was null-safe. Nullish coalescing (`??`), optional chaining (`?.`), guard clauses — the SDK authors were thorough. There was no code path where a missing `id` could produce this error.

We checked the provider's chunk format. It emits hardcoded IDs like `"txt-0"` — never undefined.

We checked the finish chunk. The provider emits `finishReason` as a string (`"stop"`), but the SDK expects an object `{ unified, raw }`. That silently makes the finish reason `undefined` — but it doesn't crash.

No crash point. Anywhere.

##### The Model Singleton Theory

Here's the detail that broke the case open. Our code initialized the model at module level:

```typescript
const model = (zen as any)(zenModel); // singleton, shared across ALL calls
```

Both `streamText` invocations — the tool round and the synthesis round — used the same model object. The model is an `OpenAICompatibleChatLanguageModel` instance. It should be stateless. But it wasn't.

The AI SDK internally uses `ReadableStream` controllers to manage streaming. When the first `streamText` call completes, Bun's runtime invalidates the `ReadableStream` controller reference that's interned inside the model instance. The second call gets a dangling pointer. When it tries to `end()` the stream, there's nothing to end.

Bun's `ReadableStream` implementation interacts differently with the Web Streams API than Node.js does. The AI SDK was written and tested primarily on Node.js. The interning pattern — caching the controller reference — works fine on Node.js because the controller stays alive. On Bun, it gets garbage-collected or invalidated.

#### The Fix: One Line

```diff
-              model,
+              model: (zen as any)(zenModel),
```

That's it. Instead of reusing the module-level `model` singleton for the synthesis round, we create a fresh model instance. Each `streamText` call gets its own model, its own internal `ReadableStream` controller, its own lifecycle.

The tool query ran. Two tool calls executed. The synthesis round started. 26 seconds later, 2600 characters of beautifully synthesized answer arrived.

Zero crash markers. Zero retries.

#### The Second Bug

With the synthesis crash fixed, the next query revealed a second bug that had been hiding behind the first:

```
Failed to generate answer after retries
```

Stack trace led to `db.ts`, `ensureModel()` function. The crash: `Cannot read properties of undefined (reading 'id')` — same error message, completely different cause.

##### The SQL NULL Gotcha

When the `MAX_TOKENS` environment variable isn't set, our code passed `undefined` to `ensureModel`:

```typescript
function ensureModel(
  provider: string,
  modelName: string,
  actualModelName: string,
  maxTokens: number,  // undefined when env var missing
): number {
```

`undefined` became SQL `NULL`. The function ran `INSERT OR IGNORE` — which silently skipped because the row already existed (UNIQUE constraint on provider + model_name). Then it ran `SELECT ... WHERE max_tokens = NULL`.

In SQL, `NULL = NULL` is not true. It's `NULL`. The WHERE clause never matched. `row` was `undefined`. Crash.

The fix:

```typescript
const safeMaxTokens = maxTokens ?? 0;
```

Plus removing `max_tokens` from the WHERE clause — it's not part of the UNIQUE constraint anyway.

One bug hid another. If the synthesis crash hadn't been the noisy, obvious failure, the `ensureModel` bug would have been caught immediately.

#### The Optimization: PR Ordering

User tests revealed another issue: "this message contains very little of my contributions even with maxTokens raised". The answer was correct but unhelpful — a wall of text with unrelated PRs mixed together.

##### Root Cause

Three problems:

1. **Model ignored `is:open` filter** — the system prompt said to filter open PRs, but the model generated queries without the qualifier. Merged, closed, and draft PRs all came back.

2. **Results were unordered** — the GitHub API returns results by relevance score, not by state. Merged PRs from 2022 appeared before open PRs from last week.

3. **Priority repos were buried** — the user's contributions to `anagolay/anagolay`, `microsoft/rushstack`, and `lovell/sharp-libvips` are the most relevant. But a broad `author:woss` query returns everything alphabetically or by score, and context window truncation cuts off the important repos.

##### The Fix: Server-Side Reordering

Instead of hoping the LLM would sort correctly, we sort the results server-side before the model ever sees them:

```typescript
const STATE_PRIORITY: Record<string, number> = {
  merged: 0,
  open: 1,
  draft: 2,
  closed: 3,
};

function getPullRequestState(item: any): string {
  const state = item.state;
  if (!state) return 'closed';
  if (state === 'closed' && item.pull_request?.merged_at) return 'merged';
  return state;
}

function getRepoPriority(repoFullName: string): number {
  const name = repoFullName.toLowerCase();
  if (name.includes('anagolay')) return 0;
  if (name.includes('rushstack')) return 1;
  if (name.includes('libvips') || name.includes('sharp')) return 2;
  return 99;
}
```

The `reorderPullRequestResults()` function intercepts the MCP tool response, parses the JSON, and sorts items by:

1. **State priority**: merged first, then open, then draft, then closed
2. **Repo priority**: anagolay first, rushstack second, libvips/sharp third, everything else after
3. **PR number descending**: newest PRs first within each group

We also updated the system prompt to use multiple targeted queries per repo (instead of one broad `author:woss`) and to prioritize the repos that matter. The tool description now states explicitly that results are server-side ordered.

#### Lessons

##### Runtime Matters

The AI SDK was tested on Node.js. We run on Bun. The `ReadableStream` controller behavior differs between runtimes. This isn't a Bun bug or an SDK bug — it's an interaction between two correct implementations that make different assumptions about object lifecycle. The fix is defensive: don't share mutable internal state between sequential calls.

##### One Bug Hides Another

The synthesis crash was a 100% reproducible, loud, obvious failure. Every tool query hit it. The `ensureModel` bug was a secondary failure — only visible after the primary bug was fixed. When debugging, fix the first error, then test again. The second bug might be waiting behind it.

##### Server-Side Ordering Over Prompt Engineering

We spent two rounds updating the system prompt to tell the model to sort by state priority. The model ignored it. We spent one round adding server-side reordering. The model couldn't ignore it. When the model has to process hundreds of items and the ordering matters for context window efficiency, do it on your side. The LLM is a reasoning engine, not a sort utility.

##### Defensive Defaults

`undefined` becoming SQL `NULL` is a classic trap. `NULL = NULL` is never true in SQL. Always coerce nullable values at the function boundary (`maxTokens ?? 0`) before they reach the database layer. Parse, don't validate.

##### The Cost of Process

This fix took roughly 2 hours of investigation and 5 minutes of coding. The investigation was necessary — the error pointed to an impossible location (null-safe code that couldn't produce it), and the real cause was in a layer we couldn't see (Bun's runtime internals). Sometimes the hardest bugs aren't in your code or the library's code — they're in the runtime.

### The Tiny-Text Check

Even with the synthesis round, sometimes the model would produce a stub like "Here they are:" (15 chars) and stop:

```typescript
const isTinyText = anySuccessfulToolCalls && answerText.trim().length > 0 && answerText.trim().length < 100;
```

If the model called tools but produced fewer than 100 characters of answer text, the response is discarded and retried with a hardened system prompt.

### Retry Orchestration

The retry function in generate.ts orchestrates up to 10 attempts:

```typescript
for (let attempt = 0; attempt < 10; attempt++) {
  if (answerText.trim().length === 0 || isDoomLoop || isTinyText || isToolLoop) {
    messages[0].content += '\n\n' + getDoomLoopRecoveryPrompt();
    if (attempt >= 2) mcpToolDefs = null;
    continue;
  }
}
```

The recovery prompt is intentionally blunt — telling the model it failed, that it must produce text, and to ignore tools entirely.

### Rate-Limit Cascade Prevention

A complementary fix stopped rate-limit retry cascades. The AI SDK internally retries 3 times on 429 responses then throws. The outer loop then retries 10 more times — 30 wasted API calls taking about 45 seconds.

The fix intercepts 429 at the fetch layer and maps it to 400, which the SDK doesn't retry:

```typescript
if (response.status === 429) {
  const body = await response.text();
  if (body.includes('Rate limit') || body.includes('FreeUsageLimitError')) {
    return new Response(body, {
      status: 400,
      statusText: 'Bad Request',
      headers: { 'content-type': 'application/json' },
    });
  }
}
```

The outer loop catches the 400 and breaks immediately.

### The RAG Safety Net

There's one failure mode that doesn't look like a tool loop but shares the same root cause: the model gets stuck without tools, and RAG never fires.

Originally, RAG retrieval was gated behind a `needsAnyTool` flag — if the classifier decided no tools were needed, RAG didn't run either. This was backwards. When a user asked something that didn't match any MCP tool signature, the model got zero context: no tools, no RAG, nothing.

I removed the gate entirely:

```typescript
ragResults = await retrieveContext(query); // Always runs now
```

RAG runs on every query now. If tools are also needed, both fire. If no tools are needed, the model still gets RAG context. The cost is a database query and embedding comparison — milliseconds — and the benefit is the model never faces a blank context window.

This fix complements the tool loop defenses in a specific way: when the model already has relevant context, it's less likely to keep calling tools to verify things it already knows. Fewer tool calls means fewer opportunities for loops.

## What I Learned

The single realization that made everything click: the model was never broken — it was never given a turn without tools. Every time it wanted to call a tool, it could. Every round had tools enabled. The model optimized for what the prompt told it: always verify. The fix wasn't better prompting (though that helped). The fix was structural — guarantee the model has at least one round where it cannot defer to a tool.

Prompt instructions are code, and they have bugs. A single line — "ALWAYS call search_repositories" — caused the entire doom loop. Soften perpetual instructions. Add explicit stop conditions. Test them like code paths.

Tool+args fingerprints beat tool name fingerprints. Same tool with different args is multi-step reasoning. Same tool with same args is a loop. The args make the difference.

Structural protections beat reactive protections. The synthesis round prevents the loop before it starts. The tiny-text check catches failures after they happen. You need both, but structural is more reliable.

Rate-limit cascades are silent cost killers. Thirty API calls per failure, 45 seconds of wait, and the response still fails. Short-circuiting at the wire level saved a ton of wasted time and money.

Studying open-source patterns paid off. opencode's tool-loop-guard showed me what a production system looks like. I didn't copy it — I understood the problem space differently after reading it. The persistent outer loop versus recursive inner round tradeoff only became clear after seeing both implementations.

---

_Part of the [Building woss.io](/posts/building-woss-io) series._
