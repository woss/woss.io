---
published: true
title: 'Your Content Is a Gallery, Not a Filing Cabinet: Graph Discovery for AI Agents'
slug: 'macula-content-graph-discovery-mcp'
description: 'How AI agents navigate creative content by following relationships — a conceptual deep-dive into graph-based discovery using a gallery metaphor, comparing graph walks against traditional REST APIs.'
date: 2026-06-20
tags:
  - macula
  - MCP
  - content graph
  - graph traversal
  - REST
  - API design
part_of_series: macula-mcp-announcement
header_image: 'https://u.macula.link/Kh9NMfIeSUakGgg3sOL12w-7'
---

## The Gallery

Imagine a photographer's gallery. Inside are themed rooms — "Landscapes," "Portraits," "Street Photography" — each room a directory containing works. Along the walls, exhibits carry tags: "iceland," "black and white," "golden hour." At the entrance, artist profiles display biographies and portfolios.

An AI agent walks this gallery not by memorizing a floor plan, but by following relationships. It moves from a tag to all photos bearing that tag. From a photo to the artist who made it. From the artist to their other albums. From a license to all works under that license.

Each step reveals something new. Each connection leads somewhere meaningful.

This is the content graph.

## What Makes a Content Graph?

A content graph isn't a list of files or a database table. It's a web of relationships. Everything connects to everything else through meaningful edges.

- **Rooms** are directories. They contain collections of works grouped by theme, project, or purpose. Walk into a room and you see what's inside.
- **Tags** are keywords. They connect works across different rooms. A photo tagged "iceland" in the Landscapes room connects to other iceland-tagged works anywhere in the gallery.
- **Artists** are users. They create the works and organize their rooms. Each artist has a profile and a collection of albums.
- **Exploring** is traversal. You walk from one node (a room, a tag, an artist) to another along a relationship. Each step is guided by the connections that exist.

This graph structure is natural for AI agents because it mirrors how humans explore: by association, not by address. You don't need to know that image "abc123" is at URL "/api/v2/files/abc123" — you ask what's tagged with iceland and walk from there.

## From Many Tools to One Walk

Early AI-to-content interfaces gave agents many small, rigid tools: one for searching, one for user profiles, one for keyword lookups, one for license filtering. Each tool required the agent to know exactly which one to call. The agent had to understand an API surface, not just a domain.

The content graph simplifies this dramatically.

Before: a separate tool for every question ("show me this room," "find me this tag," "who is this artist," "what's in this directory"). Now: one exploration tool that moves between any connected points in the graph. The agent describes where to start and which relationship to follow. The tool does the rest.

Three leaf operations handle terminal data — when you've arrived at a destination and need the details:

- **File details**: comprehensive metadata for a specific work (title, creator, license, assets, AI info)
- **Technical metadata**: EXIF, XMP, IPTC data for in-depth technical analysis
- **User profiles**: batch lookup of creator information

The exploration tool supports 60 possible from-to-edge pairs — combinations of starting points and relationships to follow. Of those, 11 return data directly (the rest are invalid combinations that return empty results, guiding agents toward valid paths).

This consolidation means agents spend less time choosing tools and more time exploring. The interface shrinks from many rigid endpoints to one flexible question: "Where do you want to start, and what do you want to follow?"

## Three Real-World Walks

Each walk shows the same tree structure: an agent starts at a node, follows edges, and inspects results. The traversal chains illustrate how the content graph maps directly to agent reasoning.

### Walk 1: Building a Mood Board

A designer needs images for an article on sustainable architecture. An AI agent helps find them.

```sh
traverse({ from:{type:'root'}, edge:'search', query:'sustainable architecture' })
│
├── Returns: files matching search
│
├── traverse({ from:{type:'license', license:'CC BY'}, edge:'has_license', filter:{what:'images'} })
│   └── Returns: CC-BY licensed images only
│       │
│       └── get_file({ unifiedId:'candidate123', fields:['title','creator','dimensions','license'] })
│           └── Returns: confirmed file details for attribution
│
└── traverse({ from:{type:'user', nickname:'photographer'}, edge:'uploads' })
    └── Returns: more images by same creator
```

