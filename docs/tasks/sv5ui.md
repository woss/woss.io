# sv5ui Refactor Plan

Replace hand-rolled UI with sv5ui components across ~27 files, ~120 occurrences.

## Prerequisites

### Theme Fixes (app.css)

1. Add `@import 'tailwindcss'` directly in `app.css` before sv5ui import — Tailwind currently depends on sv5ui/theme.css
2. Add `:root {}` warm-color overrides (45°/162.5° palette) — light mode currently inherits sv5ui's blue/purple
3. Add dark mode class toggle (`mode-watcher` or manual localStorage `dark` class) — no `.dark` class management exists

---

## Phase 1 — Direct Replacements (no behavioral change)

### Separators (20 occurrences, 11 files)

| Current pattern                    | sv5ui replacement                                                                                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gradient `h-0.5` primary→secondary | `<Separator color="primary" size="xs" />` with `ui={{ border: 'bg-[linear-gradient(90deg,var(--color-primary),var(--color-secondary))]' }}` or keep as custom CSS |
| `border-t rgba(255,255,255,0.08)`  | `<Separator color="surface" size="xs" />`                                                                                                                         |

**Files:** posts/[slug]/, about/, experience/[slug]/, error pages, ChatSidebar, ContactForm

### Badges/Chips (13 occurrences, 7 files)

| Current pattern                                      | sv5ui replacement                                      |
| ---------------------------------------------------- | ------------------------------------------------------ |
| `rounded-full`, `text-secondary`, `bg-secondary/10`  | `<Badge variant="soft" color="secondary" size="sm" />` |
| `rounded-full bg-surface-container-high` small pills | `<Badge variant="subtle" color="surface" size="sm" />` |
| Status dots (ToolCallList)                           | Keep as `<span>` — tiny inline elements                |
| Icon surround `rounded-lg bg-surface-container-high` | `<Avatar size="md" />` or keep as custom               |

**Files:** experience/[slug]/, posts/[slug]/, homepage, ToolCallList, ChatSidebar, about/

### Avatars (9 occurrences, 6 files)

| Current                                            | sv5ui replacement                                               |
| -------------------------------------------------- | --------------------------------------------------------------- |
| Profile photo `size-20 rounded-full`               | `<Avatar src="..." size="xl" class="ring-2 ring-primary/20" />` |
| Icon circles `size-12 rounded-full bg-primary/10`  | Keep — these are icon containers, not avatars                   |
| Error avatar `size-8 rounded-full bg-secondary/20` | `<Avatar text="E" size="sm" />`                                 |
| Source/tool initial avatars `size-7 rounded-full`  | `<Avatar text="S" size="sm" />`                                 |
| ContactForm header/success circles                 | Keep — decorative icon containers                               |

### Toggle (1 occurrence, 1 file)

| Current                  | sv5ui replacement                                                          |
| ------------------------ | -------------------------------------------------------------------------- |
| SoundToggle button-based | `<Switch checkedIcon="lucide:volume-2" uncheckedIcon="lucide:volume-x" />` |

**File:** SoundToggle.svelte

### Spinners/Loaders (4 occurrences, 3 files)

| Current                                    | sv5ui replacement                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| CSS spinner `size-4 border-2 animate-spin` | `<Button loading size="sm" />` or `<Skeleton class="size-4 rounded-full" />` |
| Pulse dots (ChatMessage)                   | Keep custom — 3-dot animation                                                |
| Pulse dots (ChatInput)                     | Keep custom — 3-dot animation                                                |

**Files:** ContactForm, ChatMessage, ChatInput

---

## Phase 2 — Button Replacements

sv5ui `<Button>` API: 6 variants (solid/outline/soft/subtle/ghost/link) × 8 colors × 5 sizes (xs/sm/md/lg/xl). Supports `icon`, `square`, `leadingIcon`, `trailingIcon`, `loading`, `loadingAuto`, `disabled`, `block`, `href`, `active`, `ui` prop, snippets.

