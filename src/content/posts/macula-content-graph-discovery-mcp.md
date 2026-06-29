---
published: true
title: 'Your Content Is a Gallery, Not a Filing Cabinet: Graph Discovery for AI Agents'
slug: 'macula-content-graph-discovery-mcp'
description: 'How AI agents explore creative content by following relationships, using a gallery metaphor to compare graph walks against traditional REST APIs.'
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

## A Gallery of Relationships

A photographer's gallery works by following relationships, not by memorizing a floor plan. One room holds landscapes. Another holds portraits. A third is street photography. Tags cut across rooms: a black-and-white portrait in the portraits room also shows up when someone browses the "black and white" tag. Artist profiles at the entrance list portfolios and bio.

An AI agent walking this gallery doesn't need an address book. It moves from a tag to every photo tagged that way. From a photo to the creator. From the creator to their other albums. From a license to every work under it.

Each step follows a connection that already exists. The agent discovers content the way a person would, by exploring what's linked.

## Rooms, Tags, and the Edges Between Them

A content graph isn't a list of files or a database table. It's a web of real relationships. Here's what that looks like:

- **Rooms** are directories. They hold collections of works grouped by theme, project, or purpose. Walk into one and you see what's inside.
- **Tags** are keywords. They connect works across different rooms. A photo tagged "iceland" in the Landscapes room connects to other Iceland-tagged works anywhere in the gallery.
- **Artists** are users. They create the works and organize their rooms. Each has a profile and a set of albums.
- **Exploring** means walking from one node to another along a relationship. Each step is guided by connections that already exist.

This structure works well for AI agents because it mirrors how humans explore. You follow associations instead of looking up addresses. You don't need to know that image "abc123" lives at `/api/v2/files/abc123`. You ask what's tagged with Iceland and walk from there.

## Too Many Tools, One Traversal

We started with 15 separate MCP tools. That was too many. Agents had to learn a whole API surface just to answer simple questions about content: one tool for searching, one for user profiles, one for keyword lookups, one for license filtering. Each tool required the agent to know exactly which one to call. This was a design mistake. We fixed it.

