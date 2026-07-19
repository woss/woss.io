---
published: true
title: 'A Public MCP Server in Production: Stateless, Graph-Shaped, and Battle-Tested'
slug: 'macula-mcp-production-lessons'
description: 'Production architecture for a public MCP server with stateless graph-walk API, defense-in-depth security, and the image rendition chain bug that taught us about LLM hallucinations.'
date: 2026-05-16
tags:
  - macula
  - MCP
  - content graph
  - API design
  - security
  - TypeScript
  - SurrealDB
part_of_series: macula-mcp-announcement
header_image: 'https://u.macula.link/URMl_ZDDQh2rbEyeo7xngQ-7'
---

Every MCP server exposes a graph. The question is whether you design for it or fight it.

Our Unified Link service connects files, users, directories, keywords, and licenses through named relationships. Files get uploaded by users and tagged with keywords. Directories contain files. Licenses cover files. Users have profiles. These relationships form a content graph: nodes connected by typed edges.

The MCP server is this graph. Its primary operation is walking an edge from a starting node to discover related nodes. Rather than inventing a separate tool per relationship (six tools for six entity types), we built one tool, `traverse`, that walks the whole graph.

Three leaf-reader tools handle terminal operations: `get_file` reads file details, `get_file_metadata` extracts technical metadata, `get_users` looks up user profiles. Everything else is edge-walking.

Here's how we built it and why this graph approach works so well for LLM agents.

## What We Were Working With

We had a public API (`unified-link`) that served metadata about files, users, and keywords. We wanted AI agents to access this data through MCP, but the requirements were specific. No authentication (the data is already public). Read-only operations only. Production-grade rate limiting, input validation, and SQL injection protection. It needed to scale horizontally. And we wanted minimal dependencies: maintainable code, not a dependency forest.

## How the Graph Model Works

The Unified Link data model forms a directed graph with six node types and ten edge types. The `traverse` tool maps from nodes to edges:

```bash
traverse({ from, edge })                         Returns
│
├── FileNode[] edges (8)
│   ├── user       → uploads       → Files published by this user
│   ├── keyword    → tagged_files  → Files tagged with this keyword
│   ├── license    → has_license   → Files under this license
│   ├── directory  → contains      → Files inside this directory
│   ├── root       → random        → Random discovery across all content
│   ├── root       → recent        → Most recently published files
│   ├── root       → search        → Full-text search (titles + keywords)
│   └── file       → info          → Single file by unifiedId
│
├── Non-FileNode edges (3)
│   ├── user       → profile       → User profile + directory listing
│   ├── directory  → info          → Directory metadata + file count
│   └── root       → keywords      → Keyword autocomplete (fuzzy match)
│
└── Cross-cutting filters (apply to any edge)
    ├── filter.what               → 'all' | 'images' | 'videos' | 'files'
    ├── filter.allowedAiTraining  → Boolean (data mining permission)
    ├── filter.allowAi            → Boolean (exclude AI-generated files)
    ├── filter.nickname           → Filter results by uploader
    └── limit / after             → Cursor-based pagination
```

Separate leaf-reader tools (different return shapes):

```plaintext
├── get_file(unifiedId, fields?)         → Full file metadata + assets + presets
├── get_file_metadata(unifiedId, a?)     → EXIF/XMP/IPTC technical metadata
└── get_users(nicknames[])               → Batch user profile lookup
```

Six starting node types by ten edge types gives sixty possible combinations, eleven of which are valid. Unsupported pairs return clear error messages specifying which edges are available for the given `from.type`. The result is a compact, comprehensible API surface: one traversal tool with a small, validated set of `from` + `edge` pairs.

## Why Graph > REST

A REST API for the same data requires endpoint discovery and multiple round trips:

**REST approach:**

```plaintext
GET /user/woss/uploads       → [file IDs]
  → GET /file/{id}           → file metadata
  → GET /file/{id}/metadata  → EXIF/XMP data
```

Three round trips, three different URL patterns, versioned endpoints, and the agent has to know the URL structure in advance.