| Our variant                                     | Occurrences | sv5ui equivalent                                                                    |
| ----------------------------------------------- | ----------- | ----------------------------------------------------------------------------------- |
| A — Icon-only ghost circle (ActionBar)          | 8           | `<Button icon="..." variant="ghost" square />`                                      |
| B — Icon+label pill (ActionBar)                 | 1           | `<Button leadingIcon="..." label="..." variant="ghost" />`                          |
| C — Filled primary green (Send, feedback, Home) | 7           | `<Button label="..." variant="solid" color="primary" />`                            |
| D — Ghost/outline icon square (Copy)            | 2           | `<Button icon="..." variant="outline" square />`                                    |
| E — Nav hamburger/close square                  | 2           | `<Button icon="..." variant="ghost" square size="lg" />`                            |
| F — Chat send/stop (conditional bg)             | 2           | `<Button icon="..." variant="solid" color="primary" />` — toggle icon only          |
| G — "New Chat" outline                          | 2           | `<Button label="..." variant="soft" color="primary" block />`                       |
| H — Sidebar tiny icons (collapse, delete, tabs) | 6           | `<Button icon="..." variant="ghost" square size="xs" />`                            |
| J — Suggested question pills                    | 4           | `<Badge variant="soft" color="primary" />` or `<Button variant="soft" size="sm" />` |
| L — "Try again" retry pill                      | 1           | `<Button label="..." variant="outline" color="primary" size="sm" />`                |
| M — Banner upgrade CTA                          | 1           | Banner's `actions` prop handles this                                                |
| M — Banner dismiss (X)                          | 1           | Banner's `close` prop handles this                                                  |

### Non-buttons to refactor separately

| Fake button                       | Real component                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| I — Chat list items (links)       | Keep as `<a>` links                                                                  |
| K — RightSidebar tabs             | `<Tabs items={[{value:'sources',label:'Sources'},{value:'tools',label:'Tools'}]} />` |
| O — Slash menu items              | `<Command />`                                                                        |
| P — About page fingerprint links  | `<Button href="..." variant="ghost" />` or `<Link>`                                  |
| Q — Inline text links (ChatInput) | `<Button variant="link" />`                                                          |
| R — Mobile "Chats" link           | `<Button href="/chat" variant="ghost" block />`                                      |

**Button files:** ActionBar, ChatInput, ChatMessage, ChatSidebar, RightSidebar, ContactForm, SoundToggle, SlashMenu, SuggestedQuestions, Banner, home page, error pages, about page, experience page, +layout

---

## Phase 3 — Input/Textarea

sv5ui `<Input>`: 5 variants (outline/soft/subtle/ghost/none), 5 sizes, icons, avatar, highlight, loading, `bind:value`
sv5ui `<Textarea>`: Same variants/sizes, `autoresize`, `maxrows`, icons, loading

| Our input                                   | sv5ui equivalent                                          |
| ------------------------------------------- | --------------------------------------------------------- | -------------------------------------- |
| ContactForm name/email/company/role         | `<Input type="text                                        | email" variant="outline" size="md" />` |
| ContactForm message (3 rows)                | `<Textarea variant="outline" size="md" rows={3} />`       |
| ChatMessage downvote reason                 | `<Input variant="outline" size="sm" placeholder="..." />` |
| WorkflowReplacer placeholder value          | `<Input variant="outline" size="sm" />`                   |
| ChatInput homepage textarea                 | `<Textarea variant="outline" autoresize />`               |
| ChatInput `contenteditable` div (chat mode) | Keep as `contenteditable` — not a form input              |

---

## Phase 4 — Banners / Alerts

sv5ui `<Banner>`: 8 colors, icon, `actions` (ButtonProps[]), `close`, localStorage persistence via `id`, clickable via `to`
sv5ui `<Alert>`: Not fetched; use for ContactForm error

