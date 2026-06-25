# Chat Mobile Usability — iPhone 13

## Related files

- `src/lib/chat/slash-commands.ts` — slash command definitions
- `src/routes/chat/[id]/+page.svelte` — main chat page
- `src/routes/+layout.svelte` — global layout + navbar
- `src/lib/components/ChatSidebar.svelte` — desktop + mobile sidebar
- `src/lib/components/ChatInput.svelte` — chat input with slash menu
- `src/lib/components/HomeChatInput.svelte` — home page chat input
- `src/lib/components/ActionBar.svelte` — message action bar (sources toggle)
- `src/lib/stores/mobile-sidebar.ts` — mobile sidebar store
- `src/lib/stores/chat-scroll.ts` — scroll detection store

---

| #   | Action                                | File                                      | Change                                                                                                                                                                        | Completed |
| --- | ------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 1   | Fix slash menu overflow               | `src/lib/components/ChatInput.svelte`     | Add `max-h-[40vh] overflow-y-auto` to slash drop-up menu (`div.absolute.bottom-full`) so it doesn't extend beyond 40% viewport height, leaving last message ActionBar visible | [x]       |
| 2   | Verify ActionBar reachable            | —                                         | Verify the sources/tools button in ActionBar is reachable when slash menu is open                                                                                             | [x]       |
| 3   | Fix sources sidebar touch tap         | `src/routes/chat/[id]/+page.svelte`       | Verify mobile sources overlay (`.xl\:hidden.fixed.inset-0.z-50`) renders properly on touch tap                                                                                | [x]       |
| 4   | Fix z-index layering                  | —                                         | Check z-index: sidebar overlay uses `z-50`, navbar uses `z-200`                                                                                                               | [x]       |
| 5   | Hide navbar on chat pages             | `src/routes/+layout.svelte`               | Hide `<nav>` entirely when `isChatPage` is true (remove from DOM or `display: none`)                                                                                          | [x]       |
| 6   | Remove chatScrolledDown + navHidden   | `src/routes/+layout.svelte`               | Remove `chatScrolledDown` subscription + `navHidden` state from layout (no longer needed after navbar removal on chat pages)                                                  | [x]       |
| 7   | Zero nav padding on chat pages        | `src/routes/+layout.svelte`               | Set `<main>` `padding-top` to 0 on chat pages; keep `var(--nav-height)` for other pages                                                                                       | [x]       |
| 8   | Remove navOffset from chat page       | `src/routes/chat/[id]/+page.svelte`       | Remove `navOffset` derived state; use `100dvh` always                                                                                                                         | [x]       |
| 9   | Remove scroll-detection $effect       | `src/routes/chat/[id]/+page.svelte`       | Remove scroll-detection `$effect` for `chatScrolledDown` (lines 531–546)                                                                                                      | [x]       |
| 10  | Simplify mobile sidebar overlay       | `src/lib/components/ChatSidebar.svelte`   | Remove `navOffset` from `top`/`height` calculations on mobile sidebar overlay                                                                                                 | [x]       |
| 11  | Simplify right sidebar mobile overlay | `src/lib/components/ChatSidebar.svelte`   | Same navOffset cleanup on right sidebar mobile overlay                                                                                                                        | [x]       |
| 12  | Add `/show_posts` command             | `src/lib/chat/slash-commands.ts`          | Add `{ name: 'show_posts', triggers: ['/show posts'], description: 'Show posts page' }`                                                                                       | [x]       |
| 13  | Add `/show_experience` command        | `src/lib/chat/slash-commands.ts`          | Add `{ name: 'show_experience', triggers: ['/show experience'], description: 'Show experience page' }`                                                                        | [x]       |
| 14  | Add `/about` command                  | `src/lib/chat/slash-commands.ts`          | Add `{ name: 'about', triggers: ['/about'], description: 'About me' }`                                                                                                        | [x]       |
| 15  | Add `/show_chats` command             | `src/lib/chat/slash-commands.ts`          | Add `{ name: 'show_chats', triggers: ['/show chats'], description: 'Open chat sidebar' }`                                                                                     | [x]       |
| 16  | Handle slash commands in chat page    | `src/routes/chat/[id]/+page.svelte`       | Add cases in `handleSlashCommand()`: navigate to routes via `goto()` or open mobile sidebar                                                                                   | [x]       |
| 17  | Handle slash commands in home input   | `src/lib/components/HomeChatInput.svelte` | Add same command handling there, or ensure they navigate properly                                                                                                             | [x]       |
| 18  | Push services to sidebar bottom       | `src/lib/components/ChatSidebar.svelte`   | Add spacer div with `mt-auto` between chat list and MCP services section so services + slash commands are pushed to bottom                                                    | [x]       |
| 19  | Wrap slash commands in accordion      | `src/lib/components/ChatSidebar.svelte`   | Wrap slash commands list in `sv5ui/Accordion` component (already imported); collapsible, default collapsed, each command shows trigger + description inside                   | [x]       |
| 20  | Full-width sidebar on mobile          | `src/lib/components/ChatSidebar.svelte`   | Line 194: change `w-65` to `w-full` on mobile sidebar `<aside>`                                                                                                               | [x]       |
| 21  | Close sidebar on chat switch          | `src/routes/chat/[id]/+page.svelte`       | Add `$effect` that resets `showMobile = false` when `chatId` changes; propagates to store via existing effect                                                                 | [x]       |
