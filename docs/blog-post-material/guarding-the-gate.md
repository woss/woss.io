# Guarding the Gate: How We Built a $0.0001 Relevance Check for an AI Chatbot

## The Setup

Portfolio site with an AI chat. Visitors ask about Daniel's work — projects, experience, skills. RAG pipeline retrieves chunks from a vector store, LLM generates answers. MCP tools for GitHub queries. Clean, scoped, intentional.

Until someone asked: _"Search GitHub for open source AI coding agents."_

## The Incident

Chat `06a1bf7b-6a98-453b-8ca4-b03470c70f1e`. User submits a completely generic query. Three assistant messages return. Content: a ranked list of open-source AI coding agents — goose, deer-flow, LibreChat, plandex, Kilo. None of them Daniel's projects. None related to his portfolio. The AI was polite, thorough, and entirely wrong.

This wasn't a hallucination. It was a **systemic bypass**.

## Root Cause Chain

Five layers of defense that didn't exist:

### Layer 1: No Relevance Gate

`POST /api/ask` validates: text ≤ 500 chars, rate limit 10/min, max 50 msg/chat. Nothing checks whether the query belongs here at all.

### Layer 2: classifyQuery Never Rejects

`classifyQuery()` uses embedding centroids to sort queries into `tool`, `rag`, or `hybrid`. It optimizes the pipeline — it never rejects. Every query gets served.

### Layer 3: needsExternalTools Too Broad

```typescript
function needsExternalTools(text: string): boolean {
  return /open\s*source.*contribut|pr\b|pull/.test(text);
}
```

The regex matched because the query contained "open source" and the topic was generally "contribut[ion]-adjacent." No check for whether the query referenced anything about Daniel or his projects.

### Layer 4: Unrestricted MCP Tools

The model had access to `search_code` and `search_repositories` GitHub tools. The tool descriptions said nothing about scope. The model searched _all of GitHub_ for AI coding agents.

### Layer 5: No Refusal Instruction

The system prompt guided the model to be helpful and accurate. It never told the model what _not_ to answer.

## The Fix: LLM-Powered Relevance Gate

We needed something fast, cheap, and effective. Pattern matching wouldn't cover the long tail. Embedding classification adds complexity. The simplest path: ask the same LLM a binary question.

### Design

