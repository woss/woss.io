# BE-05: DB layer cleanup — split, deduplicate, async, fix patterns

**Source:** m1 (Minor), M4 (Major), M3 (Major), M6 (Major), m2 (Minor)

## Related issues from review

| Issue | What                                  | Why                                                                          |
| ----- | ------------------------------------- | ---------------------------------------------------------------------------- |
| m1    | `db.ts` (910 lines) monolithic        | Mixes chat, content, reactions, leads, vector, connection lifecycle          |
| M4    | `sanitizeText` duplicated             | Identical code in `openai-provider.ts:145-153` and `chat-helpers.ts:240-248` |
| M3    | `query-classifier.ts` `readFileSync`  | Blocks event loop on first request                                           |
| M6    | `startGeneration` recursive self-call | Fragile — future param additions must remember the recursion                 |
| m2    | `tryRenameChat` on error paths        | Chat stays "New Chat" after failed generation                                |

## Tasks

### 1. Split `db.ts` by domain

```
src/lib/server/db/
├── index.ts          # Re-exports, connection lifecycle
├── chat.ts           # Chat CRUD, message CRUD
├── content.ts        # Posts, experience, pages
├── reactions.ts      # Reactions CRUD
├── vector.ts         # Vector index operations, cache
├── leads.ts          # Lead capture
```

### 2. Deduplicate `sanitizeText`

Extract to `src/lib/server/sanitize.ts`. Import from both `openai-provider.ts` and `chat-helpers.ts`. Delete the duplicate.

### 3. Make centroid loading async

Replace `readFileSync` in `query-classifier.ts` with lazy async `readFile` pattern. Cache on first successful load.

### 4. Fix recursive `startGeneration`

Extract core logic into `doStartGeneration()`. Public `startGeneration` handles trace wrapping, delegates to `doStartGeneration`.

### 5. Add `tryRenameChat` on error paths

Specifically in embedding failure catch block and LLM error path in `saveAndEmitResult`.

## Acceptance criteria

- [ ] `db.ts` split into domain modules under `src/lib/server/db/`
- [ ] All imports updated across codebase
- [ ] `sanitizeText` lives in exactly one canonical location
- [ ] `query-classifier.ts` centroid loading is async
- [ ] `startGeneration` not recursive
- [ ] `tryRenameChat` called on all exit paths
- [ ] Tests pass (`pnpm vitest run`)
