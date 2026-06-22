# Sidebar Toggle Fixes + Mobile Navbar + Chat Input

## Problems

### 1. Desktop sidebar toggle broken

The chevron arrow button to collapse the sidebar stopped rendering. Root cause: `ChatSidebar.svelte` wraps the toggle in sv5ui's `Collapsible` component, which relies on bits-ui's `Collapsible.Trigger` passing `{...props}` onto a Button. The Button component intercepts `onclick` and wraps it in its own `handleClick`, breaking the bits-ui trigger binding.

### 2. Mobile chat detail page has no sidebar trigger

`src/routes/chat/[id]/+page.svelte` has no hamburger/menu button to open the mobile sidebar drawer. The `showMobile` state exists and is bound to `ChatSidebar`, but the only way to trigger it is via the `/show_chats` slash command. `src/routes/chat/+page.svelte` already has a working hamburger button (line 78-83).

### 3. Mobile navbar hamburger is a circle

`src/routes/+layout.svelte:140` uses `variant="outline"` + `square`, which renders a bordered circle button. Should be `variant="ghost"` for a clean icon-only look.

### 4. Mobile navbar hamburger X doesn't show when drawer opens

The hamburger button at line 141 switches icon between `lucide:menu` and `lucide:x` based on `mobileMenuOpen` state. The Drawer overlay (line 155: `overlay: true`) may cover the button when the drawer opens, hiding the X. Or the X icon may not be rendering properly in this context.

### 5. Chat input submit button is a circle

`src/lib/components/ChatInput.svelte:155` uses `variant="solid" color="primary" square size="md"` — the `square` + `size="md"` combo forces a fixed aspect ratio with `rounded-full`, rendering as a circle. Should be a proper square.

## Related files

- `src/lib/components/ChatSidebar.svelte` — desktop sidebar + mobile drawer
- `src/routes/chat/[id]/+page.svelte` — chat detail page
- `src/routes/+layout.svelte` — global layout + navbar
- `src/lib/components/ChatInput.svelte` — chat input with submit button

---

| #   | Action                              | File                                    | Change                                                                                                                                                                                                                                                                                                                                                                    | Completed |
| --- | ----------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | Remove Collapsible dependency       | `src/lib/components/ChatSidebar.svelte` | Remove `Collapsible` from sv5ui import (line 7). Remove `<Collapsible>` wrapper (lines 66-166) and its `trigger`/`content` snippets. Replace with a plain `<div class="flex flex-col flex-1 overflow-hidden">`. Move trigger header content into a direct child div. The Button uses `onclick={() => open = !open}` directly instead of `{...props}`.                     |           |
| 2   | Conditional content rendering       | `src/lib/components/ChatSidebar.svelte` | Wrap the collapsible content (new chat button, chat list, MCP status, slash commands) in `{#if open}` inside the desktop `<aside>`. Footer stays always visible.                                                                                                                                                                                                          |           |
| 3   | Add mobile hamburger to chat detail | `src/routes/chat/[id]/+page.svelte`     | Add mobile header bar with hamburger button inside the main chat area div (above the messages area, around line 901). Hidden on `md:` and above (`class="md:hidden flex items-center justify-between px-4 py-3 border-b border-white/8 bg-surface shrink-0"`). Button variant `ghost square size="sm"` with `icon="lucide:menu"` and `onclick={() => showMobile = true}`. |           |
| 4   | Fix hamburger circle                | `src/routes/+layout.svelte`             | Change line 140 from `variant="outline"` to `variant="ghost"`.                                                                                                                                                                                                                                                                                                            |           |
| 5   | Fix missing X on mobile drawer      | `src/routes/+layout.svelte`             | Investigate why `lucide:x` doesn't render. Likely the Drawer overlay covers the button. Consider removing the overlay (`overlay={false}` at line 155) or moving the X button outside the Drawer so it overlays on top.                                                                                                                                                    |           |
| 6   | Fix chat submit button shape        | `src/lib/components/ChatInput.svelte`   | Change line 155: replace `square size="md"` with explicit `size="md"` + Tailwind class to make it a square (e.g. `rounded-lg` or `rounded-md`) instead of `rounded-full` from the `square` variant.                                                                                                                                                                       |           |
| 7   | Verify                              | —                                       | Open dev server, check desktop sidebar collapses via chevron button. Check mobile viewport shows hamburger on chat detail page, opens drawer. Check mobile navbar hamburger is ghost (no border circle). Check X icon shows when mobile drawer opens. Check chat submit button is square, not circle.                                                                     |           |
