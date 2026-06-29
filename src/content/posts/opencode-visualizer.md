---
published: true
title: 'Building opencode-visualizer: A Terminal Dashboard for Your AI Coding Assistant'
slug: 'opencode-visualizer'
description: 'Terminal dashboard that reads your OpenCode SQLite database and shows sessions, tokens, costs, and models in pure ANSI. No dependencies, no servers, just one binary built with Deno.'
date: 2026-06-15
featured: true
tags:
  - opencode
  - CLI tools
  - Deno
  - terminal
  - ANSI
  - SQLite
  - dashboard
  - open source
header_image: 'https://u.macula.link/9BH9LsNYSJ6za1-x5QxLEA-7'
---

You use AI coding tools daily. You've got thousands of sessions, millions of tokens, and a stack of model bills. You know you're spending money. But on what? Which projects drive the most usage? What's your actual cost breakdown?

[OpenCode](https://opencode.ai) stores everything in a SQLite database at `~/.local/share/opencode/opencode.db`. Every session, message, token count, model used, cost. It's all there. I decided to play with it and see what I could build.

[opencode-visualizer](https://github.com/woss/opencode-visualizer) is a standalone CLI tool that reads that database directly and renders an ANSI dashboard in your terminal. One binary, zero dependencies, no servers. No data leaves your machine.

## Installation

```bash
brew install woss/tap/ocv
```

Or build from source:

```bash
git clone https://github.com/woss/opencode-visualizer
cd opencode-visualizer
deno task compile
./ocv
```

Repository:
[github.com/woss/opencode-visualizer](https://github.com/woss/opencode-visualizer)
Homebrew tap:
[github.com/woss/homebrew-tap](https://github.com/woss/homebrew-tap)

## The Stack

**Deno.** Not Node, not Go, not Rust. Deno. The choice came down to one
feature: `deno compile` produces a single, self-contained binary from TypeScript
source. No bundler, no packaging, no `node_modules`. The compile step embeds all
modules and the Deno runtime into a ~7MB binary (after stripping).
Cross-compilation to Linux ARM64, macOS Intel, and macOS Apple Silicon is a
single flag.

**SQLite.** Direct read-only access via `@db/sqlite`. No ORM, no query builder.
The schema is simple (sessions, messages, parts), so raw SQL with aggregate
functions is the clearest approach. The `int64` flag is essential because
OpenCode timestamps exceed JavaScript's 32-bit integer range.

**Cliffy.** The CLI framework at `@cliffy/command`. I started with manual
`Deno.args` parsing and per-command help functions. After 150 lines of
boilerplate, I nuked it for cliffy's declarative `Command` API. Ten lines per
subcommand, auto-generated help, typed flag parsing with defaults, `--version`
for free. It's the only CLI framework I've used that reduces code instead of
adding it.

**Pure ANSI escape codes.** This is where it gets interesting.

## Why I Wrote My Own Chart Renderer

Initial approach: install `termichart`, a Rust-based NAPI-RS terminal charting
library with Dracula themes and sparkline support. Sounded perfect.

Reality: the bar charts rendered as unreadable half-block Unicode patterns. Just
`▀▄█` noise that looked like a corrupted JPEG. The sparkline was fine, but the
bar charts were indecipherable.

I ripped it out and replaced it with 50 lines of pure ANSI:

```typescript
export function barColored(value: number, max: number, width: number, color: string): string {
  if (max <= 0 || width <= 0) return '';
  const filled = Math.round((value / max) * width);
  const fill = Math.max(0, Math.min(width, filled));
  const empty = width - fill;
  return color + '█'.repeat(fill) + RESET + DIM + '░'.repeat(empty) + RESET;
}
```

Filled blocks in color, empty blocks dimmed. That's it. Reads perfectly, renders
instantly, zero dependencies.

The same approach extends to dual-colored bars for main vs sub sessions:

```typescript
export function barDualColored(
  mainVal: number,
  subVal: number,
  maxVal: number,
  width: number,
  mainColor: string,
  subColor: string,
): string {
  if (maxVal <= 0 || width <= 0) return '';
  const mainW = clamp(Math.round((mainVal / maxVal) * width), 0, width);
  const subW = clamp(Math.round((subVal / maxVal) * width), 0, width - mainW);
  const emptyW = width - mainW - subW;
  return mainColor + '█'.repeat(mainW) + subColor + '█'.repeat(subW) + DIM + '░'.repeat(emptyW) + RESET;
}
```

Blue for main sessions, cyan for sub-sessions, a legend row beneath the header.
Users can see at a glance which directories have the most delegated work.

## Building the Dashboard

The dashboard layout uses Unicode box-drawing characters (`┌─┬┐│├─┼┤└─┴┘`) with
a two-column split panel:

```bash
┌──────────────────────────────────────────────┬───────────────────────────────┐
│  ● OpenCode Visualizer   6,540 sessions · 37% active · 25 projects · $21.13  │
├──────────────────────────────────────────────┬───────────────────────────────┤
│ Sessions per Directory (Top 10)              │ Models (Top 10)               │
│  █ main  █ sub                               │                               │
│  dali-orm                4,243 ████████████  |  big-pickle      1,760 ████   │
│  woss.io                 1,283 ████░░░░░░░░  │  deepseek-v4-fl…    430 ░     │
│  ...                      ...  ...           │  ...               ...        │
├──────────────────────────────────────────────┼───────────────────────────────┤
│ Token Summary                                │ Models by Cost (Top 2)        │
│  Input        574,316,544                    │  claude-sonnet-4.5 $ 15.13    │
│  Cost         $21.13                         │  big-pickle        $  2.88    │
├──────────────────────────────────────────────┼───────────────────────────────┤
│ Weekly Activity                              │ Providers (Top 4)             │
│  2026-W14      952 ████████████████████████  │  opencode     2,343 ████████  │
│  ...           ...  ...                      │  ...               ...        │
└──────────────────────────────────────────────┴───────────────────────────────┘
```

Section headers in cyan bold, values in bold white, labels dim. Each panel
section has its own color. Green for costs, yellow for models, magenta for
providers, cyan for activity. The color coding creates visual structure without
requiring a graphics terminal.

## CLI Design

```bash
ocv                                             # Dashboard (default)
ocv --help                                      # Show help
ocv stats                                       # Database statistics
ocv dash --top=10                               # Dashboard with top 10
ocv dash --all                                  # Show everything
ocv dash --name=surrealdb-orm,woss.io           # Filter to specific directories
ocv dash --exclude=work-project,internal-tool   # Exclude directories
ocv sessions <path>                             # Sessions for a directory
ocv session <id>                                # Single session details
ocv search <query>                              # Full-text search
ocv rename --from-dir <old> -d <new>            # Batch-rename session directory
ocv overview                                    # Per-directory overview table
ocv stats -o json                               # Any command → JSON with -o json
```

The `--name` flag filters all dashboard panels to specific directories by name.
It works alongside `--exclude` for precise control over what you see.

The `--exclude` flag supports both CLI args and `.ocvignore` files
(gitignore-style patterns at `~/.config/ocv/.ocvignore`). Useful when you have
sensitive directories in your OpenCode history.

Every command also outputs JSON with `-o json` (or `--output json`), making it
pipeable to `jq` for custom analysis.

## Distribution

Single `brew install`:

```bash
brew install woss/tap/ocv
```

Or grab a pre-built binary from GitHub Releases:

```bash
curl -L https://github.com/woss/opencode-visualizer/releases/latest/download/ocv-x86_64-linux.tar.gz | tar xz
./ocv
```

Releases are automated via semantic-release. Push a `feat:` or `fix:` commit to
`main`, and the CI workflow:

1. Cross-compiles binaries for 4 platforms (macOS ARM/Intel, Linux ARM/x86_64)
2. Strips debug symbols (73MB → 7.3MB)
3. Publishes a GitHub Release with tarballs
4. A separate workflow in the Homebrew tap repo picks up the release, computes
   SHA256s, and updates the formula

Zero manual steps from commit to `brew upgrade ocv`.

## What I Learned

**No external chart libraries.** Your first instinct is to reach for a charting
library. For terminal output, write the 50 lines yourself. You'll get exactly
what you need with zero dependency overhead.

**Deno compile surprised me.** I expected headaches cross-compiling from macOS
to Linux ARM64. It just worked on the first try. The binary is genuinely
standalone. No runtime, no CLI, nothing but the file.

**SQLite needs no ORM.** I started sketching an entity layer. That was a waste
of time. The schema has three tables and every query is a GROUP BY aggregate.
Raw SQL with parameterized bindings was cleaner and faster to write than any ORM
wrapper would have been.

**Homebrew taps require zero maintenance.** A Ruby formula with `bin.install`,
`system "deno", "compile"` in the build step, and a cron job to update SHA256
checksums. The tap repo self-maintains via a weekly workflow. I haven't touched
it since creation.

## Similar Projects

The OpenCode ecosystem has sprouted several tools for visualizing usage. Each
has strengths, but they all make trade-offs ocv avoids.

[**opencode-stats**](https://github.com/Cateds/opencode-stats) (Rust/ratatui).
Richer TUI with a 365-day heatmap and share card generation. Well-crafted, but
requires `cargo install`, larger binary, and the interactive TUI is overkill for
quick glances.

[**opencode-usage**](https://github.com/rchardx/opencode-usage) (Python). Daily
and token reports with optional LLM-powered transcript analysis. The LLM
analysis is useful but sends data to external APIs. Requires Python + pip,
slower startup.

[**opencode_analytics**](https://github.com/lemantorus/opencode_analytics)
(Node.js/React). Web-based React dashboard with charts and TPS calculations.
Requires a local server (`npm start`) plus a browser.

[**Vis - OpenCode Visualizer**](https://github.com/xenodrive/vis). Web-based,
requires OpenCode server with CORS enabled.

[**tokscale**](https://github.com/junhoyeo/tokscale) (Rust + TypeScript, 3.5k
stars). The most popular option. TUI + web + 3D graphs, tracks OpenCode, Claude
Code, Codex, Gemini, Cursor. The multi-tool scope adds complexity, and `bunx
tokscale` pulls from npm.

[**codeburn**](https://github.com/AgentSeal/codeburn) (Node.js). Interactive CLI
for Claude Code spending. Requires `npm install`, Claude Code only.

[**llmusage**](https://github.com/openrijal/llmusage) (Python). Multi-provider
CLI tracker that unifies data into its own SQLite. Needs a separate import step.

ocv's differentiators: pure terminal output. No browser, no server, no install
step beyond a single binary. Direct SQLite access means zero telemetry, zero
network. One-shot ANSI output renders instantly and exits. No TUI framework, no
event loop, no interactive mode. You run it, see your data, and you're done.

If you want a zero-dependency, privacy-first, terminal-native dashboard, ocv
is the only choice that fits in one binary.

---

_Built with Deno, SQLite, and ANSI escape codes. No JavaScript frameworks were
harmed in the making of this dashboard._
