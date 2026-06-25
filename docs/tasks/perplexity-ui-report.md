# Perplexity AI — Complete UI Reverse Engineering Report

_Reverse-engineered from perplexity.ai search result pages, desktop (2560×1323) and mobile (390×844)._

---

## 1. Overall Page Architecture

**3-section layout:**

```
┌──────────┬──────────────────────────────────────┐
│ SIDEBAR  │          MAIN CONTENT                 │
│ 200/56px │  ┌─────────────────────────────────┐  │
│          │  │  TOP BAR (tabs + session actions)│  │
│          │  ├─────────────────────────────────┤  │
│          │  │  ANSWER PANEL (720px centered)   │  │
│          │  │  - Query heading (h1)            │  │
│          │  │  - Source card(s)                │  │
│          │  │  - Rich text body + citations    │  │
│          │  │  - Action bar (Share/Copy/etc)   │  │
│          │  │  - Feedback buttons              │  │
│          │  │  - Follow-ups section            │  │
│          │  │  - Pro banner (dismissible)      │  │
│          │  │  - Status bar                    │  │
│          │  │  ┌─────────────────────────┐     │  │
│          │  │  │  CHAT INPUT (720×94px)   │     │  │
│          │  │  └─────────────────────────┘     │  │
│          │  └─────────────────────────────────┘  │
└──────────┴──────────────────────────────────────┘
```

- **Sidebar**: 200px expanded, 56px collapsed. Hidden on mobile.
- **Answer panel**: 720px wide, centered with 892px margins (28% viewport width on 2560px).
- **Body font**: `pplxSerif` 16px/26px weight 430.
- **Code**: `pplxSansMono` 14px/22.75px weight 450.
- **UI text**: `pplxSans` 14px/20px weight 500.
- **Text color**: `rgb(214,213,212)` warm light gray. Muted: `rgba(214,213,212,0.65)`.

---

## 2. Sidebar (Radix UI Collapsible)

**Expanded (200px):**

- Top: Perplexity logo (40×40 at x=8) + Collapse button (40×40 at x=152)
- "New" button with ⌘K shortcut
- Nav groups (each collapsible with expand chevron): Computer, Spaces, Artefacts, Customise
- History section with "No recent sessions" empty state
- Bottom: Upgrade plan button | Notifications icon | User avatar "perplexity63139"

**Collapsed (56px):**

- All nav items visible as 40×40 icon-only buttons with aria-labels
- Nav text labels hidden

**Collapse/Expand mechanism:**

- Toggle button: `aria-label` switches between "Collapse sidebar" / "Expand sidebar", `data-state` toggles "open"/"closed"
- From collapsed state, expand triggered by **CSS group-hover on logo area** (x=8, y=8, 40×40px)
  - Logo has `group-hover/sidebar:invisible` class — fades on hover
  - Expand button at same position starts `visibility:hidden`, appears on hover
- `transition: all` on nav element
- Answer panel (720px) stays centered regardless of sidebar state — only margins adjust

**Routes**: `/` (new), `/computer/tasks`, `/spaces`, `/computer/artifacts`, `/computer/connectors`, `/computer/skills`, `/computer/workflows`, `/library`

---

## 3. Top Bar (Tabs + Session Actions)

**Tablist** (role=tablist):
| Tab | Icon | Label |
| ----------------- | ---- | -------- |
| Answer (selected) | ✓ | "Answer" |
| Links | - | "Links" |
| Images | - | "Images" |

- **Desktop**: icon + text label
- **Mobile**: icon only, no text

**Session actions** (right side):
| Desktop | Mobile |
| ----------------------------- | -------------------- |
| ⋮ kebab menu | ⋮ kebab menu |
| Share (icon + label) | Share (icon + label) |
| Download Comet (icon + label) | _(hidden)_ |

---

## 4. Answer Panel

**Query header**: h1 styled, 16px/24px weight 590, color `rgb(214,213,212)`. In shared sessions, the user message is rendered as the page heading (no chat bubble). Beside it: Edit query icon + Copy query icon (both 32×32).

