---
published: false
title: "The 'Let Me' Trap: When Your AI Assistant Keeps Promising to Answer Instead of Doing It"
slug: 'the-let-me-trap'
description: 'How a single transitional phrase caused 10,000 wasted tokens in an LLM tool-calling pipeline — and the two-bug debugging journey from DSML blocks to false-positive interim round detection.'
date: 2026-06-20
tags:
  - LLM
  - debugging
  - tool calling
  - woss.io
  - deepseek
  - DSML
featured: false
part_of_series: 'building-woss-io'
---

## The Query That Should've Been Simple

A user asks woss.io: _"show me daniels non ai photos."_

The AI responds with 300 characters of useless text after burning 10,000+ tokens, 2 minutes 44 seconds, and multiple retries. No photos. No links. Just a string of transitional phrases — "let me check," "let me look," "let me find" — that the model kept repeating because it never got a chance to actually complete the thought.

This is the story of why that happened, the two bugs hiding behind each other, and what debugging an LLM pipeline taught me about how easily a single phrase like "let me" can destroy your entire tool-calling architecture.

## The Two-Bug Debugging Journey

I'd just shipped a major fix for [tool-calling doom loops](/posts/taming-the-ai-tool-loop) — cross-round fingerprinting, synthesis rounds, the works. Tests passed. The demo queries I'd been using for weeks worked fine. I was feeling pretty good.

Then someone tried to find photos of me. And the whole thing fell apart.

What followed was a debugging session that revealed not one, but two bugs stacked on top of each other. Fixing the first one didn't fix the query — it just revealed the second one, which had been hidden behind the retry loop the first bug created.

### Bug 1: DSML Blocks

The first clue came from the logs. I grepped by the message ID:

```
grep '"msgId":"<msgId>"' ./data/logs/woss.io.log
```

The `RAW_LLM_OUTPUT` lines told the story. The model (DeepSeek V4 Flash via a Zen proxy) was producing its answer, but something was stripping it before it reached the user. The log showed near-empty text — just transitional phrases — followed by the pipeline deciding to retry.

The model uses DeepSeek V4 Flash through a Zen proxy. This model outputs something called DSML — a DeepSeek-specific XML-like format for tool calls — _after_ it's already done native JSON tool calls. It's redundant metadata. The model runs its tool calls through native function calling (JSON), produces the answer, then tacks on a DSML block as a bonus.

The problem: the `ToolCallXmlStripper` in the pipeline was stripping both DSML _and_ plain XML from the answer text. It didn't differentiate. It just saw `<tags>` and removed them. What was left? Only the transitional phrases the model had written before getting to its actual point: "Let me check," "Let me look," "Let me find..."

These hit the `isInterimText` detection. The pipeline classified the round as "interim" — the model was _about_ to call tools, it just hadn't done it yet. Retry. Burn tokens. Repeat.

Attempt 0: stripped to "Let me check..." → interim → retry.
Attempt 1: same pattern → retry.
Attempt 2: same pattern → retry.

The fix was a dedicated DSML parser. I created `src/lib/server/pipeline/dsml-parser.ts` with three functions:

```typescript
hasDsmlBlocks(text); // Quick check for ｜DSML｜ token
parseDsmlToolCalls(text); // Regex parser extracting tool calls from DSML blocks
stripDsmlBlocks(text); // Remove ｜DSML｜tool_calls blocks, keep surrounding text
```

The interface is minimal:

```typescript
interface DsmlToolCall {
  name: string;
  params: Record<string, string>;
}
```

The key placement detail: DSML stripping happens AFTER the `RAW_LLM_OUTPUT` log line (so we can still see what the model produced) but BEFORE the XML safety net. DSML tool calls are NOT executed — native JSON already handled them. DSML is just redundant metadata, and stripping it preserves the model's actual text.

After deploying this fix, I ran the query again. The DSML was gone. The text was preserved. And the pipeline... still broke. Just differently.

### Bug 2: The Interim Round False Positive

This time, everything worked up to a point. The model called `get_users("daniel")`, got results back, and started writing "Let me look up daniels ai photos..."

And then the interim round detection fired. The round was classified as interim. The model was forced into a final round without tools, couldn't call `traverse` to actually explore the user's directories, and produced 300 characters of useless text.

The culprit was a single line in `openai-provider.ts`:

```typescript
const isInterimRound =
  roundTextLength > 0 &&
  roundToolCalls > 0 &&
  /(let me|i'll|i will|i should|i need to)/i.test(roundText) &&
  !/`{3}|`[^`]+`|\|.*\|.*\||^#+\s/m.test(roundText);
```

Spot the problem. A single match of "let me" — one of the most common phrases in conversational English — would classify an entire round as interim. The model had just called `get_users`, gotten real data, and was beginning to write "Let me look up..." as a natural discourse transition. Not as a stall. It was about to _use_ the tool results.

The regex didn't care. One match, boom, interim round detected.

This is the bug that was hidden behind Bug 1. Before the DSML fix, the model's text was stripped to _only_ transitional phrases, so the retry loop was the visible failure mode. Once DSML was handled properly, the model could actually produce enough text to trigger the interim detection — which then killed the round anyway.

Two bugs, same query, different failure modes. Fixing the first revealed the second.

The fix changed the threshold from 1 match to 3:

