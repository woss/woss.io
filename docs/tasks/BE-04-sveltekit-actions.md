# BE-04: Migrate API routes to SvelteKit Actions

**Source:** M5 (Major) + user direction — `src/routes/api/*`

## Problem

Current API endpoints are vanilla REST handlers. No CSRF protection, no origin validation, no built-in form handling. A malicious site could POST on behalf of a user. SvelteKit Actions provide built-in CSRF protection, proper status codes, shared validation, and form integration.

Target endpoints:

- `POST /api/chat` — Create new chat
- `POST /api/ask` — Send message (main generation endpoint)
- `POST /api/messages/[messageId]/reaction` — Toggle reaction
- `DELETE /api/messages/[messageId]` — Delete message
- `POST /api/messages/[messageId]/regenerate` — Regenerate response

## Solution

Convert each `+server.ts` POST handler to a `+page.server.ts` (or `+server.ts` using `export const actions = { ... }`) form action.

For endpoints that return JSON (not forms), use progressive enhancement:

1. Define actions with `zod` validation for input
2. Return `{ success: true, data }` or `{ error: string, status: number }`
3. Client calls `fetch` with `method: 'POST'` and `Content-Type: 'application/x-www-form-urlencoded'` or `multipart/form-data`
4. SvelteKit's built-in CSRF check applies automatically

## Files affected

- `src/routes/api/chat/+server.ts`
- `src/routes/api/ask/+server.ts`
- `src/routes/api/messages/[messageId]/reaction/+server.ts`
- `src/routes/api/messages/[messageId]/+server.ts`
- Client-side `.svelte` files that call these endpoints (update fetch calls)

## Acceptance criteria

- [ ] All POST endpoints migrated to SvelteKit Actions or form actions
- [ ] CSRF protection active (SvelteKit default: `csrf.checkOrigin: true`)
- [ ] `zod` validation on all action inputs
- [ ] Client-side fetch calls updated to match new action format
- [ ] Tests pass (`pnpm vitest run`)
