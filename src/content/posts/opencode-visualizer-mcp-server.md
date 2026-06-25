---
published: true
title: 'Your CLI tool already talks to humans. Now make it talk to agents.'
slug: 'mcp-server-ocv'
description: 'Adding an MCP server to a CLI tool wrapping eight database queries as stdio-based MCP tools with defensive schema design, DB health checks per call, and the registration is three lines of JSON.'
date: 2026-06-22
tags:
  - opencode
  - MCP
  - CLI tools
  - Deno
  - SQLite
  - TypeScript
  - API design
header_image: 'https://u.macula.link/K-Yi_Xa9RjmyA-jC-BKSXg-7'
part_of_series: opencode-visualizer
---

My OpenCode database is 6.3GB. Nearly 10,000 sessions, 200,000 messages, 847,000 message parts. I've been collecting this data for 112 days without thinking much about it. Every session transcript, every token count, every cost, every model I've tried. It's all sitting there in a SQLite file at `~/.local/share/opencode/opencode.db`.

I built a CLI tool called `ocv` to poke at this data. It renders an ANSI dashboard with bar charts, lets me query sessions by directory, search by title, see stats. Works fine for me at a terminal. But there's a problem the CLI can't solve.

When an AI agent (like the one you're talking to right now) wants to answer "what model have I been using most this week?", it can run `ocv stats -o json` and read the output, but that's cumbersome. It has to parse the JSON from stdout, handle errors, deal with a CLI that was designed for human eyes not for AI native consumption. It has to know the right flags, the right subcommands, the right output format. It has to remember all that.

So I added an MCP server to `ocv`. Here's what that meant, what I learned, and why you might want to do the same to your tools.

## What's MCP, quickly

Model Context Protocol is a standard way for AI agents to discover and call tools. Think of it as USB-C for LLM integrations. Instead of every agent inventing its own plugin format, they all speak MCP. The agent asks "what tools do you have?", you respond with a list of named functions and their JSON schemas, and then the agent calls them with structured arguments. You return structured data back.

An MCP server can be HTTP-based (remote) or stdio-based (local). For a CLI tool that already runs locally, stdio is the natural fit. The agent spawns your process, communicates over stdin/stdout with JSON-RPC messages, and your server stays alive for the duration of the conversation.

## The eight tools

I exposed eight queries from `ocv`'s database layer as MCP tools. Every one wraps an existing function in `lib/db.ts` that the CLI already uses:

- `get_stats`: overall DB statistics (sessions, messages, tokens, cost, DB size)
- `get_overview`: per-directory session overview with aggregate stats
- `list_sessions`: sessions matching a directory path
- `get_session`: full detail for a single session by ID
- `search_sessions`: full-text search over titles and directories
- `get_top_models`: top models by session count
- `get_top_providers`: top providers by session count
- `get_weekly_activity`: session counts bucketed by week

The implementation is about ~200 lines in a file (`lib/mcp.ts`) and additional ~10 in `main.ts` for the command registration. It uses the `@modelcontextprotocol/sdk`, the official TypeScript SDK from Anthropic. It's available on JSR as a Deno-compatible import. You define tools declaratively with name, description, and input schema (standard JSON Schema), then wire up a handler that switches on the tool name.

```typescript
const server = new Server({ name: 'ocv', version: VERSION }, { capabilities: { tools: {} } });
```

The handler calls the same `lib/db.ts` functions the CLI commands call, no duplicate logic or new query writing, just a new interface on top of existing data access.

```typescript
case "get_top_models": {
  const limit = typeof args?.limit === "number"
    ? Math.max(1, Math.floor(args.limit))
    : 10;
  result = getTopModels(db, limit);
  break;
}
```

## Why stdio, not HTTP

First, stdio is simpler. No port management, no daemon, no worrying about what happens when you have multiple projects each wanting their own MCP server. The agent spawns the process when it starts, stops it when it's done. The lifecycle is managed for you.

Second, the DB is local. OpenCode's SQLite file lives at `~/.local/share/opencode/opencode.db`. An HTTP server on localhost could reach it too, but then you have to decide: does the user start the MCP server manually? Does it run as a background service? Who restarts it when it crashes? With stdio, none of that. The MCP client (the agent) manages the subprocess.

## Registration is three lines

To tell OpenCode about the server, I added this block to `.opencode/opencode.jsonc`:

```json
"ocv": {
  "type": "local",
  "command": ["ocv", "mcp"],
  "enabled": true
}
```

That's it. The `mcp` subcommand in `main.ts` creates the server, attaches a `StdioServerTransport`, and connects. The agent discovers it automatically on next launch.

## Error handling philosophy

A detail I'm glad I spent time on: the server does a DB health check (`SELECT 1`) at startup, before it starts accepting tool calls. If the DB file doesn't exist or is corrupt, it fails immediately with a clear error to stderr. No mystery errors halfway through a conversation.

Each tool handler opens a fresh DB connection, runs the query, and closes in a `finally` block. This means a single misbehaving tool call doesn't leak a file descriptor. It also means the DB file can be moved or rotated between calls; the server reconnects each time.

Errors are returned as structured MCP error responses (`isError: true`), not thrown exceptions that crash the server. The agent receives the error message and can decide what to do: retry, ask the user, or give up gracefully.

## The code review catch

This is the kind of bug that's obvious in hindsight but easy to miss when you're in flow. My first draft of the `get_top_models` tool had:

```typescript
limit: { type: "number", description: "..." }
```

No `minimum: 1`. An agent could call `get_top_models` with `limit: -5` and... what? The SQL would do `LIMIT -5`, which SQLite treats as `LIMIT 0`. You'd get zero results silently. Worse, `limit: 0` would also produce empty results with no error.

The fix was two lines: add `minimum: 1` to the schema, and clamp in the handler with `Math.max(1, Math.floor(args.limit))`. Now negative values, floats, and zero all resolve sensibly.

This is the kind of thing that matters when your callers are LLMs, not humans. An LLM will happily pass `limit: -3` because it inferred the parameter from context and got it slightly wrong. A human would never type that. Your server should be defensive.

## What it means in practice

Before MCP, if I wanted an agent to tell me about my usage patterns, I had to either: (a) remember to run `ocv` commands manually and paste output into the conversation, or (b) give the agent shell access and pray the JSON parsing worked.

Now the agent just calls tools. Here's a real exchange the agent you're talking to can handle:

> _"How many sessions have I run in the last week, and which models did I use most?"_

The agent calls `get_weekly_activity` to see the time-series data, `get_top_models` to see model distribution, and `get_stats` for the aggregate numbers. All structured, typed, within the same conversation context. No shell commands, fragile parsing, or "sorry, I can't run that command."

The DB is 6.3GB with 9,860 sessions spanning 112 days. Every one of those sessions is now queryable by the agent that created it. There's something satisfying about that: the tool that wrote all that data can finally read it back in a structured way.

## Your CLI tools are already MCP-ready

MCP is still early. The spec is stable, the SDKs work, but there aren't many examples of wrapping existing CLI tools with an MCP layer. Most of the examples are purpose-built servers: a weather API wrapper, a filesystem access tool, a search interface.

But the CLI tools you already have are full of useful, domain-specific data access patterns. Your deployment tool knows what's running where, your build tool knows what's failing, and your database inspector knows the schema. Adding an MCP server means agents can reach that data without you rebuilding everything from scratch.

The whole thing was about 200 lines split across two files. The most expensive part was deciding what eight tools to expose. The registration took three lines of JSON.

Your CLI already talks to you, and now it can talk to your agents too.
