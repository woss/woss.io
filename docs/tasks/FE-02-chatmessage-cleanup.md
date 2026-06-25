# FE-02: ChatMessage component cleanup

**Source:** m7 (Minor), m8 (Minor), M6 from original review

## Related issues

| Issue         | What                                    | Fix                                                  |
| ------------- | --------------------------------------- | ---------------------------------------------------- |
| M6 (original) | ChatMessage.svelte was 968 lines        | Already fixed — ActionBar extracted in previous pass |
| m7            | `handleReaction` mutates prop directly  | Use callback or store instead of prop mutation       |
| m8            | `formatDuration` renders "0ms" for zero | Show "—" for 0 or undefined durations                |

## Tasks

### 1. Fix reaction prop mutation

Current (bad):

```ts
message.reaction = { type: 'up', reason: '' };
message.reaction = null;
```

Fix: Emit an event/callback and let the parent handle the fetch + state update. Or use a store.

### 2. Fix `formatDuration` zero display

```ts
function formatDuration(ms: number): string {
  if (ms <= 0) return '—'; // handle 0 and negative
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
```

### 3. Extract remaining subcomponents (if any still inline)

Check if `MessageSources`, `ToolCallList`, `MessageReactions` are still inline in `ChatMessage.svelte`. If so, extract each to its own component.

## Files affected

- `src/lib/components/ChatMessage.svelte`
- Possibly new component files if extraction needed

## Acceptance criteria

- [ ] `handleReaction` doesn't mutate `message` prop directly
- [ ] `formatDuration(0)` returns `'—'`
- [ ] No remaining inline concerns that would justify their own component
- [ ] Tests pass (`pnpm vitest run`)
- [ ] Visual behavior unchanged