The agent starts with a broad search, narrows by license and content type, inspects specific candidates, then follows a creator's uploads for more. One continuous exploration, no URL patterns to discover.

### Walk 2: Researching Creative Trends

An agent analyzes what creators are making to understand emerging trends.

```sh
traverse({ from:{type:'user', nickname:'creator1'}, edge:'profile' })
│
├── Returns: profile + directory listing (albums)
│   [{name:'landscapes', pathCid:'QmA...', fileCount:42},
│    {name:'portraits',  pathCid:'QmB...', fileCount:18}]
│
├── traverse({ from:{type:'directory', pathCid:'QmA...'}, edge:'contains', filter:{what:'images'} })
│   └── Returns: images from landscapes album
│
├── traverse({ from:{type:'directory', pathCid:'QmB...'}, edge:'contains', filter:{what:'images'} })
│   └── Returns: images from portraits album
│
└── compare across creators (repeat)
    └── traverse({ from:{type:'user', nickname:'creator2'}, edge:'profile' })
        └── Follow same pattern...
```

Artist to albums to works. The agent discovers album structure from the profile, walks into each album, and repeats across multiple creators to build a comparative view.

### Walk 3: Building a Feature Page with Attribution

Sarah is a professional landscape photographer. She connects Manus AI to Macula's MCP server. Here is what a full day of agent-assisted work looks like:

```sh
traverse({ from:{type:'user', nickname:'sarah'}, edge:'profile' })
│
├── traverse({ from:{type:'directory', pathCid:'QmTravel'}, edge:'contains', filter:{what:'images'} })
│   └── get_file_metadata({ unifiedId:'img001', a:['exif','xmp'] })
│       └── Presents morning portfolio review
│
├── traverse({ from:{type:'user', nickname:'sarah'}, edge:'uploads' })
│   ├── traverse({ from:{type:'license', license:'CC BY'}, edge:'has_license' })
│   │   ├── get_file({ unifiedId:'img002', fields:['title','dimensions','license'] })
│   │   └── Prepares midday client presentation
│   │
│   ├── traverse({ filter:{allowedAiTraining:true} })
│   │   └── Reviews which images permit AI training (afternoon)
│   │
│   └── traverse({ from:{type:'root'}, edge:'search', query:'landscape', filter:{allowAi:false} })
│       └── Non-AI landscape images for client review (afternoon)
│
└── traverse({ from:{type:'keyword', keyword:'iceland'}, edge:'tagged_files' })
    └── get_file({ unifiedId:'iceland01', fields:['title','creator','license','presets'] })
        └── Generates article draft with proper attribution (afternoon)
```

**What happens at each step:**

- **Morning**: Sarah asks "Show me my recently published travel photos." Manus walks her profile, goes to travel directory, inspects metadata.
- **Midday**: A client needs architecture photography under CC-BY. Manus walks Sarah's uploads, filters by license, reads dimensions and specs.
- **Afternoon**: A travel blog features Sarah's Iceland work. Manus walks the "iceland" keyword, finds tagged files, inspects candidates, checks presets for the right image sizes.

Sarah doesn't need to manually update her portfolio across multiple platforms. Macula is her single source of truth — images are hosted with full metadata, MCP access lets AI agents read her work with correct attribution, and automatic updates mean new work is instantly available.

## Why Graph Walks > REST Calls

Content graphs fundamentally change how agents interact with data:

|                  | Graph Walk                             | REST                     |
| ---------------- | -------------------------------------- | ------------------------ |
| **Mental model** | Nodes and relationships                | Endpoints and URLs       |
| **Discovery**    | Describe what you want                 | Know the URL patterns    |
| **Round trips**  | 1-2 calls                              | 3+ sequential requests   |
| **Versioning**   | Edge definitions evolve                | New endpoint versions    |
| **Agent fit**    | Natural (entity to relation to entity) | Translation layer needed |

