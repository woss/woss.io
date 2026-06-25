# Perplexity-Style Chat UI — Dark Mode

## Tasks

### 1. Design Tokens

- [ ] `src/app.css` — Rewrite color tokens (warm dark neutrals, teal-green `#00da8c`), remove gradient mesh + grain overlay
- [ ] `src/lib/utils/avatar.ts` — Create deterministic name→color utility (`hsl(hash(name) % 360, 45%, 55%)`)

### 2. Sidebar

- [ ] `src/lib/components/ChatSidebar.svelte` — Make collapsible (220px ↔ 60px) using Radix UI Collapsible
- [ ] Add logo, New Chat (⌘K), chat history list, user area at bottom
- [ ] Collapsed: icon-only mode, logo area hover-triggers expand
- [ ] Mobile: hidden, overlay drawer via hamburger

### 3. Front Page

- [ ] `src/routes/+page.svelte` — Apply new color tokens, remove gradient/grain background
- [ ] Wire chat history sidebar to hamburger toggle

### 4. Chat Page Layout

- [ ] `src/routes/chat/[id]/+page.svelte` — Restructure: left sidebar | 720px centered answer panel | right tool calls toggle
- [ ] Remove bubble wrapping from messages
- [ ] Render user query as h1 heading (no bubble)
- [ ] Render assistant answer as plain rich text (no card, no border-left accent)

### 5. Chat Input

- [ ] `src/lib/components/ChatInput.svelte` — Replace `<textarea>` with `<div contenteditable>`
- [ ] Floating card container: `rounded-2xl`, input bg `#1c1a17`, subtle shadow
- [ ] Button row: Search toggle | contenteditable textbox | Dictation (placeholder) | Submit/Stop
- [ ] Submit button state machine: `disabled arrow → enabled arrow → square Stop → disabled arrow`

### 6. Action Bar

- [ ] `src/lib/components/ActionBar.svelte` — New component: Share | Copy (with Copy message / Copy markdown dropdown) | Rewrite Session | [avatar stack] N | Helpful | Not helpful | Heart | More ⋮
- [ ] Sources pill: 3 stacked avatar circles + count "N", avatar from `avatar.ts`
- [ ] All buttons 32×32, pill rounded-2xl
- [ ] Include existing Copy message, Copy markdown, and all 3 reactions (Helpful, Not helpful, Heart)

### 7. Chat Message

- [ ] `src/lib/components/ChatMessage.svelte` — User as h1 (no bg/bubble), assistant as plain rich text
- [ ] Inline citations as buttons (source name 10px + "+N" badge)
- [ ] ActionBar component below each assistant message
- [ ] Keep existing reactions (Helpful/Not helpful/Heart) + Copy message + Copy markdown — integrate into ActionBar
- [ ] Sources become modal trigger, not inline accordion

### 8. Sources Modal

- [ ] `src/lib/components/SourcesModal.svelte` — New dialog component
- [ ] Header: "N sources" + Close ×
- [ ] Scrollable source cards: avatar + domain + title + description
- [ ] Click card → open external URL in new tab

### 9. Banners

- [ ] `src/lib/components/Banner.svelte` — New component: dismissible Pro banner, persistent status bar, forked session banner
- [ ] Pro banner disappears on first keystroke (via parent event)
- [ ] Forked banner at top of answer area

### 10. Tool Calls Panel

- [ ] `src/lib/components/ToolCallPanel.svelte` — Restyle with avatar circles per tool call
- [ ] Keep existing toggle right sidebar pattern

### 11. Follow-ups

- [ ] `src/lib/components/SuggestedQuestions.svelte` — Reposition below ActionBar, above banners/input
- [ ] Restyle: warm dark surface, teal-green accent border on pills

### 12. Top Nav

- [ ] `src/routes/+layout.svelte` — Verify top nav still works alongside new sidebar (keep as-is)

## Design System

### Accent

- **Teal-green**: `#00da8c`

### Color Palette (Warm Dark Neutrals)

```
Background base:   #181714 (warm near-black)
Surface:           #211f1c (warm dark surface)
Surface raised:    #2a2723 (hover/card surfaces)
Input bg:          #1c1a17 (slightly darker)
Text primary:      #e5e3de (warm off-white)
Text secondary:    rgba(229,227,222,0.65)
Accent:            #00da8c (teal-green)
Accent subtle:     rgba(0,218,140,0.12)
Dividers:          rgba(229,227,222,0.08)
```

No pure black, white, or gray — all warm undertones.

### Fonts

- Keep Inter + JetBrains Mono (swap later)

### Avatars

- Deterministic color from name: `hsl(hash(name) % 360, 45%, 55%)`
- Each source or tool call gets a unique colored circle
- Used in: sources pill (stacked avatars), sources modal, tool calls panel

---

## Layout Architecture

### Chat Pages Only (not front page / blog)

```
┌──────────┬─────────────────────────────┬──────────────┐
│ SIDEBAR  │  MAIN (720px centered)       │  TOOL CALLS  │
│ 220/60px │  [Forked from X] banner      │  (toggle)    │
│          │  h1 "Your query"             │              │
│ - Logo   │  Rich text answer            │  Avatar +    │
│ - New    │  Inline citations            │  tool name   │
│ - Chats  │  Action bar                  │  + status    │
│ - User   │  Follow-ups (5 chips)        │              │
│          │  [Pro banner]                │              │
│          │  [Status bar]                │              │
│          │  ┌─────────────────────┐     │              │
│          │  │  Chat Input (float) │     │              │
│          │  └─────────────────────┘     │              │
└──────────┴─────────────────────────────┴──────────────┘
```

