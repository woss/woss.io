# Chat Locked / Refusal Investigation

**Date:** 2026-06-14
**Scope:** Chat `01d46d1c`, Message `f7d61280`
**Status:** Analysis complete; root causes identified

---

## Overview

User reported that chat `01d46d1c` and message `f7d61280` appeared locked and unresponsive — the LLM refused to answer. Investigation combined log analysis and code inspection to determine the root causes. The chat was not actually locked; a cascade of factors caused the LLM to emit a refusal message that made it feel stuck.

---

## Timeline

1. User sends first message in new chat. Message hash is client-generated UUID `f7d61280`.
2. SSE done handler fires and swaps the stale client UUID for the server-assigned ID (a known, already-fixed bug).
3. `generate.ts:264` runs `classifyToolNeeds` — `ctxMessages?.length` is `0` (first message), so tool loading is skipped entirely.
4. System prompt (`prompts.ts:11`) has an aggressive refusal rule early in the prompt text.
5. RAG returns no relevant documents. Zero tools are loaded. The LLM (`ministral-3-3b`) has no training data about "Daniel."
6. With no context, no tools, and a high-priority refusal rule, the LLM falls back to a refusal response.
7. Even on subsequent turns (e.g., turn 3 where 13 tools are loaded), the LLM still prefixes its answer with the refusal preamble — the rule continues to dominate.

---

## Root Causes

### 1. Stale client-generated message hash

Message `f7d61280` is a client-generated UUID that gets replaced server-side. This is an already-fixed bug in the SSE done handler: it swaps the client ID for the server UUID but does not update the client's reference properly.

### 2. Tools not loaded on first message

`generate.ts:264` (`classifyToolNeeds`) returns early when `ctxMessages?.length === 0`. This means the very first message in any chat gets no tools loaded — regardless of whether the query requires them.

### 3. Aggressive refusal rule in system prompt

`prompts.ts:11` places a refusal rule near the top of the system prompt. This gives it outsized influence over the LLM's behavior, effectively overriding downstream instructions about tool usage and response formatting.

### 4. RAG returned nothing + zero tools + weak model

- RAG found no relevant documents for the query.
- No tools were loaded (see #2).
- `ministral-3-3b` is a small model with no knowledge about "Daniel" or the project-specific context needed to answer.

### 5. Chat not actually locked — perceived as stuck

The refusal message makes the experience feel like a lock or crash. But the system was functioning normally — it just had nothing useful to say because all information pathways were empty.

### 6. Refusal preamble persists even when tools are loaded

On turn 3 (13 tools loaded), the LLM still outputs the refusal text before eventually answering. The refusal rule's position in the prompt ensures it is always considered first.

---

## Recommended Fixes

### 1. Move refusal rule later in system prompt

Shift the refusal rule from `prompts.ts:11` to after tool instructions and response formatting rules. Lower-positioned instructions have less weight in the LLM's output, so the rule would only activate when truly appropriate rather than dominating every response.

### 2. Load tools on first message

Remove the `ctxMessages?.length` check in `classifyToolNeeds` (`generate.ts:264`). Tools should be classified based on the current query content, not on whether previous messages exist. This ensures the first message always has access to relevant tools.

### 3. Add tool-calling preamble before refusal rule

Insert a preamble in the system prompt (before the refusal rule) that establishes tool use as the primary response mechanism. This gives the LLM a strong positive directive ("use these tools to answer") before encountering the negative directive ("refuse if...").

### 4. Consider a stronger model for external-data queries

`ministral-3-3b` lacks the capacity to answer project-specific questions from its training data alone. Evaluate using a larger model (or the same model with better RAG context) for queries that depend on retrieved information rather than general knowledge.

---

## Notes

- The "locked" perception is a UX problem: a refusal with no fallback or explanation feels like a crash to the user.
- Fixes 1–3 are low-risk, high-impact changes to the prompt and tool-loading logic.
- Fix 4 involves cost/performance tradeoffs and should be evaluated separately.
- The stale client-hash bug is already fixed in a previous PR.