```typescript
const INTERIM_PATTERNS = /\b(let me|i'll|i will|i should|i need to)\b/gi;
const interimMatchCount = (roundText.match(INTERIM_PATTERNS) ?? []).length;
const isInterimRound =
  roundTextLength > 0 &&
  roundToolCalls > 0 &&
  interimMatchCount >= 3 &&
  !/`{3}|`[^`]+`|\|.*\|.*\||^#+\s/m.test(roundText) &&
  roundTextLength < 2000;
```

Three changes: bumped the threshold from 1 to 3, added a word-boundary check (`\b`) so "let me" in "letter metadata" doesn't trigger, and added a text-length guard (<2000 chars). A model with a real answer doesn't keep saying "let me" three times.

## The Numbers

The difference between broken and fixed:

| State             | Duration | Tool Calls                 | Answer Length | Quality                      |
| ----------------- | -------- | -------------------------- | ------------- | ---------------------------- |
| Before both fixes | 2m44s    | 0 (all retries)            | 0 chars       | No answer                    |
| Bug 1 fixed only  | 9.9s     | 1 (get_users)              | ~300 chars    | Useless text                 |
| Both fixed        | 33s      | 6 (get_users + 5 traverse) | 5,230 chars   | Actual photo URLs + markdown |

The log line that confirmed everything worked:

```
[llm-round] 1 tool calls, 70 text chars — continuing with tools
```

Instead of killing the round, the pipeline continued. The model made 5 more `traverse` calls across 5 directories, built up the full context, and produced a rich answer with actual photo URLs and markdown formatting.

70 characters of transitional text with a single "let me" — the old code would've killed this round. The new code saw one match, recognized it as normal speech, and kept going.

## How the Interim Round Detection Evolved

This wasn't my first attempt at solving the "model never finishes" problem. The interim round detection went through four phases:

1. **Removed entirely** (too strict) — Earlier logic gated the final round based on a tool classifier. If the model "didn't need tools," RAG never ran. Blank context window.

2. **MAX_ROUNDS=3** (blunt instrument) — Force final round without tools after 3 rounds. Structural but rigid. Killed legitimate multi-step queries.

3. **Interim round detection** (the middle ground) — Detect transitional text + tool calls, force final round sooner. The original threshold was 1 match. Way too aggressive.

4. **This fix** (aligned thresholds) — Require 3+ matches and text <2000 chars. This matched the behavior already in `stream.ts:329`, which used the same 3-match threshold. Two parts of the same system making the same decision — that's the right pattern.

## What the Logs Taught Me

All logs are stored at `./data/logs/woss.io.log`. Every log call inside message processing carries `"msgId":"xxx"` via AsyncLocalStorage. The debugging pattern:

1. Extract `chatId` and `messageId` from the URL
2. Grep by messageId: `grep '"msgId":"<msgId>"' ./data/logs/woss.io.log`
3. Extract the `traceId` from matched lines for broader scope
4. Look for `RAW_LLM_OUTPUT` to see what the model actually produced
5. Look for `[llm-round]` lines to track tool call decisions and interim detection
6. DSML stripping confirmed by "DSML blocks stripped" log line

Without these log markers, this would've been guesswork. The `RAW_LLM_OUTPUT` log alone — seeing the model's raw text vs what the pipeline decided about it — was the single most useful debugging tool.

## Lessons

**Fixes reveal deeper bugs.** The DSML fix didn't "fix the query" — it revealed the interim round bug that was hidden behind the retry loop. If I'd stopped after "fixing" the visible bug, I'd have shipped a broken system that looked fixed in testing but failed on real queries.

**Thresholds matter in LLM pipelines.** A regex with a single-match threshold for transitional phrases is a landmine. Humans say "let me" all the time as natural language, not as a stall signal. The regex didn't distinguish between "let me check" (stall) and "let me look up what I just found" (natural transition). The fix required 3 matches because a human saying "let me" three times in one round actually is stalling.

**Log at every decision point.** The `RAW_LLM_OUTPUT` log and `[llm-round]` markers made this debugging possible. Without seeing exactly what the model said vs what the pipeline decided about it, I'd have been guessing at root causes. The `RAW_LLM_OUTPUT` log was the turning point — it showed me the model _was_ producing text, and the stripping pipeline was eating it.

**Aligned thresholds prevent future bugs.** The interim round detection now matches the `stream.ts` behavior — both require 3+ transitional phrases. When two parts of the system make the same decision, they should use the same logic. Inconsistency between `stream.ts` and `openai-provider.ts` on what counts as "interim" was asking for a bug.

**DSML is harmless, but stripping it matters.** DeepSeek's redundant tool call format doesn't break anything in itself. But when combined with XML stripping that doesn't know about it, the interaction produces empty text → retry loop. The fix wasn't complex — it was a targeted parser that strips DSML blocks and nothing else. The specificity was the point.

## The Code

All relevant source files in the woss.io repository:

- **`src/lib/server/pipeline/dsml-parser.ts`** — `hasDsmlBlocks()`, `stripDsmlBlocks()`, `parseDsmlToolCalls()` with `DsmlToolCall` interface
- **`src/lib/server/pipeline/stream.ts`** — DSML handling (line ~329), stripping after RAW_LLM_OUTPUT log, before XML safety net
- **`src/lib/server/openai-provider.ts`** — `chatStreamWithTools()`, `runRound()`, interim round detection (line 384-388), the 1→3 threshold fix

---

_This post is part of a series on building woss.io — an AI-native personal portfolio. Earlier posts covered the [system prompt positioning fix](/posts/system-prompt-position-matters), [Macula MCP tool design](/posts/macula-designing-mcp-for-llms), and [taming the AI tool loop](/posts/taming-the-ai-tool-loop)._