The content graph simplifies everything. Instead of a separate tool for every question (show me this room, find me this tag, who is this artist, what's in this directory), there's one exploration tool. The agent says where to start and which relationship to follow. The tool handles the rest.

Three leaf operations handle terminal data. When you've arrived at a destination and need the details:

- **File details**: comprehensive metadata for a specific work (title, creator, license, assets, AI info)
- **Technical metadata**: EXIF, XMP, IPTC data for in-depth technical analysis
- **User profiles**: batch lookup of creator information

The exploration tool supports 60 possible from-to-edge pairs. Those are combinations of starting points and valid relationships to follow. Of those 60, 11 return data directly. The rest are invalid combinations that return empty results. This guides agents toward valid paths.

This consolidation means agents spend less time choosing tools and more time exploring. The interface shrinks from many rigid endpoints to one flexible question: "Where do you want to start, and what do you want to follow?"

## Three Walks From Real Work

Each walk follows the same pattern: start at a node, follow edges, inspect results. The traversal chains show how the content graph maps directly to agent reasoning.

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

Sarah starts her day asking about recently published travel photos. Manus walks her profile, drops into the travel directory, and inspects metadata. The agent can do this because her content structure is exposed through the graph, not hidden behind custom endpoint logic.

Later a client needs architecture photography under CC-BY. Manus walks Sarah's uploads and traverses the CC BY license edge to find matching images, reading dimensions and specs. One traversal chain replaces what would normally take three sequential API calls.

A travel blog features Sarah's Iceland work. Manus follows the "iceland" keyword edge, finds tagged files, inspects candidates, and checks presets for the right image sizes. The keyword cross-cuts albums and directories because tags aren't tied to any one storage location.

Sarah doesn't need to manually update her portfolio across multiple platforms. Macula is her single source of truth. Images are hosted with full metadata. MCP access lets AI agents read her work with correct attribution. New work is instantly available with no sync step.

## Graph Walks vs REST: Not Even Close

Content graphs change how agents interact with data:

|                  | Graph Walk                             | REST                     |
| ---------------- | -------------------------------------- | ------------------------ |
| **Mental model** | Nodes and relationships                | Endpoints and URLs       |
| **Discovery**    | Describe what you want                 | Know the URL patterns    |
| **Round trips**  | 1-2 calls                              | 3+ sequential requests   |
| **Versioning**   | Edge definitions evolve                | New endpoint versions    |
| **Agent fit**    | Natural (entity to relation to entity) | Translation layer needed |

With REST, an agent fetching all CC-BY images by a specific user needs to: (1) look up user ID, (2) query user's files, (3) filter by license server-side or client-side. That's three sequential calls, each with its own URL pattern. With a graph walk, the agent starts at the user, follows the license edge, and arrives at the result in one conceptual step. No URL discovery needed.

## What This Looks Like in Code

Mapping the metaphor back to MCP tools: `traverse` is the exploration walk. `get_file` and `get_file_metadata` are the leaf operations for inspecting what you find. `get_users` is batch profile lookup.

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

Every request is validated and sanitized. String inputs are checked against strict patterns. Length limits prevent oversized requests. Dangerous characters are stripped.

## Complete Reference

_These tool names map to the content graph operations described above._

### All 4 Tools

| Tool                | Description                                                                                                                                                                                                                                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `traverse`          | Universal discovery tool. Follows relationships across 6 from types by 10 edges. Supports full-text search, keyword lookup, user profiles, file/directory info, and all previous specialized operations. Images included in all traversal results (`contains` and `tagged_files` follow rendition chains). |
| `get_file`          | Get file information by unifiedId. Returns title, description, creator, links, assets, size, copyright info, and AI info. Optional `fields` param for selective retrieval.                                                                                                                                 |
| `get_file_metadata` | Get full EXIF/XMP/IPTC metadata. Optional `a` parameter for specific metadata fields.                                                                                                                                                                                                                      |
| `get_users`         | Batch user profile lookup. Accepts 1-100 nicknames, returns array of UserNode or null for not-found.                                                                                                                                                                                                       |

#### Replaced Tools

| Old Tool                      | Replacement                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `get_file_presets`            | `get_file(fields: ['presets'])`                                                                |
| `get_file_json_schema`        | Removed. Schema exposed via tool metadata                                                      |
| `get_metadata_json_schema`    | Removed. Schema exposed via tool metadata                                                      |
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

| Prompt              | Description                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `browse_user`       | Explore a creator's profile, directories, and published files via user to directory to file navigation                                                 |
| `display_media`     | Display files (images, video, audio) in markdown with optimal renditions and presets                                                                   |
| `explore_directory` | Explore a directory's structure, file inventory, and organization patterns                                                                             |
| `inspect_metadata`  | Analyze file metadata. Returns EXIF/XMP/IPTC, AI generation info, licensing, and technical specs                                                       |
| `discover_content`  | Discover and filter content. Supports search, random/recent browsing, and filtering by AI generation status, data mining permission, type, and license |

### Resources (2)

| Resource URI            | Description                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `instructions`          | Service documentation and usage guidelines for AI agents                                                           |
| `/.well-known/mcp.json` | Auto-discovery metadata. MCP clients find our server at `https://u.macula.link/.well-known/mcp.json` automatically |

---

All tools are read-only. You can query and analyze, but not modify data. This keeps the system safe and predictable.

### Works With

Any AI agent or platform that supports MCP:

- **Manus AI** - Full AI agent for complex workflows
- **Lovable** - Build apps with AI assistance
- **Cursor** - AI-powered code editor
- **Claude Desktop** - Anthropic's MCP integration
- **Custom agents** - Build your own with the SDK

## How the Ecosystem Wins

When photographers host on Macula, their work becomes part of a growing ecosystem. The value compounds:

- **For creators**: One place to publish, with licensing and copyright built in
- **For AI agents**: Standardized access to millions of files with correct attribution
- **For everyone**: Better licensing compliance, less copyright confusion, more fair use of creative work

## Getting Started

1. **Auto-discover the server**. MCP-compatible clients find our auto-discovery metadata at `https://u.macula.link/.well-known/mcp.json` automatically.
2. **Connect to our MCP server** at `https://u.macula.link/mcp`.
3. **Explore available tools**. The server will describe what it can do.
4. **Try a prompt**. Start with `browse_user` or `random_exploration`.
5. **Build your workflow**. Chain tools together for complex tasks.

As AI agents become more capable, the ability to discover and reason about creative content becomes increasingly valuable. MCP provides the standardized interface that makes this practical. We've seen agents do things with the content graph that we didn't design for, and that's the point: when you expose relationships instead of endpoints, agents find paths you never planned.

We're continuing to expand our toolset based on real usage patterns. If you're building AI-powered content applications, we'd love to hear what you'd like to see.

---

_For technical details on our MCP implementation, see [Building a Public MCP Server: From Zero to Production](./macula-mcp-production-lessons)._
