# Finish Reason Research — DeepSeek/Cloudflare Workers AI Tool Call Bug

## Problem

DeepSeek / Cloudflare Workers AI emit `finish_reason: "stop"` in the same SSE stream as tool call deltas. This causes `streamText`'s `onFinish` callback to report `finishReason: "stop"` instead of `"tool-calls"` when tool calls were actually made.

## Root Cause

The `@ai-sdk/openai-compatible` provider's SSE transform at `index.js:720-724` tracks `finish_reason` from each raw SSE chunk with no awareness of accumulated tool calls:

```javascript
if (choice?.finish_reason != null) {
  finishReason = {
    unified: mapOpenAICompatibleFinishReason(choice.finish_reason),
    raw: choice.finish_reason,
  };
}
```

The provider's `mapOpenAICompatibleFinishReason` (line 320-334) maps `"tool_calls"` → `"tool-calls"` correctly, but the upstream API sends `"stop"` even when the stream contained tool call deltas.

## Key Findings

### 1. `streamText` has NO `fetch` option

`CallSettings` type at `ai/dist/index.d.ts:385` only has `maxOutputTokens, temperature, topP, topK, presencePenalty, frequencyPenalty, stopSequences, seed, maxRetries`. No `fetch`.

### 2. `createOpenAICompatible` DOES accept `fetch`

At `@ai-sdk/openai-compatible/dist/index.d.ts:277-280`:

```
fetch?: FetchFunction;
```

This `fetch` is passed through to `postJsonToApi` and intercepts ALL HTTP requests made by the provider. Verified at `index.js` lines 587, 670, 1290, 1333, 1548, 1640, 1673, 1722.

### 3. Provider SSE emits `"finish"` event per chunk

At `index.js:720-724`, provider tracks `finish_reason` from each SSE chunk. At `index.js:907-912`, it enqueues `type: "finish"` with the current `finishReason` at end of each chunk where `delta` is present.

### 4. SDK internal multi-round works despite wrong `finishReason`

At `index.js:4722-4728`, the `streamText` loop termination condition checks **tool calls + outputs** and **stop conditions**, NOT `finishReason`. Tool execution continues correctly. The `finishReason` is just metadata passed to `onFinish`.

### 5. Frontend doesn't consume `step-finish` reason

`+page.svelte` has NO `step-finish` event listener. Only listens for `token`, `done`, `contact_intent`, `tool_call_start`, `tool_call_end`, `status`, `error`. The `reason` field only affects:

- `step-finish` event emitted to the Effect stream
- `generate.ts:497-498` — handler checks `event.toolCalls > 0`, NOT `reason`
- `generate.ts:567` — doom loop detection uses `anyStepHadToolCalls && answerText.trim().length === 0`, NOT `reason`

**So `reason` being `"stop"` doesn't affect any downstream behavior.**

## Fix Approaches

### Approach A: Custom `fetch` in `createOpenAICompatible` (root-cause fix)

Create SSE TransformStream that rewrites `"finish_reason":"stop"` → `"finish_reason":"tool_calls"` when tool call deltas were seen upstream.

**Location**: `llm/provider.ts` — pass custom `fetch` to `createOpenAICompatible()`

**Implementation sketch**:

1. Create a `fixFinishReasonTransform()` that returns a `TransformStream<Uint8Array, Uint8Array>`
2. Buffers SSE lines, tracks whether any `tool_calls` seen in `delta`
3. When `finish_reason:"stop"` encountered AND tool calls seen → rewrite to `finish_reason:"tool_calls"`
4. Create custom `fetch()` that calls original `fetch`, pipes response body through the transform, returns new `Response` with transformed body
5. Pass custom `fetch` to `createOpenAICompatible({ fetch: customFetch, ... })`

**Files to modify**:

- `src/lib/server/llm/provider.ts` — add custom `fetch` wrapper
- `src/lib/server/openai-provider.ts` — update `mapFinishReason` is no longer needed (optional cleanup)

### Approach B: Fix `mapFinishReason` in `openai-provider.ts` (app-level fix)

Add `hadToolCalls` parameter to `mapFinishReason`. If `reason === 'stop'` and tools were called, return `'tool-calls'`.

**Files to modify**:

- `src/lib/server/openai-provider.ts`
  - `mapFinishReason(reason: string, hadToolCalls: boolean = false): FinishReason`
  - At line 365: `mapFinishReason(lastFinishReason, roundToolCalls > 0)`
  - At line 363-370: update `stepFinishEvent` call

### Approach C: Fix `onFinish` callback (app-level fix)

In the `onFinish` callback (line 342-356), when `roundToolCalls > 0` and `event.finishReason === "stop"`, override `lastFinishReason = "tool-calls"`.

```typescript
onFinish: (event) => {
  lastFinishReason = roundToolCalls > 0 && event.finishReason === 'stop' ? 'tool-calls' : String(event.finishReason);
  // ... rest unchanged
};
```

## Recommendation

Given that:

1. Frontend doesn't consume `reason` at all
2. Doom loop detection only checks `toolCalls > 0`
3. The SDK internally executes tools correctly regardless of `finishReason`

**Approach C is recommended** — simplest correct fix. Single boolean check in the `onFinish` callback. No new files, no SSE parsing, no risk of breaking protocol handling.

If protocol-level correctness is desired for future consumers (e.g., `generateText`), choose **Approach A**.

## Relevant Files

- `src/lib/server/openai-provider.ts` — Core LLM provider, `mapFinishReason` at line 532, `chatStreamWithTools` at line 255, `onFinish` at line 342
- `src/lib/server/generate.ts` — Orchestrator, `streamWithRetry` processes `step-finish` at line 497
- `src/lib/server/llm/provider.ts` — `createOpenAICompatible` factory
- `src/lib/server/llm/types.ts` — `FinishReason` type definition
- `src/routes/chat/[id]/+page.svelte` — Frontend SSE consumer (line 540+)

## Dependencies

- `ai@^6.0.192` — Vercel AI SDK
- `@ai-sdk/openai-compatible@2.0.48` — OpenAI-compatible provider
- `@ai-sdk/provider@^3.0.10` — Provider interface
- `@ai-sdk/provider-utils@4.0.27` — Provider utilities
- `@ai-sdk/vercel@^2.0.50` — Vercel integration