**Graph approach:**

```javascript
// One call: walk edge from user to files
traverse({ from: { type: 'user', nickname: 'woss' }, edge: 'uploads' });
// Second call only if agent needs deeper metadata
get_file_metadata({ unifiedId });
```

Two calls, a single tool, no URL patterns, no versioning. The agent thinks in entities and relationships. That's the same structure the graph model provides.

Graph-shaped APIs match how LLMs process information: entity to relationship to entity. The agent picks a starting node, chooses a relationship (edge), and receives connected nodes. This maps directly onto MCP's tool-calling paradigm without translation layers.

## Design Choices

### Direct SDK, Not Wrappers

We used `@modelcontextprotocol/sdk` directly instead of wrapper libraries. This gave us full control over transport behavior, no unnecessary abstractions, and direct access to MCP specification features.

### Stateless Mode

The most impactful decision was using stateless mode for session management.

```typescript
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // Stateless mode
});
```

Benefits: no session memory leaks, works with any number of server instances (no sticky sessions), no Redis needed for session storage, restart tolerant, simpler code.

The trade-off is that agents reinitialize after disconnect. For a read-only public service, this is perfectly acceptable.

### Zod for Validation

We used Zod (already in our codebase) for input validation:

```typescript
export const GetFileInputSchema = z.object({
  unifiedId: z
    .string()
    .min(1, 'unifiedId is required')
    .max(64, 'unifiedId must be at most 64 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'unifiedId must contain only alphanumeric characters'),
});
```

### Defense in Depth

Multiple layers of security:

| Layer                  | Protection                            |
| ---------------------- | ------------------------------------- |
| **Slow-down**          | Progressive delays after 100 requests |
| **Rate limiting**      | Hard limit at 200 requests/minute     |
| **Input validation**   | Zod schemas reject invalid input      |
| **Input sanitization** | Remove dangerous characters           |
| **SQL injection**      | Parameterized queries                 |
| **Request timeout**    | 30 seconds max                        |
| **Tool annotations**   | readOnly hints for agents             |

## Architecture