### Top Nav

- Keep as-is on all pages (Ask | Experience | Posts | About)
- Sidebar handles navigation on chat pages

### Front Page (`+page.svelte`)

- Keep existing structure (HomeChatInput, featured posts)
- Chat history sidebar available via hamburger
- Style updates: new color tokens, remove gradient/grain

---

## Component Changes

### 1. Sidebar (`ChatSidebar.svelte`)

- Collapsible 220px ↔ 60px (Radix UI Collapsible)
- Components: logo, New Chat (⌘K), chat history list, user area at bottom
- Collapsed: icon-only nav items, logo area hover-triggers expand
- Mobile: hidden, overlay drawer via hamburger

### 2. Chat Page (`chat/[id]/+page.svelte`)

- Left sidebar | 720px centered answer | Right tool calls toggle sidebar
- No bubble wrapping on messages
- User query → h1 heading
- Assistant answer → plain rich text with inline citations

### 3. Chat Input (`ChatInput.svelte`)

- Replace `<textarea>` with `<div contenteditable>`
- Floating card container: `rounded-2xl`, input bg, subtle shadow
- Button row:
  - Search toggle (icon + "Search", pressed checkmark state)
  - Contenteditable textbox
  - Dictation (microphone icon, placeholder)
  - Submit/Stop button
- **Button state machine**:
  ```
  disabled arrow → enabled arrow → square Stop → disabled arrow
  ```

### 4. Action Bar (`ActionBar.svelte` — new)

```
Share (32×32) | Copy (32×32) [msg/mdwn] | Rewrite Session (32×32) | [avatar stack] N (62×24 pill) | gap | Helpful (32×32) | Not helpful (32×32) | Heart (32×32) | More ⋮ (32×32)
```

- Sources pill: 3 stacked avatar circles (name-colored, overlapped) + count "N"
- Avatar: `hsl(hash(domain/name) % 360, 45%, 55%)`, ~16×16, `ring-2 ring-surface`
- Copy button has dropdown: Copy message / Copy markdown
- Includes all 3 existing reactions: Helpful, Not helpful, Heart

### 5. Sources Modal (`SourcesModal.svelte` — new)

- Perplexity-style dialog overlay
- Header: "N sources" + Close
- Scrollable source cards: avatar (colored circle) + domain + title + description

### 6. ChatMessage (`ChatMessage.svelte`)

- User: h1 heading (no bubble, no background)
- Assistant: plain rich text flow (no bubble, no card, no border-left accent)
- Inline citations as buttons: source name (10px) + optional "+N" badge
- ActionBar component below each assistant message
- Keep existing reactions (Helpful/Not helpful/Heart) + Copy message + Copy markdown — integrated into ActionBar
- Sources become modal trigger, not inline accordion

### 7. Tool Calls Panel

- Keep existing toggle right sidebar, restyled
- Each tool call: avatar circle (name-colored) + tool name + status/result
- Uses same avatar algorithm as sources

### 8. Follow-ups (SuggestedQuestions.svelte)

- Reposition: below ActionBar, above banners/input
- 5 pill suggestions
- Style: warm dark surface, teal-green accent border

### 9. Banners (`Banner.svelte` — new)

- **Pro banner** (dismissible): promotes features, disappears on first keystroke
- **Status bar** (persistent): context info (shared session, etc.)
- **Forked banner**: at top of answer area, only on forked sessions

---

## File Changes

| File                                           | Action                                                       |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `src/app.css`                                  | Rewrite tokens, remove gradient/grain                        |
| `src/routes/+layout.svelte`                    | Minor — keep nav                                             |
| `src/routes/+page.svelte`                      | Style update                                                 |
| `src/routes/chat/[id]/+page.svelte`            | Restructure layout                                           |
| `src/lib/components/ChatInput.svelte`          | contenteditable, submit/stop states                          |
| `src/lib/components/ChatMessage.svelte`        | No bubbles, h1 user, inline citations, keep reactions + copy |
| `src/lib/components/ChatSidebar.svelte`        | Collapsible 220/60px, redesign                               |
| `src/lib/components/HomeChatInput.svelte`      | Style update                                                 |
| `src/lib/components/SuggestedQuestions.svelte` | Reposition + restyle                                         |
| `src/lib/components/ActionBar.svelte`          | **New** — answer footer                                      |
| `src/lib/components/SourcesModal.svelte`       | **New** — sources dialog                                     |
| `src/lib/components/Banner.svelte`             | **New** — banners                                            |
| `src/lib/utils/avatar.ts`                      | **New** — deterministic name→color                           |
| `src/lib/components/ToolCallPanel.svelte`      | Restyle with avatars                                         |

---

## Implementation Order

1. `app.css` — tokens
2. `avatar.ts` — utility
3. `ChatSidebar.svelte` — collapsible
4. `+page.svelte` — style update
5. `chat/[id]/+page.svelte` — layout
6. `ChatInput.svelte` — contenteditable + states
7. `ActionBar.svelte` — new component
8. `ChatMessage.svelte` — no bubbles, citations
9. `SourcesModal.svelte` — dialog
10. `Banner.svelte` — banners
11. `ToolCallPanel.svelte` — restyle with avatars
12. `SuggestedQuestions.svelte` — reposition