**Answer body**: Rich text rendered as plain page content (no chat bubble/bg). Uses `pplxSerif` for body and h2s.

- h2: 18px/22.5px weight 530
- Paragraphs: 16px/26px weight 430
- Bottom margin between paragraphs: 8px
- Follow-ups section: margin-top 16px above

**Shared session indicator**: Banner "Forked from [previous query]" at top of answer area (only in shared sessions, not fresh searches).

---

## 5. Source Cards

Single prominent source card appears below the title header, before answer body.

```
┌──────────────────────────────────────────────┐
│ [favicon]  svelte  (domain)                   │
│            svelte.dev/docs/kit  (URL path)     │
│                                                │
│ Introduction • SvelteKit Docs  (link title)    │
│ What is SvelteKit? SvelteKit is a             │
│ framework for...           (description)       │
└──────────────────────────────────────────────┘
```

- Entire card is a single `<a>` link opening external URL in new tab
- Elements: favicon, domain name, full URL path, page title (bold), description (truncated ~2 lines)

---

## 6. Inline Citations

Two types embedded as `<button>` or `<a>` within answer text:

| Type                       | Rendering                                               | Behavior                                    |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------- |
| **Named source citation**  | `<button>` with source name + optional "+N" count badge | Click opens popup/modal with source details |
| **Linked source citation** | `<a>` linking directly to source URL                    | Opens source in new tab                     |

Citation styling:

- `display:inline-flex`, `align-items:center`
- Source name: `pplxSans` 10px/13.75px weight 430, color `rgb(214,213,212)`, truncated with `max-width`
- Count badge (+N): `pplxSansMono` 10px weight 430, same color
- Observed patterns: deno → direct links; github, stackoverflow → button modal

---

## 7. Answer Footer (Action Bar + Feedback)

Single horizontal row below answer body (y≈517 on scrolled view):

| Left group                    | Right group                       |
| ----------------------------- | --------------------------------- |
| Share (32×32 icon)            | Helpful / thumbs up (32×32)       |
| Copy (32×32 icon)             | Not helpful / thumbs down (32×32) |
| Rewrite Session (32×32 icon)  | More actions / ⋮ (32×32)          |
| Sources pill "N" (62×24 pill) |                                   |

**Mobile**: Download omitted, sources shows just "N" (no "sources" label).

**Sources pill**: Stacked favicon thumbnails (≤3 visible) + count. Click opens Sources dialog.

**Spacing**: 36px gaps between Share→Copy→Rewrite Session, 36px to sources pill, ~154px gap to Helpful, 36px between Helpful/Not helpful/More actions.

**Desktop extra**: Download button present between Share and Copy.

---

## 8. Sources Panel (Dialog)

Modal dialog overlay triggered by clicking sources count pill:

- Header: "N sources" with Close (×) button
- Subtitle: "Sources for [query]"
- Scrollable list of source cards

**Source card in dialog**:

- Small favicon (~16×16px)
- Domain label (e.g., "deno", "neon", "reddit")
- Link title
- Description/excerpt (1-2 sentences)
- Full URL (hidden attribute)

Rendered as tabpanel at root DOM level, not nested in main content.

---

## 9. Follow-ups Section

Below action bar + feedback:

- "Follow-ups" heading
- 5 pill-shaped suggestion buttons, horizontally arranged (wrap on narrow screens)
- Each pill: leading icon + full text of suggested follow-up question
- Click auto-fills chat input or submits immediately

---

## 10. Banners & Status Bar

**Between follow-ups and chat input** (bottom of scrollable content):

**Pro banner** (dismissible):

```
┌──────────────────────────────────────────┐
│ [Pro badge] Free preview of advanced     │
│ search enabled.      [Learn more] [×]    │
└──────────────────────────────────────────┘
```