```plaintext
┌──────────────────────────────────────────────────────────────┐
│                         AI Agent                               │
└─────────────────────────────┬─────────────────────────────────┘
                              │ JSON-RPC
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                        MCP Server                              │
│  ┌────────────────────────────────────────────────────────┐   │
│  │        StreamableHTTPServerTransport (stateless)        │   │
│  └────────────────────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────────────────────┐   │
│  │          Rate Limiting (slow-down + hard limit)         │   │
│  └────────────────────────────────────────────────────────┘   │
│  ┌────────────────────────────────────────────────────────┐   │
│  │                       McpServer                          │   │
│  │                   1 Tool (traverse)                      │   │
│  │                   3 Leaf Readers                         │   │
│   │                   5 Task Prompts                          │   │
│  │                  2 Resources                             │   │
│  └────────────────────────────────────────────────────────┘   │
│                              │                                  │
│                  ┌───────────┴───────────┐                      │
│                  ▼                       ▼                      │
│  ┌──────────────────────────────────────┐  ┌──────────────────────┐            │
│  │        Redis                         │  │      PostgreSQL      │            │
│  │  (cache + limits)                    │  │      (Prisma)        │            │
│  └──────────────────────────────────────┘  └──────────────────────┘            │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Tools

One graph-walk tool plus three leaf readers.

`traverse` is the primary navigation tool. It walks edges between graph nodes. `get_file`, `get_file_metadata`, and `get_users` are terminal operations that read leaf data (file details, metadata, user profiles). They terminate the traversal at a node rather than continuing across edges.

| Tool                | Input                                                   | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `traverse`          | `from`, `edge`, `filter?`, `limit?`, `after?`, `query?` | Graph walk: walk from a starting node across a named edge to discover connected nodes. 11 valid `from`-`edge` pairs across 6 node types and 10 edge types. Full-text search via `edge: search` + `query`. Keyword search via `edge: keywords`. User profiles via `edge: profile`. File/directory details via `edge: info`. Cursor pagination via `after`. Filters: what, allowedAiTraining, allowAi, nickname. Images work correctly. `contains` and `tagged_files` follow both direct file and rendition chains. |
| `get_file`          | `unifiedId`, `fields?`                                  | Leaf reader: get file information by unifiedId, including title, description, creator, links, assets, size, copyright info, and AI info. Optional `fields` for JSONPath-based selective field retrieval.                                                                                                                                                                                                                                                                                                          |
| `get_file_metadata` | `unifiedId, a?`                                         | Leaf reader: get full EXIF/XMP/IPTC metadata. Optional `a` for specific metadata fields.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `get_users`         | `nicknames`                                             | Leaf reader: batch user profile lookup. Accepts 1-100 nicknames, returns array of UserNode or null for not-found.                                                                                                                                                                                                                                                                                                                                                                                                 |

The `traverse` tool alone replaced seven specialized tools via its 11 valid traversals. The three leaf readers handle everything else.

**Replaced 6 tools:** get_file_presets, get_file_json_schema, get_metadata_json_schema, get_node, search_keywords, search were deleted as redundant. `traverse` covers all discovery patterns and `get_file` covers all file queries.

**Replaced `get_user`:** Single-user lookup replaced by `get_users(nicknames[])` for batch efficiency.

## The 5 Task Prompts

We reduced from 14 specialized prompts to 5 task-oriented prompts. Rather than naming prompts after tool names, each prompt describes a user goal: what the agent should accomplish, not which tool it should use.

| Prompt              | Description                                                                                                                               | Wraps                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `browse_user`       | Explore a creator's profile, directories, and published files via user → directory → file navigation                                      | `traverse`, `get_users`         |
| `display_media`     | Display files (images, video, audio) in markdown with optimal renditions and presets                                                      | `get_file`                      |
| `explore_directory` | Explore a directory's structure, file inventory, and organization patterns                                                                | `traverse`                      |
| `inspect_metadata`  | Analyze file metadata, including EXIF/XMP/IPTC, AI generation info, licensing, and technical specs                                        | `get_file`, `get_file_metadata` |
| `discover_content`  | Discover and filter content using search, browse random/recent, filter by AI generation status, data mining permission, type, and license | `traverse`                      |

Key design choice: prompts are named for the task not the tool. An agent doesn't "call the traverse prompt." It "browses a user" or "explores a directory." This lowers the activation energy for agents to use the prompts effectively.

## Resources

| Resource URI            | Description                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `instructions`          | Service usage guidelines for agents                                                                                                         |
| `/.well-known/mcp.json` | Auto-discovery metadata that returns `{name, url, transport, version, description}` so MCP clients can connect without manual configuration |

The `/.well-known/mcp.json` endpoint implements the [MCP auto-discovery specification](https://modelcontextprotocol.io). MCP-compatible clients can detect our server automatically without manual URL configuration by checking this well-known URI.

## Security Implementation

### Input Sanitization

We strip dangerous characters before any processing:

```typescript
const DANGEROUS_CHARS_REGEX = /[<>'";&\\]/g;

export function sanitizeInput(input: string, maxLength = 100): string {
  return input.replace(DANGEROUS_CHARS_REGEX, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
```

### SQL Injection Prevention

All raw SQL uses parameterized queries:

```typescript
// Good
await prismaClient.$queryRawUnsafe<...>('SELECT ... LIMIT $1', limit);

// Bad (never do this)
await prismaClient.$queryRawUnsafe<...>(`SELECT ... LIMIT ${limit}`);
```

### Rate Limiting

Two-layer protection:

```typescript
// Layer 1: Slow-down (progressive delays)
await instance.register(slowDownPlugin, {
  delayAfter: 100,
  delay: '100ms',
  timeWindow: '1 minute',
});

// Layer 2: Hard limit
await instance.register(fastifyRateLimit, {
  max: 200,
  timeWindow: '1 minute',
  redis, // Redis-backed for multi-instance
});
```

## Input Validation Rules

| Field                      | Constraints                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `unifiedId`                | 1-64 chars, regex `^[a-zA-Z0-9_-]+$`                                                                                    |
| `nickname`                 | 1-32 chars, regex `^[a-zA-Z0-9_]+$`                                                                                     |
| `pathCid`                  | 1-200 chars                                                                                                             |
| `keyword` / `search`       | 1-100 chars (search: min 2)                                                                                             |
| `query`                    | 2-200 chars                                                                                                             |
| `limit`                    | 1-100                                                                                                                   |
| `page`                     | ≥ 0 or ≥ 1                                                                                                              |
| `after`                    | Base64url cursor string                                                                                                 |
| `edge`                     | Enum: `uploads`, `tagged_files`, `has_license`, `contains`, `random`, `recent`, `search`, `keywords`, `profile`, `info` |
| `from.type` file variant   | `unifiedId` when `from.type` is `file`                                                                                  |
| `query`                    | 2-200 chars (required for `edge: search` or `edge: keywords`)                                                           |
| `from.type`                | Enum: `user`, `keyword`, `license`, `directory`, `root`                                                                 |
| `filter.what`              | Enum: `all`, `images`, `videos`, `files`                                                                                |
| `filter.allowedAiTraining` | Boolean (data mining permission)                                                                                        |
| `filter.allowAi`           | Boolean (exclude AI-generated files)                                                                                    |

## Development vs Production

When `isDev` is true, rate limiting and slow-down are disabled. Makes local testing easy while keeping production secure.

## Results

| Metric          | Value                         |
| --------------- | ----------------------------- |
| Tools           | 1 graph-walk + 3 leaf readers |
| Prompts         | 4                             |
| Resources       | 2                             |
| Security layers | 6                             |
| Code complexity | Low                           |
| Dependencies    | Minimal                       |
| Scalability     | Horizontal                    |

## Lessons Learned

### What Worked

Stateless mode worked great for public read-only services. Direct SDK usage meant no abstraction overhead. Defense in depth gave us multiple security layers catching different failure modes. Zod schemas acted as a single source of truth for validation and types.

The graph API was the biggest win. `traverse` alone replaced 7 specialized tools via 6 `from` types by 10 edges, cutting surface area while increasing expressiveness. The graph model maps directly to how LLMs process relationships: start at an entity, follow a relationship, get connected entities. Instead of REST endpoints with URL patterns and versioning, everything is just nodes and edges.

### What We'd Do Differently

**Stateless from day one.** We initially used stateful sessions, then switched. Would have saved the migration effort.

**Centralized error handling.** We built error responses ad-hoc and paid for it later. A single error handler from the start would have saved time.

**Tool categories.** Grouping tools would help agent discovery. Not critical with 4 tools, but worth planning for.

### The Image Rendition Chain

Here's the bug that ate an afternoon.

We discovered that `PublishedFile.fileId` is null for images. They link through `renditionId → Rendition.imageId → File` instead. Our `contains` and `tagged_files` edges only filtered through the `file` relation, so they returned zero images. A directory that should have had 200+ images returned 3 non-image files. No error, no warning. Just wrong results.

The fix was making both edges check both relation chains via Prisma `OR`:

```typescript
(where as Record<string, unknown>).OR = [
  { file: { directory: { pathCid } } },
  { rendition: { image: { directory: { pathCid } } } },
];
```

The serializer also needed a `fileData` fallback to populate metadata from either path:

```typescript
const fileData = row.file ?? row.rendition?.image ?? null;
```

Now `leanSelect` includes `rendition.image`, `serializeFileNode` falls back gracefully, and images appear in all traversal results alongside non-image files.

The lesson: database models with polymorphic relationships (where the FK can live in different places) require the query layer to follow all possible chains. A single-relation filter can silently exclude an entire category of data. If the numbers look too low, look for a missing relation path. The data is probably there. You're just not asking the right question.

### Tool Descriptions Matter for AI Agents

We watched an AI agent interact with our MCP server through a chat interface. The agent had access to `get_users` (concrete description: "look up user profiles by nickname") and `traverse` (abstract description: "graph-walk interface: from(node) → edge(relationship) → results").

The agent called `get_users(['woss'])` and got back directory names and file counts, but no actual files, URLs, or IDs to work with. Instead of calling `traverse` with `edge: 'contains'` to retrieve the real files, it fabricated ten plausible-sounding file URLs like `/@woss/windsurf/sunset-waves-7` with generic titles like "Sunset over the coastline" and "Mountain vista at dawn." The AI hallucinated an entire directory listing.

The root cause: the `traverse` tool description was written for developers. It used graph theory jargon ("from(node) → edge(relationship) → results", "leaf-reader tools", "terminates the traversal"). An AI agent reading this description couldn't connect "graph-walk interface" to "tool that retrieves files from a directory." The agent defaulted to the tool it understood (`get_users`) and filled the gaps with hallucination.

The agent chose the tool it understood, which happened to be the wrong one for the job.

We rewrote every tool description to be task-oriented with concrete examples:

Old traverse: `"Graph-walk interface: from(node) → edge(relationship) → results. Edges returning File[]: uploads, tagged_files, has_license, contains, random, recent, search, info. Non-File edges: profile (User), info from directory (Directory), keywords (Keyword[]). Use filter.what/filter.allowAI/filter.nickname to narrow. Use after cursor for pagination."`

New traverse: `"Explore files by directory, user uploads, or keyword search. Use edge:'contains' to view files inside a directory (pass pathCid from get_users). Use edge:'uploads' to list a user's recent uploads. Use edge:'tagged_files' to search by keyword. Use edge:'profile' for user info or edge:'info' for directory metadata..."`

We added an explicit cross-reference from `get_users` to `traverse`:

Old: `"Get user profiles by nickname array. Returns array of UserNode objects with avatarUrl, bio, fileCount."`

New: `"Look up user profiles by nickname. Returns user info... and directory list with pathCid and fileCount per directory. To see actual files inside a directory, use traverse with from:{type:'directory', pathCid:}, edge:'contains'."`

We also rewrote the `browse_user` prompt to lead with `get_users` (matching agent behavior) and added a CRITICAL section: "`get_users` returns directory names and file counts but NOT the actual files. You MUST call `traverse` with `edge: 'contains'` to retrieve file listings from a directory."

The lesson: tool descriptions are user-facing documentation, but the user is an AI model, not a human developer. Abstract or jargon-heavy descriptions cause AI agents to silently skip tools they don't understand, leading to hallucinated data. Write tool descriptions like task instructions: start with what the tool does in plain language, give concrete examples, and explicitly cross-reference complementary tools. An AI model that can't understand a tool description won't use it. The tool becomes invisible, and the agent's false sense of capability masks the hallucination underneath.

## Real-World Traversal Patterns

The graph model shines when traversals chain together. Here are three common walk patterns showing how an agent moves through the content graph step by step:

### Walk 1: Browse a photographer's portfolio

```plaintext
traverse({ from:{type:'user', nickname:'sarah'}, edge:'profile' })
│
├── Returns: user profile + directories
│   [{name:'landscapes', pathCid:'QmA...', fileCount:42},
│    {name:'portraits',  pathCid:'QmB...', fileCount:18}]
│
├── traverse({ from:{type:'directory', pathCid:'QmA...'}, edge:'contains', filter:{what:'images'} })
│   └── Returns: FileNode[] from landscapes directory
│
└── traverse({ from:{type:'directory', pathCid:'QmB...'}, edge:'contains', filter:{what:'images'} })
    └── Returns: FileNode[] from portraits directory
```

User to directory to files. The agent discovers albums exist (from profile), then walks into each one.

### Walk 2: Search → filter by license → inspect metadata

```plaintext
traverse({ from:{type:'root'}, edge:'search', query:'mountain landscape' })
│
├── Returns: FileNode[] matching search query
│
├── traverse({ from:{type:'license', license:'CC BY'}, edge:'has_license', filter:{what:'images'} })
│   └── Returns: CC-BY licensed images only
│
└── get_file({ unifiedId:'abc123', fields:['title','creator','license','presets'] })
    └── Returns: full file details for attribution
```

Full-text discovery, then license-filtered narrowing, then leaf-reader inspection.

### Walk 3: Random discovery → inspect → find more by same creator

```plaintext
traverse({ from:{type:'root'}, edge:'random', limit:5 })
│
├── Returns: 5 random files
│
├── get_file({ unifiedId:'xyz789', fields:['title','creator'] })
│   └── Returns: title + photographer nickname
│
└── traverse({ from:{type:'user', nickname:'woss'}, edge:'uploads' })
    └── Returns: more files by same photographer
```

Agent discovers content randomly, identifies the creator via leaf-reader, then walks the uploads edge for a complete portfolio view.

---

## Usage Examples

### Directory Traversal (Now Includes Images)

Traverse a directory to find all published files, images and non-images alike:

```javascript
const response = await mcpClient.callTool('traverse', {
  from: { type: 'directory', pathCid: 'QmDirectoryCidHere' },
  edge: 'contains',
  limit: 20,
});
```

Filter by content type:

```javascript
// Get only images from a directory
const images = await mcpClient.callTool('traverse', {
  from: { type: 'directory', pathCid: 'QmDirectoryCidHere' },
  edge: 'contains',
  filter: { what: 'images' },
  limit: 20,
});

// Get only videos from a directory
const videos = await mcpClient.callTool('traverse', {
  from: { type: 'directory', pathCid: 'QmDirectoryCidHere' },
  edge: 'contains',
  filter: { what: 'videos' },
  limit: 20,
});
```

### Keyword-Tagged Files (Now Includes Images)

Find all files tagged with a keyword:

```javascript
const tagged = await mcpClient.callTool('traverse', {
  from: { type: 'keyword', keyword: 'sunset' },
  edge: 'tagged_files',
  filter: { what: 'images' },
  limit: 20,
});
```

### File Metadata

```javascript
// Get file info
const file = await mcpClient.callTool('get_file', {
  unifiedId: 'someUnifiedId',
  fields: ['title', 'creator', 'license'],
});

// Extract technical metadata
const meta = await mcpClient.callTool('get_file_metadata', {
  unifiedId: 'someUnifiedId',
  a: ['exif', 'xmp'],
});
```

### Batch User Lookup

```javascript
const users = await mcpClient.callTool('get_users', {
  nicknames: ['sarah', 'john', 'alex'],
});
```

### Full-Text Search

```javascript
const results = await mcpClient.callTool('traverse', {
  from: { type: 'root' },
  edge: 'search',
  query: 'mountain landscape',
  limit: 10,
});
```

### Random Discovery

```javascript
const random = await mcpClient.callTool('traverse', {
  from: { type: 'root' },
  edge: 'random',
  limit: 5,
});
```

### User Profile with Directories

The profile edge now returns the user's directories alongside their profile:

```javascript
const profile = await mcpClient.callTool('traverse', {
  from: { type: 'user', nickname: 'woss' },
  edge: 'profile',
});
// profile.user.directories → [{ name: 'woss-photo', pathCid: '...', fileCount: 148 }, ...]
```

This lets agents discover which albums a user has before querying them. No need to guess directory names.

---

Building a public MCP server doesn't require complex authentication or session management. Stateless design, defense in depth, and existing tools (Zod, Prisma, Redis) got us a production-ready MCP server that's simple to maintain and scale.

The key insight: a single traversal tool with validated node-edge pairs replaces a proliferation of specialized tools, reduces the learning curve for agents, and maps directly onto how LLMs reason about relationships.

---

## Resources

- [MCP Specification](https://modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
- [Full Source Code](https://github.com/woss/macula-mcp/tree/main/src/endpoints)

---

_Built with Fastify, TypeScript, Prisma, Redis, and ❤️_
