# BE-03: Error handling audit — replace silent catch blocks

**Source:** M1 (Major) — ~84 empty catch blocks across codebase

## Problem

Silent catch blocks make operational issues invisible. Network errors, DB write failures, MCP connection drops, SSE publish errors — all swallowed with `/* ignore */` or empty catches. In production, you're blind to failures.

## Solution

Audit every `try/catch` block in `src/lib/server/` and `src/routes/api/`:

1. Replace empty catches with at minimum `log.error(...)` (use existing `pino` logger via `$lib/server/logger`)
2. For MCP client methods: upgrade from `log.debug` to `log.warn` on error
3. For SSE publish errors: log and continue (don't crash the stream)
4. For DB cleanup errors (WAL/SHM — note: WAL is no longer used): still log the error

Excluded from this task:

- Client-side catch blocks in `.svelte` files (handled in FE tasks)
- Chats with intentional no-ops (document with comment)

## Files affected

- `src/lib/server/mcp/client.ts` — ~6 catch blocks
- `src/lib/server/db.ts` — ~4 catch blocks
- `src/lib/server/chat-events.ts` — ~2 catch blocks
- `src/lib/server/embed.ts` — ~2 catch blocks
- `src/lib/server/mcp/manager.ts` — ~3 catch blocks
- `src/routes/api/ask/+server.ts` — ~3 catch blocks
- Plus all others discovered during audit

## Acceptance criteria

- [ ] Every empty `catch` block in server code logs at `warn` or `error` level
- [ ] No functional behavior changes (catch still handles, just logs)
- [ ] Logger context includes: file name, operation attempted, error message
- [ ] Tests pass (`pnpm vitest run`)
