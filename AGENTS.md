# Agents

Memories in workspace `woss.io`. Search `memory` mcp before answering project questions. Store memories after compression/compaction.

## Commands

`pnpm` only. No `npx`, no globals.

## Logs

`./data/logs`. Stream: `tail -f ./data/logs/woss.io.log`. TraceId groups events. ✅ done = tokensIn/tokensOut/durationMs.

Log calls carry `msgId`. Grep: `grep '"msgId":"<id>"' ./data/logs/woss.io.log`. No DB query needed. traceId from matched lines for broader scope.

## Version Control

`but` CLI for writes. Read-only git OK. Load `but` skill.

No `--no-verify`, no `/tmp`, no docker-compose/.env edits, no surrealdb start without `docker ps`, no DB delete without approval.

## Code

Follow `.opencode/tools/philosophy.md`.

## Skills

Load before implementing. Backlog/plan for research-heavy work. Todos for simple changes. Load `sveltekit-svelte5-tailwind-skill` before UI.

## Playwright

`filename` under `.playwright-mcp/` with `Date.now()`.

## Stack

Svelte 5 runes + Tailwind v4. SvelteKit 2. Vite/Vitest. pnpm. Node.js.
