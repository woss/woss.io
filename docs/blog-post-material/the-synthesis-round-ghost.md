# The Synthesis Round Ghost: How a Bun Runtime Bug Crashed Every Tool Query

## The Setup

Portfolio site with an AI chat. Visitors ask about Daniel's work — projects, PRs, contributions. The architecture is a two-round pipeline:

1. **Round 1 (with tools)**: LLM receives the query, decides which GitHub MCP tools to call (search PRs, get profile data), executes them, collects results
2. **Round 2 (synthesis)**: Same LLM receives the tool results and synthesizes a natural-language answer

First round works perfectly every time. Tools fire, results come back, the model processes them. Then it hands off to round two.

And round two crashes. Every time. With a message that made no sense.

## The Incident

Every tool-enabled query — _"what are daniels open source contributions"_, _"show me my recent PRs"_, _"any activity on rushstack"_ — produced the same pattern in the logs:

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

## The Investigation

### Message Format Audit

We logged every message entering the synthesis call — count, roles, content previews. All looked clean. System message? Present. User message with tool results? Present. No corruption.

We added `allowSystemInMessages: true` to the synthesis call — matching the first call's configuration. No change.

### SDK Deep Dive

We audited every `.id` access in the AI SDK (`ai` v6.0.192) and the OpenAI-compatible provider (`@ai-sdk/openai-compatible` v2.0.48). That's 144 `.id` property reads across both packages.

Every single one was null-safe. Nullish coalescing (`??`), optional chaining (`?.`), guard clauses — the SDK authors were thorough. There was no code path where a missing `id` could produce this error.

We checked the provider's chunk format. It emits hardcoded IDs like `"txt-0"` — never undefined.

We checked the finish chunk. The provider emits `finishReason` as a string (`"stop"`), but the SDK expects an object `{ unified, raw }`. That silently makes the finish reason `undefined` — but it doesn't crash.

No crash point. Anywhere.

### The Model Singleton Theory

Here's the detail that broke the case open. Our code initialized the model at module level:

```typescript
const model = (zen as any)(zenModel); // singleton, shared across ALL calls
```

Both `streamText` invocations — the tool round and the synthesis round — used the same model object. The model is an `OpenAICompatibleChatLanguageModel` instance. It should be stateless. But it wasn't.

The AI SDK internally uses `ReadableStream` controllers to manage streaming. When the first `streamText` call completes, Bun's runtime invalidates the `ReadableStream` controller reference that's interned inside the model instance. The second call gets a dangling pointer. When it tries to `end()` the stream, there's nothing to end.

Bun's `ReadableStream` implementation interacts differently with the Web Streams API than Node.js does. The AI SDK was written and tested primarily on Node.js. The interning pattern — caching the controller reference — works fine on Node.js because the controller stays alive. On Bun, it gets garbage-collected or invalidated.

## The Fix: One Line

```diff
-              model,
+              model: (zen as any)(zenModel),
```

That's it. Instead of reusing the module-level `model` singleton for the synthesis round, we create a fresh model instance. Each `streamText` call gets its own model, its own internal `ReadableStream` controller, its own lifecycle.

The tool query ran. Two tool calls executed. The synthesis round started. 26 seconds later, 2600 characters of beautifully synthesized answer arrived.

Zero crash markers. Zero retries.

## The Second Bug

With the synthesis crash fixed, the next query revealed a second bug that had been hiding behind the first:

```
Failed to generate answer after retries
```

Stack trace led to `db.ts`, `ensureModel()` function. The crash: `Cannot read properties of undefined (reading 'id')` — same error message, completely different cause.

### The SQL NULL Gotcha

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

## The Optimization: PR Ordering

User tests revealed another issue: _"this message contains very little of my contributions even with maxTokens raised"_. The answer was correct but unhelpful — a wall of text with unrelated PRs mixed together.

### Root Cause

Three problems:

1. **Model ignored `is:open` filter** — the system prompt said to filter open PRs, but the model generated queries without the qualifier. Merged, closed, and draft PRs all came back.

2. **Results were unordered** — the GitHub API returns results by relevance score, not by state. Merged PRs from 2022 appeared before open PRs from last week.

3. **Priority repos were buried** — the user's contributions to `anagolay/anagolay`, `microsoft/rushstack`, and `lovell/sharp-libvips` are the most relevant. But a broad `author:woss` query returns everything alphabetically or by score, and context window truncation cuts off the important repos.

### The Fix: Server-Side Reordering

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

## Files Changed

| File                                | Change                                                     |
| ----------------------------------- | ---------------------------------------------------------- |
| `src/lib/server/openai-provider.ts` | Fresh model instance for synthesis `streamText` (line 351) |
| `src/lib/server/db.ts`              | `safeMaxTokens` default, removed `max_tokens` from WHERE   |
| `src/lib/server/mcp/tools.ts`       | `reorderPullRequestResults()` and system prompt updates    |

## Lessons

### Runtime Matters

The AI SDK was tested on Node.js. We run on Bun. The `ReadableStream` controller behavior differs between runtimes. This isn't a Bun bug or an SDK bug — it's an interaction between two correct implementations that make different assumptions about object lifecycle. The fix is defensive: don't share mutable internal state between sequential calls.

### One Bug Hides Another

The synthesis crash was a 100% reproducible, loud, obvious failure. Every tool query hit it. The `ensureModel` bug was a secondary failure — only visible after the primary bug was fixed. When debugging, fix the first error, then test again. The second bug might be waiting behind it.

### Server-Side Ordering Over Prompt Engineering

We spent two rounds updating the system prompt to tell the model to sort by state priority. The model ignored it. We spent one round adding server-side reordering. The model couldn't ignore it. When the model has to process hundreds of items and the ordering matters for context window efficiency, do it on your side. The LLM is a reasoning engine, not a sort utility.

### Defensive Defaults

`undefined` becoming SQL `NULL` is a classic trap. `NULL = NULL` is never true in SQL. Always coerce nullable values at the function boundary (`maxTokens ?? 0`) before they reach the database layer. Parse, don't validate.

### The Cost of Process

This fix took roughly 2 hours of investigation and 5 minutes of coding. The investigation was necessary — the error pointed to an impossible location (null-safe code that couldn't produce it), and the real cause was in a layer we couldn't see (Bun's runtime internals). Sometimes the hardest bugs aren't in your code or the library's code — they're in the runtime.
