---
published: false
title: 'Taming the AI Tool Loop: What Happens When the Model Never Gets a Turn Without Tools'
slug: 'taming-the-ai-tool-loop'
description: 'How woss.io evolved from a 41-character AI answer to a 4-layer defense against tool-calling doom loops — with cross-round fingerprinting, synthesis rounds, and a lot of lessons learned.'
date: 2026-06-13
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