- Pro badge: teal `color(srgb 0.305882 0.6 0.639216)`, 11px weight 500
- **Auto-dismisses from DOM on first character typed** into chat input
- Reappears on new page load

**Status bar** (persistent, non-dismissible):

```
┌──────────────────────────────────────────┐
│ [icon] Viewing a shared session. Your    │
│        follow-ups will be private to you.│
└──────────────────────────────────────────┘
```

---

## 11. Chat Input / Composer

### Desktop (720×94px)

- Positioned at y=1213 on 1323 viewport (110px above bottom)
- Background `rgb(253,251,250)`, `rounded-2xl` (16px)
- Inner grid: 718×68px

```
[Add files]  [Search✓]  |  textbox (contenteditable)  |  [Model]  [🎤]  [→]
```

| Element        | Size     | Detail                                                                                   |
| -------------- | -------- | ---------------------------------------------------------------------------------------- |
| Search button  | 103×32px | Icon + "Search", pressed state (checkmark), toggle for web search                        |
| Textbox        | 686×28px | contenteditable div, 16px/24px pplxSans, transparent bg, 0 border, 0 padding, no outline |
| Model button   | 83×32px  | "Model" label + chevron (desktop only — icon-only on mobile)                             |
| Dictation      | 32×32px  | Microphone icon                                                                          |
| Submit (arrow) | 32×32px  | Disabled when empty                                                                      |

### Mobile (358×94px, 16px margin each side)

| Element   | Size   | Change from desktop           |
| --------- | ------ | ----------------------------- |
| Add files | 32×32  | Separated from Search button  |
| Search    | 103×32 | Identical                     |
| Textbox   | 324×28 | Narrower (358 - 34px margins) |
| Model     | 32×32  | Icon only, no "Model" label   |
| Dictation | 32×32  | Identical                     |
| Submit    | 32×32  | Identical                     |

---

## 12. Button State Machine (Submit → Stop)

```
┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐
│ DISABLED│───▶│ ENABLED │───▶│  STOP   │───▶│ DISABLED│
│  arrow  │    │  arrow  │    │  square │    │  arrow  │
│ (empty) │    │ (typing)│    │(loading)│    │ (empty) │
└─────────┘    └─────────┘    └─────────┘    └─────────┘
```

1. **Idle empty**: Arrow disabled, grayed out, `pointer-events:none`
2. **Typing**: Arrow enabled, `cursor:pointer`, immediately on any text
3. **Submitted**: Arrow replaced by square Stop icon during answer generation
4. **Complete**: Textbox cleared, arrow returns to disabled state

Additional changes on submit:

- New URL `/search/{new-uuid}`
- "Forked from [query]" banner appears
- Action bar changes: Download → Rewrite Session, More actions appears
- Pro banner reappears

---

## 13. Design System

### Color Palette

| Token        | Value                                  | Usage                         |
| ------------ | -------------------------------------- | ----------------------------- |
| Accent       | `#016A71` (teal/blue-green)            | Buttons, links, active states |
| Dark surface | `#27251E` (warm dark)                  | Sidebar bottom, dark sections |
| Surface warm | `#FAF8F5`                              | Section backgrounds           |
| Input bg     | `#FDFBFA`                              | Chat input area               |
| Warm tint 1  | `rgba(39,26,0,0.035)`                  | Subtle backgrounds            |
| Warm tint 2  | `rgba(39,26,0,0.07)`                   | Stronger element backgrounds  |
| Body text    | `#27251E` / `oklch(0.2642 0.013 93.9)` | Dark warm gray                |
| Muted text   | `rgba(39,37,30,0.5)` and `0.65`        | Secondary text                |
| On-dark text | `#FDFBFA`                              | Text on dark backgrounds      |

**Important**: No pure grays or pure whites — all neutrals have warm brown undertones.

### Typography