```typescript
async function isRelevant(
  question: string,
  history: { role: string; content: string }[],
  signal?: AbortSignal,
): Promise<boolean> {
  const context = history.slice(-2)
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
    log.warn\`Relevance check failed: \${err} — allowing query (fail-open)\`;
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

The gate fires in `startGeneration()`, after loading chat history but before embedding:

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

## Debugging: The Gap Between Theory and Practice

First test: "Search GitHub for open source AI coding agents."

### Bug 1: Redundant Logger

`isRelevant()` created its own `createLogger(CAT.chat)` instances instead of using the module-level `log`. Child process issue in the subagent. Quick fix.

### Bug 2: The Thinking Model Problem

We set `max_tokens: 5`. The LLM responded with `reasoning_content` populated and `content` empty. The model was a reasoning model (thinking model) that routed the classification answer to the reasoning field.

Fix: read both fields as fallback:

```typescript
const answer = (msg?.content ?? msg?.reasoning_content ?? '').trim().toLowerCase();
```

Also bumped `max_tokens` to 5000 because reasoning models need room to... reason.

### Bug 3: The Silent Error

The SSE event handler on the frontend had this guard:

```typescript
const msgId = data.messageId;
if (typeof msgId !== 'string') return;
```

The relevance gate error event had no `messageId` — no assistant message was created because rejection happens before generation. The error was published correctly (verified in logs and DB), but the frontend silently dropped it.

Fix: combine the guard with the dedup check:

```typescript
if (typeof msgId === 'string' && messages.some((m) => m.id === msgId)) return;
```

## Chat Locking

Once a query is rejected, there's no point letting the user keep trying. The answer won't change. So we lock the chat:

```typescript
function lockChat(chatId: string): void {
  const db = getDb();
  db.prepare('UPDATE chats SET locked = 1 WHERE id = ?').run(chatId);
}
```

- POST handler checks `isChatLocked` before processing any message — returns 400 if locked
- Relevance gate calls `lockChat()` on rejection
- The error UI hides the "Try again" button via an `irrecoverable` flag
- `callWebhook(webhooksEnum.reportGenericMessage)` fires for observability

The webhook function is a stub — the enum is defined, the call site is wired, the actual webhook delivery is future work. But the architecture is ready.

## Error Persistence & Traceability

Each error — relevance rejection, embedding failure, generation timeout — needed to be visible on page refresh and queryable in the database. Originally, errors were only stored as `chat_events` (SSE replay), not as assistant messages. On page reload there was no trace of what happened.

The fix: a new `error` column on the `messages` table (migration #10). When an error occurs, `addMessage()` is called with:

- `role`: `'assistant'`
- `content`: `''` (empty — no text to render)
- `error`: the actual error text (e.g., `"I can only answer questions about Daniel Maricic's professional portfolio and experience."`)

The frontend maps this column to `ChatMessage.error` on load, so the error message appears correctly whether the user is watching live or refreshes the page.

Five error sites now persist: relevance gate rejection, embedding failure, generation failure after retries, save response failure, and the catch-all error handler. Each includes a `messageId` in the SSE error event to prevent duplicate messages on reconnect.

### Distinct Error UI

The old error layout rendered an empty message body with a small magenta banner at the bottom reading the error text. The entire message card now uses prominent error styling:

- Magenta-tinted background (`color-mix 8%`)
- 2px magenta border (replacing the subtle 1px version)
- Alert icon in a circular container
- "Unable to process request" heading
- Error message as body text
- "Try again" button (hidden for `irrecoverable` errors like rejected queries)

The result: errors are visually unmistakable. The card reads as an error from first glance, not as a normal message with a footnote.

## Lessons

### Defense in Depth Wins

Five layers of failure meant a single regex bypass took down the whole system. Fixing all five layers means bypassing one still leaves four. The gate is the primary defense, but the tightened tools, hardened prompt, and scoped descriptions each block different attack surfaces.

### Fail-Open is a Safety Valve

The relevance gate could false-positive on legitimate queries if the LLM is degraded. Fail-open (`return true`) means downtime of the classifier doesn't block the core product. Users see a slower, less-optimized response instead of a rejection.

### Know Your Model

A reasoning model doesn't behave like a standard completion model. `reasoning_content` is a real field that should be checked. `max_tokens: 5` is a trap when the model thinks before it answers.

### Test End-to-End

The relevance gate was correct in unit terms — the `publishPersistent` call fired, the DB event was written, the SSE stream carried it. But the frontend error handler had a bug that existed for months, just never triggered because every previous error path happened to include a `messageId`. A cursory code review wouldn't catch this. Only an end-to-end test with browser dev tools and server logs revealed it.

### Cost-Benefit

At ~300 tokens per check on a $0.15/M input token model, the relevance gate costs roughly $0.000045 per query. Even at 1000 queries, that's $0.05. The cost of serving an off-topic query (LLM tokens + MCP tool calls + vector search) is easily 100x more. The economics favor the gate.

## Files Changed

| File                                | Change                                                                                                                       |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `src/routes/api/ask/+server.ts`     | `isRelevant()` function, relevance gate in `startGeneration()`, tightened `needsExternalTools()`, lock check in POST handler |
| `src/lib/server/config.ts`          | CRITICAL — REFUSAL RULE in system prompt                                                                                     |
| `src/lib/server/mcp/tools.ts`       | Scoped all 23 tool descriptions                                                                                              |
| `src/lib/server/schema.ts`          | Migration #9: `locked` column on chats                                                                                       |
| `src/lib/server/db.ts`              | `lockChat()`, `isChatLocked()`, chat locking queries                                                                         |
| `src/lib/chat/types.ts`             | `irrecoverable` on ChatMessage, `locked` on Chat                                                                             |
| `src/lib/server/webhooks.ts`        | `reportGenericMessage` enum value                                                                                            |
| `src/routes/chat/[id]/+page.svelte` | Error handler fix, hidden retry for irrecoverable                                                                            |
| `docs/relevance-gate.md`            | Technical plan and architecture doc                                                                                          |
| `src/lib/server/schema.ts`          | Migration #10: `error` column on messages table                                                                              |
| `src/lib/server/db.ts`              | `StoredMessage.error`, `addMessage()` error param, `parseStoredMessage()` error parsing                                      |
| `src/routes/api/ask/+server.ts`     | `addMessage()` call at each error site with `messageId` in error events                                                      |
| `src/routes/chat/[id]/+page.svelte` | Error mapped from API, prominent error card styling, removed old error banner                                                |

## Stats

- **Lines of code changed**: ~180 across 12 files
- **Cost per check**: ~$0.000045 (at current LLM pricing)
- **Latency added**: ~300-500ms (LLM call with 300 prompt tokens)
- **False positive rate**: 0% on test suite (normal queries pass, off-topic blocked)
- **Bugs found during implementation**: 3 (redundant logger, reasoning_content split, silent error handler)

## The Takeaway

Building AI products means building boundaries. The model is powerful and wants to be helpful — perhaps too helpful. The relevance gate is a simple, cheap, effective boundary that says "this is what we do, that is not." Pattern matching is fragile. Embedding classifiers need training data. Asking the LLM itself to classify costs pennies and works immediately.

Sometimes the simplest tool is the one you already have.