| Our banner                               | sv5ui equivalent                                                      |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Banner.svelte: info variant              | `<Banner color="primary" icon="lucide:info" title="..." />`           |
| Banner.svelte: warning variant           | `<Banner color="warning" icon="lucide:alert-triangle" title="..." />` |
| Banner.svelte: pro (#00da8c) variant     | `<Banner color="success" icon="lucide:sparkles" title="..." />`       |
| ChatInput: locked chat banner            | `<Banner color="secondary" title="..." close />`                      |
| ChatInput: off-topic warning             | `<Banner color="warning" title="..." close />`                        |
| ContactForm: error alert                 | `<Alert color="error" title="..." description="..." />`               |
| Chat page: read-only banner              | `<Banner color="surface" title="..." />`                              |
| ToolCallList: status dots (pending/done) | Keep as `<span>` inline elements                                      |

---

## Phase 5 — Overlays / Modals / Sidebars

sv5ui `<Drawer>`: 4 directions (bottom/left/right/top), inset mode, drag handle, header/body/footer snippets
sv5ui `<Modal>`: 5 sizes (sm/md/lg/xl/full), scrollable, non-dismissible
sv5ui `<DropdownMenu>`: Items with icons, kbds, checkbox/radio, separators, submenus
sv5ui `<Command>`: Command palette with search, filtering, keyboard nav
sv5ui `<Slideover>`: Side panel, similar to Drawer

| Our overlay                          | sv5ui equivalent                                                      |
| ------------------------------------ | --------------------------------------------------------------------- |
| Mobile nav overlay (+layout.svelte)  | `<Drawer direction="right">` nav links `</Drawer>`                    |
| Mobile sidebar overlay (ChatSidebar) | `<Drawer direction="left" bind:open>` sidebar content `</Drawer>`     |
| Mobile right sidebar (RightSidebar)  | `<Drawer direction="right" bind:open>` sidebar content `</Drawer>`    |
| Mobile hamburger FAB (chat page)     | `<Button icon="lucide:menu" variant="soft" square />` triggers drawer |
| Slash menu panel                     | `<Command />`                                                         |
| Experience page dropdown             | `<DropdownMenu items={[...]} />`                                      |

---

## Phase 6 — Accordions

sv5ui `<Accordion>`: type="single"/"multiple", collapsible, snippet-based content, keyboard nav — already partially used in ChatSidebar

| Our accordion                              | sv5ui equivalent                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| WorkflowReplacer: JSON preview `<details>` | `<Accordion type="single" collapsible items={[{label:"JSON",value:"json"}]} />`     |
| Posts: series dropdown `<details>`         | `<Accordion type="single" collapsible items={[{label:"Series",value:"series"}]} />` |
| ChatSidebar: slash commands accordion      | Already using sv5ui Accordion                                                       |
| ChatSidebar: collapsible sidebar           | Already using sv5ui Collapsible                                                     |

---

## Coverage Summary

| Category           | Hand-rolled count | Files        | sv5ui covers?                             |
| ------------------ | ----------------- | ------------ | ----------------------------------------- |
| Buttons            | 12 real variants  | 17           | **Yes** — 6 variants × 8 colors × 5 sizes |
| Input/Textarea     | 8                 | 4            | **Yes** — Input + Textarea                |
| Banners/Alerts     | 8                 | 4            | **Yes** — Banner + Alert                  |
| Badges/Chips       | 13                | 7            | **Yes** — Badge                           |
| Separators         | 20                | 11           | **Mostly** — gradient needs `ui` override |
| Modals/Overlays    | 5                 | 4            | **Yes** — Modal + Drawer                  |
| Dropdowns/Popups   | 3                 | 2            | **Yes** — DropdownMenu + Command          |
| Avatars            | 9                 | 6            | **Yes** — Avatar                          |
| Toggle/Switch      | 1                 | 1            | **Yes** — Switch                          |
| Spinners/Loaders   | 4                 | 3            | **Yes** — Skeleton + Button loading       |
| Accordion/Collapse | 6                 | 4            | **Yes** — already partially using         |
| **Total**          | **~120**          | **27 files** | **~98% coverage**                         |

Only pattern not natively supported: gradient separator (6 occurrences). Everything else maps 1:1.