With REST, an agent fetching all CC-BY images by a specific user needs to: (1) look up user ID, (2) query user's files, (3) filter by license server-side or client-side. With a graph walk, the agent starts at the user, follows the license edge, and arrives at the result in one conceptual step.

## Content Graph in Practice

Mapping the metaphor back to MCP tools: the `traverse` tool is the exploration walk. `get_file` and `get_file_metadata` are the leaf operations for inspecting what you find. `get_users` is batch profile lookup.

For developers building AI-powered applications:

```javascript
// Example: Finding CC-licensed images via traverse
const response = await mcpClient.callTool('traverse', {
  from: { type: 'license', license: 'Attribution (CC BY)' },
  edge: 'has_license',
  limit: 10,
});

// Example: Getting file metadata with selective fields
const fileData = await mcpClient.callTool('get_file', {
  unifiedId: 'abc123xyz',
  fields: ['title', 'creator', 'license'],
});

// Example: Finding images tagged with "iceland" via keyword traversal
const response = await mcpClient.callTool('traverse', {
  from: { type: 'keyword', keyword: 'iceland' },
  edge: 'tagged_files',
  filter: { what: 'images' },
  limit: 20,
});

// Example: Full-text search across file titles
const results = await mcpClient.callTool('traverse', {
  from: { type: 'root' },
  edge: 'search',
  query: 'sustainable architecture',
  limit: 10,
});

// Example: Batch user profile lookup
const users = await mcpClient.callTool('get_users', {
  nicknames: ['sarah', 'john', 'alex'],
});

// Example: Directory traversal including images
const directoryContents = await mcpClient.callTool('traverse', {
  from: { type: 'directory', pathCid: 'QmExampleDirectory' },
  edge: 'contains',
  limit: 20,
});

// Example: Filter by content type within a directory
const onlyImages = await mcpClient.callTool('traverse', {
  from: { type: 'directory', pathCid: 'QmExampleDirectory' },
  edge: 'contains',
  filter: { what: 'images' },
  limit: 20,
});

// Example: Random discovery across all content
const randomFiles = await mcpClient.callTool('traverse', {
  from: { type: 'root' },
  edge: 'random',
  limit: 5,
});
```

The MCP interface abstracts away our internal implementation. You don't need to understand our database schema, API versioning, or caching strategy. The tools are designed to be intuitive and self-documenting.

## Security & Performance

### Public by Design

All MCP-accessible content is public. No authentication required because the data is already meant to be accessible. This simplifies the architecture and removes the overhead of managing credentials for AI agents.

### Rate Limiting

We use two-layer rate limiting to ensure fair access:

- **Slow-down layer**: Progressive delays after 100 requests prevent abuse
- **Hard limit**: 200 requests per minute maximum

### Input Validation

Every request is validated and sanitized — string inputs checked against strict patterns, length limits prevent oversized requests, dangerous characters stripped.

## Complete Reference

_These tool names map to the content graph operations described above._

### All 4 Tools

| Tool                | Description                                                                                                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `traverse`          | Universal discovery — navigate relationships across 6 from types by 10 edges. Supports full-text search, keyword lookup, user profiles, file/directory info, and all previous specialized operations. Images included in all traversal results (`contains` and `tagged_files` follow rendition chains). |
| `get_file`          | Get file information by unifiedId — title, description, creator, links, assets, size, copyright info, AI info. Optional `fields` param for selective retrieval.                                                                                                                                         |
| `get_file_metadata` | Get full EXIF/XMP/IPTC metadata. Optional `a` parameter for specific metadata fields.                                                                                                                                                                                                                   |
| `get_users`         | Batch user profile lookup. Accepts 1-100 nicknames, returns array of UserNode or null for not-found.                                                                                                                                                                                                    |

#### Replaced Tools

