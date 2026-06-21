# BE-01: Type-safe `addMessage` with parameter object pattern

**Source:** C1 (Critical) — `src/lib/server/db.ts:482-527`

## Problem

`addMessage` takes 16 positional parameters. Every call site passes `undefined` for unused params. A transposed argument silently inserts data into wrong columns — SQLite coerces everything, no type error.

Current usage pattern (11 call sites in `generate.ts` and `+server.ts`):

```ts
addMessage(
  userId,
  'assistant',
  '',
  undefined,
  undefined,
  chatId,
  0,
  0,
  0,
  0,
  0,
  undefined,
  true,
  'text',
  undefined,
  userAgentId,
);
```

## Solution

Two options, implement both:

### Option A — Type-safe parameter object

Replace positional params with a single `AddMessageParams` interface (matching the existing `SaveResultParams` pattern at `generate.ts:747`).

### Option B — Usecase-specific wrapper functions

Create thin wrappers for each call pattern:

- `addAssistantMessage(chatId, userId, content, ...)`
- `addErrorMessage(chatId, userId, error, ...)`
- `addUserMessage(chatId, userId, content, ...)`

## Files affected

- `src/lib/server/db.ts` — Rewrite `addMessage` signature and implementation
- `src/lib/server/generate.ts` — Update ~8 call sites
- `src/routes/api/ask/+server.ts` — Update ~3 call sites
- `src/lib/server/chat-helpers.ts` — Check for any call sites

## Acceptance criteria

- [ ] `addMessage` accepts a named parameter object (or separate usecase functions exist)
- [ ] No call site passes positional `undefined` as padding
- [ ] All 11 call sites updated
- [ ] Existing behavior preserved (soft-delete, timestamps, all columns)
- [ ] Tests pass (`pnpm vitest run`)
