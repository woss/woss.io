# FE-01: Extract SSE handler into composable store

**Source:** C2 (Critical), C3 (Critical), m5 (Minor)

## Related issues

| Issue | What                                                  | Why                                                              |
| ----- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| C2    | ~240-line `$effect()` block in `+page.svelte:581-824` | Untestable, unreusable, 9 event listeners, direct state mutation |
| C3    | `seenErrorMsgIds` Set grows without bound             | Memory leak — never cleared on chat change or destroy            |
| m5    | SSE timeout not reset in `onerror`                    | Spurious timeout fires after EventSource auto-reconnect          |

## Problem

The SSE streaming logic lives entirely inside a Svelte 5 `$effect()` block in the page component. It:

- Registers 9 event listeners
- Manages a 120s timeout
- Mutates `messages` state directly from callbacks
- Has a `seenErrorMsgIds` Set declared at module scope (never cleaned up)
- Doesn't reset the timeout on `onerror`

## Solution

Extract into `src/lib/stores/chat-sse.ts` as a reusable store/class:

```ts
// Usage in +page.svelte:
const sse = createSSEStore();
sse.connect(chatId, userId, userAgentId);

// Reactive state:
$derived(sse.messages);
$derived(sse.status); // 'connecting' | 'streaming' | 'idle' | 'error'
$derived(sse.error);
```

### Responsibilities

1. EventSource connection lifecycle (connect, disconnect, reconnect)
2. Event parsing and dispatch (token, done, tool_call, error, status, contact_intent)
3. Message accumulation and state management
4. 120s timeout with proper reset on every event + onerror
5. `seenErrorMsgIds` — bounded Set with eviction (5min TTL or per-chat scoping)
6. Cleanup on chat change or component destroy

### Fixes included

- `seenErrorMsgIds`: Convert to `Map<string, number>` with 5-minute TTL eviction, clear on chat change
- SSE timeout: Call `resetSseTimeout()` inside `onerror` handler
- No direct prop mutation — store produces new state immutably

## Files affected

- `src/lib/stores/chat-sse.ts` — New file
- `src/routes/chat/[id]/+page.svelte` — Replace ~240-line `$effect()` with `createSSEStore()` usage

## Acceptance criteria

- [ ] SSE store is a standalone module, no `+page.svelte` references
- [ ] Same streaming behavior: all event types handled identically
- [ ] `seenErrorMsgIds` bounded to 5-minute TTL, cleaned on chat change
- [ ] Timeout reset on `onerror`
- [ ] Store cleaned up on component destroy (EventSource closed)
- [ ] No memory leaks after chat navigation
