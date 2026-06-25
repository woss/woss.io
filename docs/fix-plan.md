---
status: not-started
phase: 1
updated: 2026-06-09
---

# Fix Plan — Code Review Findings

## Goal

Resolve all code review findings from the staged and unstaged code changes in `generate.ts`, `openai-provider.ts`, `tools.ts`, `ask/+server.ts`, and related files.

## Context & Decisions

| Decision                                                   | Rationale                                                                               | Source                      |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------- |
| Eliminate duplicated `startGeneration` in `ask/+server.ts` | 616-line copy creates maintenance hazard; all callers already import from `generate.ts` | `ref:only-green-flyingfish` |
| Add `typeFilter` to `searchChunks` in `generate.ts`        | Missing param changes RAG behavior for blog/article queries                             | `ref:only-green-flyingfish` |
| Fix `maxOutputTokens` → `maxTokens` in synthesis round     | AI SDK silently ignores misspelled option, token limit not applied                      | `ref:only-green-flyingfish` |
| Extract shared helpers                                     | 5 helpers duplicated in `generate.ts` + `ask/+server.ts` with subtle divergence         | `ref:only-green-flyingfish` |
| Move `/summarize` rename before text override              | `tryRenameChat` runs after `text` overwrite → renames to prompt text                    | `ref:only-green-flyingfish` |
| Add double-link guard to legacy `ask/+server.ts`           | PR link conversion lacks already-linked check present in `generate.ts`                  | `ref:only-green-flyingfish` |
| Fix unhandled `.catch()` in `ask/+server.ts`               | Re-throws inside catch → unhandled promise rejection                                    | `ref:only-green-flyingfish` |
| Move MCP prompt fetch outside `if (maculaNeeded)`          | Prompts also needed for GitHub-only queries                                             | `ref:only-green-flyingfish` |
| Remove unused `tool-error` type or implement emission      | Type defined but never produced                                                         | `ref:only-green-flyingfish` |

## Phase 1: Extract shared logic [PENDING]

- [ ] **1.1 Extract shared helper module** — Move `sanitizeText`, `tryRenameChat`, `needsGithubTools`, `needsMaculaTools`, `isRelevant`, `generatePoliteResponse` into a shared file (e.g. `src/lib/server/classifier.ts` or existing `src/lib/query-classifier.ts`). Import from both `generate.ts` and `ask/+server.ts`. ← CURRENT
- [ ] 1.2 Reconcile any differences between the two copies during extraction
- [ ] 1.3 Verify type check passes (`bun x tsc --noEmit`)

## Phase 2: Fix `generate.ts` and `ask/+server.ts` duplication [PENDING]

- [ ] **2.1 Delete inline `startGeneration` from `ask/+server.ts:341-957`** — Replace with a call to the imported `startGeneration` from `$lib/server/generate`. Verify the route handler passes all required parameters (chatId, text, messages, model, etc.).
- [ ] 2.2 **Add `typeFilter` to `searchChunks`** in `generate.ts:~1044`. Derive typeFilter from text content: `/\b(blog|post|article|writing|tutorial|guide)\b/i.test(text) ? 'post' : 'experience'`.
- [ ] 2.3 **Fix `maxOutputTokens`** → `maxTokens` at `openai-provider.ts:399`
- [ ] 2.4 **Move `tryRenameChat` before `/summarize` text override** in `generate.ts:~1090`
- [ ] 2.5 **Add double-link guard** to PR link conversion in `ask/+server.ts:~765` (mirror the callback-based guard from `generate.ts:751-757`)
- [ ] 2.6 **Fix unhandled `.catch()`** in `ask/+server.ts:~758` — remove re-throw or convert to error logging
- [ ] 2.7 **Move MCP prompt fetch** (`getMcpPromptContent`) outside the `if (maculaNeeded)` block so it runs for GitHub-only queries too
- [ ] 2.8 **Remove or wire up `tool-error`** in `src/lib/server/llm/types.ts:~10`

## Phase 3: Fix synthesis round conversation continuity [PENDING]

- [ ] **3.1 Push round 1 assistant text + tool_call/tool_result into `currentMessages`** before synthesis round in `openai-provider.ts`. Currently only a flat user message with tool results is injected. The model needs proper `assistant → tool_call → tool_result` turns for context continuity.
  - Capture `roundText` (accumulated delta text) from round 1
  - Push `{ role: 'assistant', content: roundText }` to `currentMessages`
  - Collect tool_call entries from round 1's `onChunk` and push `{ role: 'assistant', content: '', tool_calls: [...] }`
  - Collect tool_result entries and push `{ role: 'tool', content: [...] }`
  - Remove/replace the flat user message approach

## Phase 4: Testing [PENDING]

- [ ] **4.1 Test "show me last 10 images from daniel's windsurf album"** — verify no refusal, tool calls execute, images display
- [ ] 4.2 Test RAG query that should hit `typeFilter` (e.g. "what blog posts about MCP")
- [ ] 4.3 Test GitHub-only query (e.g. "show my PRs") — verify MCP prompts load
- [ ] 4.4 Test `/summarize` chat rename — verify chat name is based on original user message, not override prompt
- [ ] 4.5 Test synthesis round — verify answer text is complete, not truncated to intro only

## Notes

- 2026-06-09: Created from code review `ref:only-green-flyingfish` (first review covering code files). Second review `ref:constant-amber-moose` covered doc-only files and is tracked separately.
- 2026-06-09: The `maxOutputTokens` → `maxTokens` fix was already part of the instrumentation commit but the reviewer flagged it independently. Verify it's already fixed before making changes.
