# BE-06: Streaming and retry hardening

**Source:** M7 (Major), m4 (Minor), Rec 9 from review

## Related issues

| Issue | What                                                 | Why                                                   |
| ----- | ---------------------------------------------------- | ----------------------------------------------------- |
| M7    | Tool call DB inserts in streaming hot path           | Sync `db.run()` stalls LLM stream on slow writes      |
| m4    | `runRound` recursion in `openai-provider.ts:305-509` | Complex recursive async closure, hard to reason about |
| Rec 9 | `streamWithRetry` max attempts = 10                  | Excessive — 10 retries with full token cost each time |

## Tasks

### 1. Defer tool call DB writes from streaming hot path

- Replace synchronous `db.prepare(...).run(...)` calls with queued writes
- Use a dedicated SQLite connection for writes (separate from the stream's connection)
- Or use a write queue that flushes asynchronously

### 2. Refactor `runRound` recursion

- Convert recursive `async function runRound()` to an iterative loop with stack
- Keep the same abort/round-limit logic, just flatten the control flow
- Test that tool call multi-round still works (the `MAX_ROUNDS` boundary)

### 3. Reduce `streamWithRetry` max attempts

- Change from 10 to 4 max attempts
- Add exponential backoff: 1s → 2s → 4s → 8s between retries
- Keep the tools-disabled-after-attempt-3 logic (rename to attempt-2 or verify it still makes sense with 4 total)

## Acceptance criteria

- [ ] Tool call DB writes don't block the streaming callback
- [ ] `runRound` is iterative, not recursive
- [ ] Max retries reduced to 3-4 with exponential backoff
- [ ] No change to streaming behavior or output format
- [ ] Tests pass (`pnpm vitest run`)
