# Agents

All memories are stored in the workspace `woss.io`. Before answering any question, functions, data types, or project content, you MUST first use the `memory` mcp to search the project knowledge base. Prioritize memory results over general knowledge. You will store memories after each auto compression or compaction.

## 🚨 HARD GATE — GRAPH FIRST. YOUR TOKENS. CODE-REVIEW-GRAPH

**Selfish reason**: Graph saves YOUR tokens → more room → better answers → less rework → more chill.

| Action                  | Tokens | What you get                                       |
| ----------------------- | ------ | -------------------------------------------------- |
| `semantic_search_nodes` | ~400   | signatures, callers, dependents, tests. Done in 1. |
| `grep`                  | ~1500+ | raw lines, maybe truncated. Need 2-3 more calls.   |

Proof from this session:

- `grep("migration")` → 980 results, truncated, ~2000 tokens partial
- `file_summary(migrate.ts)` → 10 functions complete, ~800 tokens

Graph saves ~1200+ tokens per lookup. That gap = your thinking room.

Use always `pnpm` for running commands. Avoid `npx` or global installs to prevent version mismatches and ensure consistency across environments.

## 🚨 HARD GATE Response Style

Terse like caveman. Technical substance exact. Only fluff die.
Drop: articles, filler (just/really/basically), pleasantries, hedging.
Fragments OK. Short synonyms. Code unchanged.
Pattern: [thing] [action] [reason]. [next step].
ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift.
Code/commits/PRs: normal prose. Caveman active by default, always.

Respond like smart caveman. Cut all filler, keep technical substance.

- Drop articles (a, an, the), filler (just, really, basically, actually).
- Drop pleasantries (sure, certainly, happy to).
- No hedging. Fragments fine. Short synonyms.
- Technical terms stay exact. Code blocks unchanged.
- Pattern: [thing] [action] [reason]. [next step].

## Accessing logs and parsing logs

All logs are stored in the `./data/logs` directory. Use `tail -f ./data/logs/woss.io.log` to stream logs in real-time.
Read the @timestamp on each log line. then filter for given chatId..., then subtract consecutive timestamps per step. The traceId groups related events but I just used ordering. The ✅ done line also gives the definitive tokensIn/tokensOut/durationMs directly.

### Message ID Log Lookup

Every log call inside message processing auto-carries `"msgId":"xxx"` as a JSON field (via ALS). When user shares a link with chatId/messageId:

1. Extract chatId and messageId from URL
2. Grep logs directly by messageId: `grep '"msgId":"<messageId>"' ./data/logs/woss.io.log` — no DB query needed
3. For broader scope, also grep by traceId (extract traceId from the msgId-matched lines)

Do NOT query the DB for traceId as a first step — msgId in logs is sufficient. DB query only if logs don't contain the message (e.g. pre-msgId messages or log rotation).

### Mandatory Protocol

Before EVERY grep/glob/read:

1. PAUSE. Ask: "Graph checked?"
2. No → `semantic_search_nodes` or `query_graph` first
3. Graph returned something → use it. Done.
4. Graph empty → THEN grep/glob/read fallback

Pattern you MUST follow:

Correct:
semantic_search_nodes("SelectBuilder") → found → use results → done
→ empty → grep fallback

Wrong (you did this):
grep first. Graph never called. Wasted tokens. Missed callers/dependents.

