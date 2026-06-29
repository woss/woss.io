---
published: true
title: 'v1: The MCP Server That Taught Us What Not to Do'
slug: 'macula-mcp-v1-lessons'
description: 'Production architecture for a public MCP server with stateless design, Zod validation, defense-in-depth security, rate limiting, and SQL injection prevention in production.'
date: 2026-04-25
tags:
  - macula
  - MCP
  - TypeScript
  - security
  - API design
  - production
part_of_series: macula-mcp-announcement
header_image: 'https://u.macula.link/G_6XL5TeQbS0g3SkbxyWDQ-7'
---

Model Context Protocol's becoming the standard way to connect AI agents to external data sources. When we decided to expose our Unified Link service through MCP, we ran into an unusual constraint: we needed a public, read-only MCP server that could serve AI agents without authentication while still being production-grade secure.

We already had a public API (`unified-link`) that served metadata about files, users, and keywords. We wanted AI agents to access this data through MCP, but the requirements were specific. No authentication (the data's already public). Read-only only. Production-grade rate limiting, input validation, and SQL injection protection. It needed to scale horizontally. And we wanted minimal dependencies.

Here's how we built it.

## Our Design Choices

### Direct SDK, Not Wrappers

We used `@modelcontextprotocol/sdk` directly with no wrapper libraries. That gave us full control over transport behavior, kept abstractions out of the way, and gave us direct access to the MCP spec.

### Stateless Mode

The most impactful decision was using stateless mode for session management.

```typescript
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined, // Stateless mode
});
```

Benefits: no session memory leaks, works with any number of server instances (no sticky sessions), no Redis needed for session storage, restart tolerant, simpler code.

The trade-off is that agents reinitialize after a disconnect. For a read-only public service, that's fine.

### Zod for Validation

We went with Zod for input validation. It was already in our codebase, so it was an easy choice:

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

We built multiple security layers:

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

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Agent                               │
└─────────────────────────┬─────────────────────────────────┘
                          │ JSON-RPC
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     MCP Server                               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ StreamableHTTPServerTransport (stateless)           │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Rate Limiting (slow-down + hard limit)              │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ McpServer                                          │    │
│  │  - 14 Tools                                        │    │
│  │  - 14 Prompts                                      │    │
│  │  - 1 Resource                                      │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                 │
│            ┌──────────────┴──────────────┐                  │
│            ▼                             ▼                   │
│  ┌─────────────────┐           ┌─────────────────┐          │
│  │     Redis       │           │   PostgreSQL   │          │
│  │   (cache +     │           │   (Prisma)    │          │
│  │    rate limit)  │           │                 │          │
│  └─────────────────┘           └─────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## Our 14 Tools

We exposed 14 read-only tools organized by domain:

### Files (6)

| Tool                       | Input                    | Description                                                 |
| -------------------------- | ------------------------ | ----------------------------------------------------------- |
| `get_file`                 | `unifiedId`              | Full metadata (title, description, creator, links, AI info) |
| `get_file_metadata`        | `unifiedId, a?`          | EXIF/XMP metadata                                           |
| `get_file_presets`         | `unifiedId`              | Available renditions                                        |
| `get_file_json_schema`     | N/A                      | Schema for type-safe code                                   |
| `get_metadata_json_schema` | N/A                      | Metadata schema                                             |
| `list_files_for_ai`        | `allowed, limit?, page?` | Files with AI/data mining allowed                           |

### Users (3)

| Tool                | Input                                    | Description                  |
| ------------------- | ---------------------------------------- | ---------------------------- |
| `get_user`          | `nickname`                               | User profile and directories |
| `list_user_files`   | `nickname, show?, take?, cursor?, sort?` | Paginated file listing       |
| `list_random_files` | `what, limit?`                           | Random file discovery        |

### Directories (2)

| Tool                  | Input                             | Description        |
| --------------------- | --------------------------------- | ------------------ |
| `get_directory`       | `nickname, pathCid`               | Directory metadata |
| `get_directory_files` | `nickname, pathCid, take?, page?` | Files in directory |

### Search (3)

| Tool                    | Input                    | Description         |
| ----------------------- | ------------------------ | ------------------- |
| `search_keywords`       | `search?, page?, limit?` | Search keywords     |
| `list_files_by_keyword` | `keyword`                | Files for a keyword |
| `list_files_by_license` | `license, limit?, page?` | Files by license    |

## Our 14 Prompts

We built specialized prompts for common agent workflows:

| Prompt                   | Description                       |
| ------------------------ | --------------------------------- |
| `discover_user_content`  | Explore a creator's content       |
| `content_analysis`       | Analyze file metadata and quality |
| `search_discovery`       | Find content via keywords         |
| `license_discovery`      | Find content by license type      |
| `content_curation`       | Curate content collections        |
| `rights_audit`           | Audit usage rights                |
| `rights_verification`    | Verify specific rights            |
| `rendition_optimization` | Find optimal file versions        |
| `creator_ecosystem`      | Explore creator's network         |
| `metadata_extraction`    | Extract structured metadata       |
| `random_exploration`     | Discover random content           |
| `directory_deep_dive`    | Explore directory contents        |
| `service_info`           | Get service information           |
| `data_mining_discovery`  | Find AI-friendly content          |

## One Resource

| Resource       | Description                         |
| -------------- | ----------------------------------- |
| `instructions` | Service usage guidelines for agents |

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

| Field       | Constraints                          |
| ----------- | ------------------------------------ |
| `unifiedId` | 1-64 chars, regex `^[a-zA-Z0-9_-]+$` |
| `nickname`  | 1-32 chars, regex `^[a-zA-Z0-9_]+$`  |
| `pathCid`   | 1-200 chars                          |
| `keyword`   | 1-100 chars                          |
| `limit`     | 1-100                                |
| `page`      | ≥ 0 or ≥ 1                           |

## Development vs Production

When `isDev` is true, rate limiting and slow-down are disabled. Makes local testing easy while keeping production secure.

## Results

| Metric          | Value      |
| --------------- | ---------- |
| Tools           | 14         |
| Prompts         | 14         |
| Resources       | 1          |
| Security layers | 6          |
| Code complexity | Low        |
| Dependencies    | Minimal    |
| Scalability     | Horizontal |

## Lessons Learned

### What Went Right

**Stateless mode** was perfect for public read-only services. **Direct SDK usage** meant no abstraction overhead. **Defense in depth** gave us multiple security layers. **Zod schemas** became a single source of truth for validation and types.

### What We'd Do Differently

**Stateless from day one.** We initially used stateful sessions, then switched. Would have saved the migration effort.

**Centralized error handling.** We built error responses ad-hoc and paid for it later. A single error handler from the start would have saved time.

**Tool categories.** Grouping tools would help agent discovery. Not critical with 4 tools, but worth planning for.

---

Building a public MCP server doesn't require complex authentication or session management. Stateless design, defense in depth, and existing tools (Zod, Prisma, Redis) got us a production-ready MCP server that's simple to maintain and scale.

Public, read-only MCP servers are much simpler than authenticated ones. That's the main lesson from this build. If you don't need auth, you can leave a lot of baggage behind.

---

## Resources

- [MCP Specification](https://modelcontextprotocol.io)
- [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

---

_Built with Fastify, TypeScript, Prisma, Redis, and ❤️_