| Old Tool                      | Replacement                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `get_file_presets`            | `get_file(fields: ['presets'])`                                                                |
| `get_file_json_schema`        | Removed — schema exposed via tool metadata                                                     |
| `get_metadata_json_schema`    | Removed — schema exposed via tool metadata                                                     |
| `get_node(type: 'file')`      | `traverse(edge: 'info', from: { type: 'file', unifiedId })`                                    |
| `get_node(type: 'user')`      | `traverse(edge: 'profile', from: { type: 'user', nickname })` or `get_users(nicknames: [...])` |
| `get_node(type: 'directory')` | `traverse(edge: 'info', from: { type: 'directory', pathCid })`                                 |
| `get_user(nickname)`          | `get_users(nicknames: [nickname])`                                                             |
| `search(query)`               | `traverse(from: { type: 'root' }, edge: 'search', query)`                                      |
| `search_keywords(search)`     | `traverse(from: { type: 'root' }, edge: 'keywords', query)`                                    |
| `list_files_by_license`       | `traverse(from: { type: 'license', license }, edge: 'has_license')`                            |
| `list_files_for_ai`           | `traverse(filter: { allowedAiTraining: true })`                                                |
| `list_user_files`             | `traverse(from: { type: 'user', nickname }, edge: 'uploads')`                                  |
| `list_random_files`           | `traverse(from: { type: 'root' }, edge: 'random')`                                             |
| `list_files_by_keyword`       | `traverse(from: { type: 'keyword', keyword }, edge: 'tagged_files')`                           |
| `get_directory`               | `traverse(edge: 'info', from: { type: 'directory', pathCid })`                                 |
| `get_directory_files`         | `traverse(from: { type: 'directory', pathCid }, edge: 'contains')`                             |

### All 5 Prompts

| Prompt              | Description                                                                                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `browse_user`       | Explore a creator's profile, directories, and published files via user to directory to file navigation                                |
| `display_media`     | Display files (images, video, audio) in markdown with optimal renditions and presets                                                  |
| `explore_directory` | Deep-dive into a directory's structure, file inventory, and organization patterns                                                     |
| `inspect_metadata`  | Analyze file metadata — EXIF/XMP/IPTC, AI generation info, licensing, and technical specs                                             |
| `discover_content`  | Discover and filter content — search, browse random/recent, filter by AI generation status, data mining permission, type, and license |

### Resources (2)

| Resource URI            | Description                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `instructions`          | Service documentation and usage guidelines for AI agents                                                            |
| `/.well-known/mcp.json` | Auto-discovery metadata — MCP clients find our server at `https://u.macula.link/.well-known/mcp.json` automatically |

---

All tools are read-only. You can query and analyze, but not modify data. Keeps the system safe and predictable.

### Works With

Any AI agent or platform that supports MCP:

- **Manus AI** — Full AI agent for complex workflows
- **Lovable** — Build apps with AI assistance
- **Cursor** — AI-powered code editor
- **Claude Desktop** — Anthropic's MCP integration
- **Custom agents** — Build your own with the SDK

## The Ecosystem Advantage

When photographers host on Macula, their work becomes part of a growing ecosystem:

- **For creators**: One place to publish, with licensing and copyright built-in
- **For AI agents**: Standardized access to millions of files with correct attribution
- **For everyone**: Better licensing compliance, less copyright confusion, more fair use of creative work

## Getting Started

1. **Auto-discover the server** — MCP-compatible clients find our auto-discovery metadata at `https://u.macula.link/.well-known/mcp.json` automatically
2. **Connect to our MCP server** at `https://u.macula.link/mcp`
3. **Explore available tools** — the server will describe what it can do
4. **Try a prompt** — start with `browse_user` or `random_exploration`
5. **Build your workflow** — chain tools together for complex tasks

As AI agents become more capable, the ability to discover and reason about creative content becomes increasingly valuable. MCP provides the standardized interface that makes this possible.

We're continuing to expand our toolset based on real usage patterns. If you're building AI-powered content applications, we'd love to hear what you'd like to see.

---

_For technical details on our MCP implementation, see [Building a Public MCP Server: From Zero to Production](./macula-mcp-production-lessons)._
