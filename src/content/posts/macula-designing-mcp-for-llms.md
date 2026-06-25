---
published: true
title: 'Designing MCP Servers for How LLMs Think'
slug: 'macula-designing-mcp-for-llms'
description: "A design retrospective on three iterations of MCP server refinement driven by observing real LLM behavior — tool design is LLM UX, and a tool an LLM doesn't understand is a tool that might as well not exist."
date: 2026-06-10
tags:
  - macula
  - MCP
  - LLM
  - tool design
  - UX
  - content graph
  - prompt engineering
part_of_series: macula-mcp-announcement
header_image: 'https://u.macula.link/Pi4guk9pQGebQU0lWPIGxQ-7'
---

We set out to build an MCP server for a content platform — files, users, directories, keywords, licenses connected through relationships. Standard stuff. Data model. REST endpoints. We'd done it before.

What we didn't expect was how much we'd have to unlearn.

Every iteration revealed something about how LLMs actually consume tool definitions. Not how we _thought_ they consumed them, not how the spec says they consume them — how they _actually_ behave when given a server with tools, prompts, and resources.

This is the design retrospective. The iterations, the surprises, the lessons.

## Version One: 14 Tools

Version one of our MCP server had 14 tools. Each one mapped to a REST endpoint we already had: `search_files`, `get_user_profile`, `list_keywords`, `get_file_by_license`, `get_random_files`, `get_recent_uploads` — you get the picture.

To a human developer, this made perfect sense. One tool per operation. Predictable. RESTful.

To an LLM, it was a minefield.

The problem wasn't that the tools didn't work. It was that the LLM couldn't reliably choose between them. Given 14 options, it would guess. Sometimes it guessed `get_user_profile` when it should have called `search_files`. Sometimes it hallucinated parameters because it couldn't remember which tool required which inputs.

This isn't an LLM failing — it's a _design_ failing. Fourteen tools means fourteen descriptions for the LLM to parse, fourteen input schemas to understand, fourteen decisions to make. Every additional tool increases cognitive load on the model.

The fix wasn't better descriptions. It was fewer tools.

## The Insight: Graph Model

Our data is a graph. Files connect to users through uploads. Files connect to keywords through tags. Files connect to licenses. Directories contain files. Every entity connects to others through typed relationships.

What if we modeled the API the same way?

Instead of 14 tools, we built one traversal tool:

```sh
traverse({ from, edge })
```

`from` is where you start (a user, a keyword, a directory, a root). `edge` is the relationship you follow (uploads, tagged_files, contains, search, random). The tool returns the nodes at the other end.

This collapsed 14 tools into 4 total:

- **traverse** — graph navigation (was 11 tools)
- **get_file** — file detail reader
- **get_file_metadata** — EXIF/XMP reader
- **get_users** — batch user lookup

The result was immediate. The LLM stopped guessing. When in doubt, it called `traverse`. The single tool pattern was easy to understand: pick a starting point, follow a connection. That's it.

But this revealed our first real problem.

## Iteration 1: Field Names Are For LLMs, Not Humans

Our File node had a field called `url`. To a developer, this was obvious — it's the URL of the file. But to the LLM, `url` was ambiguous. Is it the download URL? The page URL? The API endpoint? The CDN path?

We watched the LLM use `url` in image embeds, expecting it to be a direct download link. Sometimes it was. Sometimes it redirected. The LLM had no way to know.

We renamed:

- `url` to `rawDataUrl` (the direct download)
- Added `htmlPageUrl` (the human-readable page)
- Added `buyPageUrl` (the purchase/license page)

Suddenly, the LLM stopped guessing. When it needed to display an image, it used `rawDataUrl`. When it needed to link to a page, it used `htmlPageUrl`. The field names _were_ the documentation.

A field called `url` is useless to an LLM. A field called `rawDataUrl` is self-documenting. Name fields for the model, not for your internal conventions.

### Iteration 2: Not Everything Belongs Everywhere

Our File node included a `_links` object — a nested structure with raw, base, json, jsonLd, metadata, copyright, webStatement, license, and buy URLs. This was useful for consuming clients that needed all URL variants.

The LLM kept using `_links.raw` in traverse output to construct image URLs. It worked — the raw URL was there. But it was a discovery problem: the LLM had to understand nested structures, navigate into `_links`, and extract the right field. Every nested access was a chance for the LLM to hallucinate the path.

We removed `_links` from traverse output entirely.

Traverse is for _discovery_. You find files, then use `get_file` to get the full detail — including `_links`. Two tools, two responsibilities, no nested ambiguity.

The `_links` object stayed in `get_file` output where it belongs — a consumption endpoint that returns the complete picture.

Separate discovery from consumption. Discovery returns flat, obvious fields. Consumption returns rich structures. Don't mix them.

### Iteration 3: Prompts Are Training Wheels

Even with four tools and clean field names, the LLM sometimes missed the point. It would call `traverse` with `edge: 'search'` when it should have browsed a directory. It would call `get_file` when it should have used `traverse` with `edge: 'info'`.

We added prompts — pre-written messages that guide the LLM through common workflows:

- **display_media** — how to embed images with presets
- **browse_user** — how to navigate from user to directories to files
- **explore_directory** — how to deep-dive into a directory
- **inspect_metadata** — how to analyze file metadata

Each prompt teaches the LLM a pattern. Not instructions — patterns. The LLM reads the prompt, internalizes the workflow, and applies it contextually.

Prompts are training data for the LLM. Write them like tutorials, not command lists. Show the pattern, not the procedure.

## What We Ended Up With

```sh
4 tools, 4 prompts, 1 resource
```

| Tool              | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| traverse          | Graph navigation — discover files, users, directories, keywords |
| get_file          | Full file metadata including \_links, AI info, copyright        |
| get_file_metadata | Raw EXIF/XMP/IPTC technical data                                |
| get_users         | Batch user profile lookup                                       |

That's it. Four entry points. The entire content platform behind a graph-shaped interface.

## The Tech Stack

- **Fastify 5** — HTTP server, plugin system, request lifecycle
- **MCP SDK** — Model Context Protocol (StreamableHTTP transport)
- **Zod** — Input/output validation (same schemas used for tool registration)
- **Prisma** — PostgreSQL ORM, type-safe queries
- **Redis** — Multi-tier caching, rate limiting

## Key Takeaways

**Graph shape matches LLM cognition.** LLMs think in associations, not endpoints. A traversal tool maps naturally to how LLMs reason about connected data. One tool beats fourteen every time.

**Iterate on LLM behavior, not documentation.** Every iteration in this story was driven by watching what the LLM _actually did_ with the tools, not by what we _wanted_ it to do. Field names, tool boundaries, prompt structure — all changed based on observed LLM behavior.

**Name fields for the LLM.** `rawDataUrl` beats `url`. `htmlPageUrl` beats `page`. Descriptive field names eliminate guesswork. The LLM doesn't have domain knowledge — give it everything it needs in the name.

**Separate discovery from consumption.** Traverse returns flat, obvious fields for browsing. `get_file` returns rich structures for consumption. Don't make the LLM navigate nested objects during discovery.

**Tool descriptions are UX.** Every tool description is an instruction to the LLM. Write them like task descriptions, not API documentation. Include examples. Cross-reference related tools.

**Prompts train the model.** Pre-written prompts teach the LLM workflows. Write patterns, not commands. The LLM learns from examples, not instructions.

---

The MCP server we built isn't complex. It's four tools sitting on top of a graph. But the iterations — the field renames, the boundary changes, the prompt refinements — those are where the real design happened.

The graph was the right shape from the start. Teaching ourselves to see it took longer.