## MCP Tools: code-review-graph

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool                        | Use when                                               |
| --------------------------- | ------------------------------------------------------ |
| `detect_changes`            | Reviewing code changes — gives risk-scored analysis    |
| `get_review_context`        | Need source snippets for review — token-efficient      |
| `get_impact_radius`         | Understanding blast radius of a change                 |
| `get_affected_flows`        | Finding which execution paths are impacted             |
| `query_graph`               | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes`     | Finding functions/classes by name or keyword           |
| `get_architecture_overview` | Understanding high-level codebase structure            |
| `refactor_tool`             | Planning renames, finding dead code                    |

### Semantic Search (Embeddings)

`code-review-graph_embed_graph_tool` enables vector-based semantic search. Without it, `semantic_search_nodes` falls back to keyword matching only.

**Enable once after index rebuild**: `code-review-graph_embed_graph_tool(provider="local")` — embeds all nodes via all-MiniLM-L6-v2.

**After embedding**: `semantic_search_nodes("concept")` returns results by meaning, not just name match. Finds related code even when symbol names differ.

**When to re-embed**:

- After full graph rebuild — old embeddings invalidated
- Provider change (local ↔ openai ↔ google)

**How to read results**: Results sorted by similarity score (0-1). Higher = more semantically related. Skim scores, scan signatures, open relevant files.

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.

## Version Control

Use `but` CLI for all write operations. Read-only git commands (`git log`, `git diff`, `git show`, `git blame`, `git reflog`) are acceptable per the official skill.

Do NOT use the `but_gitbutler_update_branches` MCP tool — use `but commit --changes` CLI instead.

Load the `but` skill for complete instructions.

**Also prohibited:**

- Bypassing git hooks (`--no-verify`, `-n`) — commits must pass pre-commit checks
- Using `/tmp` — use local `./tmp`. Clean up after.
- Modifying docker-compose.yml or .env
- Starting surrealdb without checking `docker ps` first. If running, connect. If not, alert user and stop.
- Deleting or resetting the database (data/vectors.db, data/woss.db) without explicit user approval. ASK FIRST.

## Code Philosophy - MANDATORY

Follow the Code Philosophy outlined in `.opencode/tools/philosophy.md` for all code contributions. This ensures consistency, maintainability, and quality across the codebase.

## Skill Loading

Before implementing any code, agents MUST load the relevant skills.

### Quick Decision Guide

| Use Plan Protocol + Backlog           | Use Built-in Todos                 |
| ------------------------------------- | ---------------------------------- |
| Requires research before implementing | Implementation path is clear       |
| Multiple files or packages affected   | Single file change                 |
| Complex dependencies between steps    | Independent, straightforward steps |
| May need to track across sessions     | Can complete in current session    |
| Architectural or design decisions     | Straightforward feature or fix     |

**Rule of thumb**: If you find yourself thinking "let me plan this out" or "I should research this first," create a Backlog task and use Plan Protocol. If it's a straightforward change you can complete immediately, use built-in todos.

---

## Subagent Management

When working with subagents, use the Session tool (`session` function) to delegate tasks and manage agent collaboration. Refer to the subagent-management skill for detailed guidelines on:

- When and how to delegate tasks to subagents
- Agent handoff patterns and best practices
- Managing multi-agent workflows effectively

## Prompt Convention: "Plan This"

---

## Playwright Screenshots

When using `playwright_browser_take_screenshot`, always pass `filename` with path under `.playwright-mcp/` to avoid cluttering project root. Use `Date.now()` for uniqueness. Example: `.playwright-mcp/screenshot-{Date.now()}.png`.

Also verify that `.playwright-mcp/` is listed in `.gitignore` (it already is).

## Mandatory Tech Stack

All agents MUST use these technologies. No exceptions.

1. **UI First: Svelte 5 runes/patterns (SV5UI)** — Build UI using Svelte 5 component patterns, `$state()`, `$derived()`, `$effect()`, `$props()`, snippets. Then customize appearance with Tailwind CSS v4. Do NOT start with raw HTML/CSS.
2. **SvelteKit 2** — Use file-based routing, layouts, load functions, form actions, server-side rendering. Must use `+page.svelte`, `+layout.svelte`, `+page.server.ts` etc conventions.
3. **Vite / Vitest** — Build tool = Vite. Testing = Vitest. Do NOT use webpack, rollup directly, jest, mocha.
4. **pnpm** — Package manager = pnpm. Do NOT use npm, yarn, npx.
5. **Node.js** — Runtime = Node.js.

Load the `sveltekit-svelte5-tailwind-skill` skill before implementing any UI work.