| Font           | Stack                                                     | Usage                                         |
| -------------- | --------------------------------------------------------- | --------------------------------------------- |
| `pplxSans`     | ui-sans-serif, system-ui, -apple-system, ...CJK fallbacks | Tabs, buttons, sidebar, input fields, UI text |
| `pplxSerif`    | ui-serif, Georgia, Cambria, ...CJK fallbacks              | Answer body, h2 headings                      |
| `pplxSansMono` | ui-monospace, SFMono-Regular, ...                         | Inline code, citation count badges            |

**Size spectrum**:

| Size | Line Height | Weight | Usage                      |
| ---- | ----------- | ------ | -------------------------- |
| 10px | 13.75px     | 430    | Citation source names      |
| 10px | auto        | 430    | Citation count badges (+N) |
| 11px | auto        | 500    | Pro badge                  |
| 12px | 24px        | 500    | Sources pill number        |
| 14px | 20px        | 500    | Tabs, buttons, UI text     |
| 14px | 22.75px     | 450    | Inline code                |
| 14px | 20px        | 400    | Search button text         |
| 16px | 24px        | 590    | Query heading (h1)         |
| 16px | 26px        | 430    | Answer body (p)            |
| 18px | 22.5px      | 530    | h2 subheadings             |

### Border Radii

| Value              | Usage                                                      |
| ------------------ | ---------------------------------------------------------- |
| 9999px             | Pill shapes (buttons, tags, source pill, feedback buttons) |
| 16px               | Input bar container, large rounded containers              |
| 12px               | Asymmetric variants (12px 0 0 12px, 0 12px 12px 0)         |
| 8px, 6px, 5px, 4px | Small radii for various elements                           |

---

## 14. Tech Stack & CSS Architecture

- **CSS Framework**: Tailwind CSS (utility classes throughout)
- **UI Library**: Radix UI Primitives — ScrollArea, Collapsible, Collection; identified by `data-radix-*` attributes
- **Editor**: Lexical Editor by Meta — `data-lexical-editor` on chat input contenteditable
- **Custom design tokens**: `bg-base`, `bg-subtle`, `bg-underlay`, `border-subtlest`, `ring-subtlest`, `text-subtlest`, `divide-subtlest`, `w-sideBarWidth`, `h-headerHeight`, `h-dvh`
- **State management**: Radix UI managed (`data-state` attributes)
- **Groups**: `group/sidebar` naming for CSS group-hover-based collapse/expand
- **Accessibility**: `motion-reduce:transition-none` for reduced motion
- **Performance**: `[contain:layout]` CSS containment

---

## 15. Mobile vs Desktop Summary

| Feature                  | Desktop (2560×1323)  | Mobile (390×844)     |
| ------------------------ | -------------------- | -------------------- |
| Sidebar                  | 200px / 56px         | Hidden entirely      |
| Tabs                     | Icon + label         | Icon only            |
| Download (action bar)    | Present              | Hidden               |
| Download Comet (top bar) | Icon + label         | Hidden               |
| Sources pill             | "9 sources"          | "9"                  |
| Answer panel width       | 720px                | 358px (16px padding) |
| Chat input width         | 720px                | 358px (16px margin)  |
| Model button             | 83×32, label "Model" | 32×32, icon only     |
| Forked banner            | Full text            | Full text (wraps)    |

---

## 16. Interaction & Animation Details

- **Sidebar collapse/expand**: `transition: all`, `duration-300`, `ease-out`
- **Submit button**: Immediate state transitions, no animation on icon swap
- **Pro banner dismiss**: Removed from DOM instantly on first keystroke
- **Stop → arrow**: Instant on load complete, textbox cleared
- **CSS group-hover sidebar expansion**: Class-based, uses `group-hover/sidebar:visible` / `group-hover/sidebar:invisible` Tailwind utilities
- **No scroll animations** detected — content appears immediately

---

_21 source memories consolidated. Perplexity's UI is characterized by warm minimalism (no pure grays), generous rounding, a collapsible Radix-based sidebar, content-focused answer display (720px centered), and a clear button state machine for the chat input's submit/stop transition._
