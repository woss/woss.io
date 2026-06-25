# LLM Relevance Gate — Prevent Off-Topic Queries

## Problem

The AI chat can be used for generic questions unrelated to Daniel Maricic's portfolio. Example: [chat 06a1bf7b](http://localhost:5173/chat/06a1bf7b-6a98-453b-8ca4-b03470c70f1e) where user asked _"Search GitHub for open source AI coding agents"_ and the AI responded with a list of popular open-source projects (goose, deer-flow, LibreChat) — none of which are Daniel's.

### Root Cause Chain

1. **`POST /api/ask`** validates only: text ≤ 500 chars, rate limit (10/min), max 50 msg/chat. No relevance gate.
2. **`classifyQuery()`** categorizes as tool/rag/hybrid only. Never says "reject". Generic query scored toward 'tool' centroid → RAG disabled, MCP tools loaded.
3. **`needsExternalTools()`** triggers on broad regex: `/open\s*source.*contribut|pr\b|pull/` matched despite zero relation to Daniel.
4. **MCP tools** (`search_code`, `search_repositories`, etc.) are unrestricted — model searched GitHub generically.
5. **System prompt** guides but doesn't enforce. No instruction to REFUSE off-topic questions.

## Solution Architecture — LLM-Powered Relevance Gate

A fast binary classifier call placed **before** embedding, RAG, or streaming. Uses same LLM provider with `temperature=0`, `max_tokens=5`. Cost: ~0.0001¢ per call. Latency: ~200-500ms for relevant queries (saves 1000-3000ms for rejected ones).

### Flow Change

```
Current:                           New:
POST /api/ask → validate           POST /api/ask → validate
  → embedText                        → load history
  → check cache                      → RELEVANCE CHECK (LLM call)
  → classifyQuery (centroid)           ← if "no" → reject
  → RAG search                       → embedText
  → load history                     → check cache
  → buildRagPrompt                   → classifyQuery (centroid)
  → load MCP tools                   → RAG search
  → stream LLM                       → buildRagPrompt
                                     → load MCP tools
                                     → stream LLM
```

### Relevance Check Implementation

```typescript
// In src/routes/api/ask/+server.ts — new function
async function isRelevant(
  question: string,
  history: { role: string; content: string }[],
  signal?: AbortSignal,
): Promise<boolean> {
  const context = history
    .slice(-2)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n');

  const response = await fetch(`${config.openai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.openai.model,
      messages: [
        {
          role: 'system',
          content: 'You are a strict relevance filter for a portfolio website. ' + 'Respond only with "yes" or "no".',
        },
        {
          role: 'user',
          content:
            "Is this question about Daniel Maricic's professional portfolio, " +
            'skills, experience, projects, or career history?' +
            (context ? `\n\nPrevious context:\n${context}` : '') +
            `\n\nQuestion: ${question}`,
        },
      ],
      temperature: 0,
      max_tokens: 5,
    }),
    signal: signal ?? AbortSignal.timeout(5000),
  });

  const body = await response.json();
  const answer = body?.choices?.[0]?.message?.content?.trim().toLowerCase();
  return answer === 'yes';
}
```

### Placement in `startGeneration()` (src/routes/api/ask/+server.ts)

After loading history (line ~199), before `embedText` (line ~188):

```typescript
// 1a. Check relevance — reject off-topic questions early
publishLive(chatId, 'status', { step: 'checking_relevance' });
const relevant = await isRelevant(text, history, abortController.signal);
if (!relevant) {
  publishPersistent(chatId, 'error', {
    message: "I can only answer questions about Daniel Maricic's professional portfolio and experience.",
  });
  return;
}
```

### Additional Files to Modify

#### 1. `needsExternalTools()` — Tighten regex (src/routes/api/ask/+server.ts:61-76)

```typescript
function needsExternalTools(text: string): boolean {
  const t = text.toLowerCase();
  // Must reference Daniel or his repos to trigger GitHub tools
  const referencesDaniel = /\b(daniel|woss|anagolay|idiyanale|idsoul|sensio)\b/.test(t);
  if (!referencesDaniel) return false;
  // Then check for GitHub actions
  return /pr|pull request|commit|issue|repo|repository|github|stars|fork/.test(t);
}
```

#### 2. System prompt hardening (src/lib/server/config.ts:65-73)

Append to system prompt:

```
CRITICAL — REFUSAL RULE: If the user asks about anything NOT related to Daniel Maricic, his portfolio, his projects, his skills, or his professional experience — do NOT answer. Do not use tools. Instead respond with exactly: "I can only answer questions about Daniel Maricic's professional portfolio and experience." This overrides all other instructions.
```

#### 3. MCP tool descriptions — Scope to Daniel (src/lib/server/mcp/tools.ts:12-58)

Append to each tool description: "Only use for queries about Daniel Maricic's work."

For example: `search_code` → "Search for code across GitHub repositories. Only use for queries about Daniel Maricic's projects and contributions. Supports qualifiers like repo:owner/repo..."

## Key Design Decisions

| Decision             | Choice                                 | Rationale                                           |
| -------------------- | -------------------------------------- | --------------------------------------------------- |
| Model for classifier | Same as main model                     | No additional config; works with OpenRouter routing |
| Temperature          | 0                                      | Deterministic yes/no                                |
| Max tokens           | 5                                      | Only need 1 token but small buffer                  |
| History context      | Last 2 messages                        | Enables follow-ups without noise                    |
| Timeout              | 5s                                     | Fail-open to avoid blocking                         |
| Fail mode            | Allow (true)                           | Better to answer than to block legit queries        |
| Transport            | Direct HTTP fetch to API               | Avoids re-entering Effect/Stream pipeline           |
| Cost                 | ~0.0001¢ per call (~300 prompt tokens) | Negligible compared to full generation              |

## Edge Cases Handled

1. **Follow-up question**: "tell me more" → history provides context → classifier sees "tell me more" + previous "what's Daniel's experience?" → relevant.
2. **Generic GitHub search**: No reference to Daniel, no relevant history → rejected.
3. **Hybrid question**: "Daniel's PRs and open source contributions" → references Daniel → allowed.
4. **Empty question**: Already blocked by `text` validation.
5. **Jailbreak attempts**: System role separation + strict instruction "you are a strict filter" prevents injection from user content.
6. **Classifier timeout/error**: `AbortSignal.timeout(5000)` with catch → returns `true` (fail-open, allow the query).

## Implementation Order

1. Add `isRelevant()` function to `src/routes/api/ask/+server.ts`
2. Call it in `startGeneration()` before `embedText`
3. Send rejection as persistent SSE error event
4. Harden `needsExternalTools()` with Daniel reference check
5. Harden system prompt with refusal rule
6. Harden MCP tool descriptions to scope them
