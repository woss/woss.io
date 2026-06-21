# BE-02: Decompose `generate.ts` into pipeline modules

**Source:** M2 (Major) — `src/lib/server/generate.ts` (1185 lines)

## Problem

`generate.ts` mixes 5 distinct concerns in one file, making it untestable, hard to reason about, and harder to maintain. Each concern has clean function boundaries — they just live in the same file.

Current structure:
| Function | Lines | Purpose |
|---|---|---|
| `classifyToolNeeds` | 68 | Determine if tools are needed |
| `handleEarlyGates` | 232 | Relevance check, polite response, embedding, cache |
| `streamWithRetry` | 238 | LLM streaming with retry logic |
| `saveAndEmitResult` | 147 | Persist results, SSE emit |
| `startGeneration` | 241 | Top-level orchestrator |

## Solution

Extract each function into its own module under `src/lib/server/pipeline/`:

```
src/lib/server/pipeline/
├── index.ts           # Re-exports
├── classify-tools.ts  # classifyToolNeeds
├── early-gates.ts     # handleEarlyGates
├── stream.ts          # streamWithRetry
├── save-result.ts     # saveAndEmitResult
└── orchestrator.ts    # startGeneration
```

## Files affected

- `src/lib/server/generate.ts` — Shrink to imports and orchestration
- `src/lib/server/pipeline/` — New directory with 5 modules + index

## Acceptance criteria

- [ ] Each function extracted to its own module with same signature
- [ ] `src/lib/server/generate.ts` imports from `pipeline/` and delegates
- [ ] No logic changes — pure structural decomposition
- [ ] All imports updated across codebase
- [ ] Tests pass (`pnpm vitest run`)
