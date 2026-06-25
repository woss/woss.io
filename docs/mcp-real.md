# LLM Tool Calling: Two-Phase Refactor

## Problem

The model (`big-pickle` / `deepseek-v4-flash`) generates `<｜｜DSML｜｜tool_calls>` / `<｜｜DSML｜｜invoke>` XML in the SSE content stream — even without a `tools` param — because it imitates tool-call patterns from conversation history. Current defense is 4 layers of regex stripping that still leaks XML to the user.

## Phase Overview

| Phase | Title                                          | Status  |
| ----- | ---------------------------------------------- | ------- |
| 1     | LLM Streaming Refactor + MCP Hardening         | Done    |
| 2     | Multi-MCP Architecture (opencode-style config) | Pending |

---

# Phase 1: LLM Streaming Refactor + MCP Hardening

## Stack Decision

| Layer               | Choice                      | Rationale                                       |
| ------------------- | --------------------------- | ----------------------------------------------- |
| HTTP streaming      | Vercel AI SDK (`ai`)        | Typed `onChunk` events per tool/text/reasoning  |
| Provider            | `@ai-sdk/openai`            | OpenAI-compatible (`zen/v1`)                    |
| Event orchestration | Effect.ts                   | `Stream<LLMEvent>` — typed discriminated union  |
| Tool execution      | Vercel AI SDK `maxSteps`    | Auto multi-round: tool-call → result → continue |
| MCP                 | `@modelcontextprotocol/sdk` | Already present, unchanged                      |

**Not using**: Effect `Layer`/`Context` DI — too much overhead for our simple config. Effect `Effect`/`Stream`/`Schema` only.

## What's Done

The streaming refactor is complete:

- `streamText` from Vercel AI SDK replaces raw fetch + SSE
- Effect.ts `Stream<LLMEvent>` for typed event streaming
- `buildToolSet()` converts MCP tools to AI SDK `ToolSet` format
- `maxSteps: 5` for multi-round tool execution
- `onChunk` emits `text-delta`, `tool-call`, `tool-result`, `reasoning-delta` events
- Tool descriptions improved with usage guidance per tool
- Tools filtered from 43 → 20 (Q&A-relevant read-only only)
- System prompt updated: "Start with context, use tools if lacking" (resolves contradiction)
- Tool selection hierarchy and workflow guide in system prompt
- Empty answer detection + retry with stronger instruction
- UI XML strip for legacy entries
- DB cleanup of XML-tainted entries

### Dependencies

| Package            | Current | Add/Remove | Why                                      |
| ------------------ | ------- | ---------- | ---------------------------------------- |
| `ai`               | —       | Add        | Vercel AI SDK core — `streamText`        |
| `@ai-sdk/openai`   | —       | Add        | OpenAI-compatible provider               |
| `@ai-sdk/provider` | —       | Add        | Provider interface types                 |
| `@ai-sdk/vercel`   | —       | Add        | Vercel integration                       |
| `effect`           | —       | Add        | Effect.ts — `Effect`, `Stream`, `Schema` |
| `partial-json`     | —       | Add        | Streaming JSON parser for tool call args |
| `openai`           | ^6.39.0 | Remove     | Replaced by Vercel AI SDK                |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  startGeneration (ask/+server.ts)                       │
│  ┌──────────────────────────────────────────────────┐   │
│  │  RAG  →  cache check  →  LLM call  →  save       │   │
│  └──────────────────────────────────────────────────┘   │
│                            │                             │
│                            ▼                             │
│  LLMEvent Stream (Effect.ts Stream<LLMEvent>)            │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Stream.async wraps Vercel AI SDK streamText      │   │
│  │  onChunk → emit.single({ type, ... })             │   │
│  │                                                   │   │
│  │  ┌─ text-delta ──→ publishLive('token') ───────┐  │   │
│  │  ├─ reasoning-delta ─→ publishLive('reasoning') │  │   │
│  │  ├─ tool-call ──→ execute → tool-result ──────┤  │   │
│  │  └─ finish ──→ save to DB, store cache ────────┘  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Files to Change

| File                                         | Change                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/lib/server/openai-provider.ts`          | Add doom loop guard, step boundary tracking, maxSteps=5→2                       |
| `src/lib/server/mcp/tools.ts`                | Add tool allowlist filtering (done), add tool selection hierarchy prompt (done) |
| `src/routes/api/ask/+server.ts`              | Keep empty-answer retry (done)                                                  |
| `src/routes/chat/[id]/+page.svelte`          | Remove stripToolCallXml after legacy entries settled                            |
| `src/content/experience/anagolay-network.md` | Remove Grants & Funding section once doom loop fixed                            |
| `package.json`                               | Already updated — deps added in previous refactor                               |

### Files That Stay Untouched

| File                                 | Reason                                 |
| ------------------------------------ | -------------------------------------- |
| `src/lib/server/mcp/client.ts`       | MCP transport unchanged                |
| `src/lib/server/mcp/tools.ts`        | Tools stay; convert format at boundary |
| `src/lib/server/llm-cache.ts`        | Runs BEFORE LLM call                   |
| `src/lib/server/chat-events.ts`      | Pub/sub unchanged                      |
| `src/routes/api/ask/[id]/+server.ts` | SSE endpoint unchanged                 |
| `src/lib/server/embed.ts`            | Embeddings unchanged                   |
| `src/lib/server/db.ts`               | DB unchanged                           |
| `src/lib/chat/send.ts`               | Client sender unchanged                |

## Code

### `src/lib/server/llm/types.ts`

```typescript
export type LLMEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'tool-input-delta'; id: string; name: string; text: string }
  | { type: 'tool-call'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; name: string; result: unknown }
  | { type: 'tool-error'; id: string; name: string; message: string }
  | { type: 'step-finish'; reason: FinishReason; usage?: TokenUsage }
  | { type: 'finish'; reason: FinishReason; usage?: TokenUsage };

export type FinishReason = 'stop' | 'tool-calls' | 'error' | 'length' | 'unknown';

export type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
};
```

### `src/lib/server/llm/provider.ts`

```typescript
import { createOpenAICompatible } from '@ai-sdk/openai';

import { config } from '$lib/server/config';

export const zen = createOpenAICompatible({
  name: 'zen',
  baseURL: config.openaiBaseUrl,
  apiKey: config.openaiApiKey,
});

export const zenModel = config.openaiModel;
```

### `src/lib/server/openai-provider.ts` — Stream version

```typescript
import { Effect, Stream } from 'effect';
import { streamText } from 'ai';
import type { CoreMessage, ToolSet } from 'ai';

import { zen, zenModel } from './llm/provider';
import type { LLMEvent } from './llm/types';
import type { ChatMessage } from '$lib/chat/types';

function toCoreMessages(messages: ChatMessage[]): CoreMessage[] {
  return messages.map((m) => ({
    role: m.role as CoreMessage['role'],
    content: m.content,
  }));
}

export function chatStream(messages: ChatMessage[], signal?: AbortSignal): Stream.Stream<LLMEvent> {
  return Stream.async<LLMEvent>((emit) => {
    const result = streamText({
      model: zen(zenModel),
      messages: toCoreMessages(messages),
      temperature: 0,
      abortSignal: signal,
      providerOptions: {
        openai: { reasoning_effort: 'high' },
      },
      onChunk: ({ chunk }) => {
        switch (chunk.type) {
          case 'text-delta':
            emit.single({ type: 'text-delta', text: chunk.text });
            break;
          case 'reasoning':
            emit.single({ type: 'reasoning-delta', text: chunk.text as string });
            break;
        }
      },
      onFinish: ({ usage, finishReason }) => {
        emit.single({
          type: 'finish',
          reason: finishReason as LLMEvent['finish']['reason'],
          usage: usage
            ? {
                inputTokens: usage.promptTokens,
                outputTokens: usage.completionTokens,
                totalTokens: usage.totalTokens,
              }
            : undefined,
        });
        emit.end();
      },
      onError: (error) => {
        emit.fail(new Error(String(error)));
      },
    });
  });
}

export function chatStreamWithTools(
  messages: ChatMessage[],
  tools: ToolSet,
  signal?: AbortSignal,
): Stream.Stream<LLMEvent> {
  return Stream.async<LLMEvent>((emit) => {
    streamText({
      model: zen(zenModel),
      messages: toCoreMessages(messages),
      tools,
      maxSteps: 5,
      temperature: 0,
      abortSignal: signal,
      providerOptions: {
        openai: { reasoning_effort: 'high' },
      },
      onChunk: ({ chunk }) => {
        switch (chunk.type) {
          case 'text-delta':
            emit.single({ type: 'text-delta', text: chunk.text });
            break;
          case 'reasoning':
            emit.single({ type: 'reasoning-delta', text: chunk.text as string });
            break;
          case 'tool-call':
            emit.single({
              type: 'tool-input-delta',
              id: chunk.toolCallId,
              name: chunk.toolName,
              text: chunk.argsText,
            });
            break;
          case 'tool-result':
            emit.single({
              type: 'tool-result',
              id: chunk.toolCallId,
              name: chunk.toolName,
              result: chunk.result,
            });
            break;
        }
      },
      onFinish: ({ usage, finishReason }) => {
        emit.single({
          type: 'finish',
          reason: finishReason as LLMEvent['finish']['reason'],
          usage: usage
            ? {
                inputTokens: usage.promptTokens,
                outputTokens: usage.completionTokens,
                totalTokens: usage.totalTokens,
              }
            : undefined,
        });
        emit.end();
      },
      onError: (error) => {
        emit.fail(new Error(String(error)));
      },
    });
  });
}
```

## Remaining Phase 1 Work (MCP Hardening)

- [x] **Doom loop guard** — detect when last N steps produced only tool calls (no text). Cut loop, re-prompt with "you have data, synthesize." (`openai-provider.ts:chatStreamWithTools`) [High]
- [x] **Step boundary tracking** — emit `step-finish` event with tool-call-count + text-produced flag (`openai-provider.ts:onChunk/onFinish`) [High]
- [x] **maxSteps=5→2** — reduce tool call rounds (`openai-provider.ts:261`) [High]
- [x] **Force text after tool-only steps** — in onFinish, if tool-calls-made but no-text-produced, retry with synthesize instruction (`openai-provider.ts:onFinish`) [High]
- [x] **Remove UI XML strip** — stripToolCallXml no longer needed once legacy DB entries settled (`+page.svelte`) [Low]
- [x] **Revert RAG grant data** — remove `## Grants & Funding` from anagolay-network.md, rebuild index (`anagolay-network.md`) [Medium]
- [x] **Add PR query example to prompt** — show model how to structure search_pull_requests with author/owner qualifiers (`tools.ts:getSystemPromptAddition`) [Medium]

### `src/routes/api/ask/+server.ts` — Consuming the Stream

```typescript
// Inside startGeneration(), replace the reader loop:

const stream = chatStream(messages);

await Effect.runPromise(
  Stream.runForEach(stream, (event) =>
    Effect.sync(() => {
      switch (event.type) {
        case 'text-delta':
          answerText += event.text;
          publishLive(chatId, 'token', { token: event.text });
          break;
        case 'reasoning-delta':
          reasoningText += event.text;
          break;
        case 'finish':
          // Save to DB, store cache, publish done
          break;
      }
    }),
  ),
);
```

## Why This Fixes XML Leak

The XML leak exists because the model generates `<｜｜DSML｜｜tool_calls>` XML as **content tokens** in the SSE stream. The current code uses 4 layers of regex stripping that are inherently leaky:

1. `contentBuffer` sliding window (openai-provider.ts:414-424) — holds partial XML
2. `isPotentialToolTagPrefix()` (openai-provider.ts:143) — guesses if buffer is XML
3. Post-stream regex (ask/+server.ts:296-301) — strips remaining tags
4. `stripToolCalls()` in render pipeline — strips from stored messages

With Vercel AI SDK, tool calls are **typed events** (`onChunk` with `chunk.type === 'tool-call'`) — never content tokens. The model can still output XML in text, but:

- It won't be mistaken for real tool calls (different event channel)
- It renders as visible text (user sees the XML they'd see anyway)
- No regex stripping needed — 0 layers

## Effect.ts Scope

| Pattern                     | Where                               | Why                                                 |
| --------------------------- | ----------------------------------- | --------------------------------------------------- |
| `Stream<LLMEvent>`          | Openai-provider return type         | Typed discriminated union events                    |
| `Stream.async`              | Wrapping AI SDK callbacks           | Bridges callback-based `onChunk` → Effect Stream    |
| `Effect.runPromise`         | Consuming stream in startGeneration | Run Effect in non-Effect context                    |
| `Schema` (optional)         | Tool input validation               | Type-safe tool params (like opencode's `Tool.make`) |
| NOT using `Layer`/`Context` | —                                   | Too much DI abstraction for our setup               |

## Phase 1 Verification

1. "how much were the grants?" — returns amounts via MCP tools (not RAG)
2. "what PRs in popular open source repos?" — returns actual PR list
3. "what repos do I have?" — triggers MCP tools successfully
4. No infinite tool cycles — max 2 rounds then force text
5. No XML artifacts in UI
6. Cache stores/retrieves correctly

---

# Phase 2: Multi-MCP Architecture (opencode-style)

## Problem

Currently single MCP server (GitHub Copilot). Config is hardcoded env vars (`GITHUB_TOKEN`, `GITHUB_MCP_URL`). Adding more MCP servers (e.g. Macula, filesystem, database) requires per-server env vars and manual wiring.

## Approach

Mirror opencode's MCP config pattern. Servers defined in a single JSON env var `MCP_SERVERS`:

```json
MCP_SERVERS='[
  {
    "id": "github",
    "url": "https://api.githubcopilot.com/mcp/",
    "token": "$GITHUB_TOKEN",
    "readonly": true
  },
  {
    "id": "macula",
    "url": "https://u.macula.link/mcp",
    "token": "$MACULA_TOKEN",
    "readonly": true
  }
]'
```

Env var substitution: `$VAR` placeholders resolved at load time from `process.env`.

## Design: McpManager

```
McpManager
├─ clients: Map<string, { client: Client; transport: StreamableHTTPClientTransport }>
├─ toolIndex: Map<string, string>  // toolName → serverId
├─ init() — connect ALL configured servers
├─ listAllTools() → aggregate with prefixed names on collision
├─ executeTool(name, args) → route to correct server via toolIndex
├─ getSystemPrompt() → combine per-server prompts
├─ disconnectAll() — clean shutdown
```

### Tool Name Collision

If two servers expose same tool name: prefix with server ID.

| Server | Tool        | Collision? | Resolved Name     |
| ------ | ----------- | ---------- | ----------------- |
| github | `listRepos` | No         | `listRepos`       |
| macula | `search`    | No         | `search`          |
| github | `readFile`  | Yes (both) | `github_readFile` |
| macula | `readFile`  | Yes (both) | `macula_readFile` |

Per-server system prompt appended: description of tools available from that server.

### Server Config Schema

```typescript
type McpServerConfig = {
  id: string; // unique identifier (used as prefix)
  url: string; // MCP endpoint URL
  token: string; // bearer token (env var resolved)
  readonly?: boolean; // sets X-MCP-Readonly header
  enabled?: boolean; // default true
  timeout?: number; // connection timeout ms
};
```

## Files to Change

| File                                | Change                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/lib/server/config.ts`          | Replace hardcoded `mcp.githubToken`/`mcp.githubMcpUrl` with `mcp.servers: McpServerConfig[]` |
| `src/lib/server/mcp/client.ts`      | Rewrite — single-server `McpClient` → `McpManager` with multi-server orchestration           |
| `src/lib/server/mcp/tools.ts`       | Update — tools now fetched from manager, not single client                                   |
| `src/lib/server/openai-provider.ts` | Tools passed to `streamText` come from McpManager                                            |
| `.env`                              | Add `MCP_SERVERS` JSON, remove `GITHUB_TOKEN`/`GITHUB_MCP_URL`                               |

### New Files

| File                            | Purpose                                         |
| ------------------------------- | ----------------------------------------------- |
| `src/lib/server/mcp/manager.ts` | `McpManager` class — multi-server orchestration |
| `src/lib/server/mcp/config.ts`  | `McpServerConfig` types and JSON env var parser |

## Code

### `src/lib/server/mcp/config.ts`

```typescript
export type McpServerConfig = {
  id: string;
  url: string;
  token: string;
  readonly?: boolean;
  enabled?: boolean;
  timeout?: number;
};

/**
 * Parse MCP_SERVERS JSON env var, resolving $VAR placeholders.
 */
export function parseMcpServers(raw: string | undefined): McpServerConfig[] {
  if (!raw) return [];
  const substituted = raw.replace(/\$([A-Z_][A-Z0-9_]*)/g, (_, name) => process.env[name] ?? '');
  const parsed: McpServerConfig[] = JSON.parse(substituted);
  return parsed.filter((s) => s.enabled !== false);
}
```

### `src/lib/server/mcp/manager.ts`

```typescript
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { McpServerConfig } from './config';

type McpToolDefinition = { name: string; description?: string; inputSchema?: Record<string, unknown> };

export class McpManager {
  private clients = new Map<string, { client: Client; transport: StreamableHTTPClientTransport }>();
  private toolIndex = new Map<string, string>(); // resolvedName → serverId

  constructor(private configs: McpServerConfig[]) {}

  async init(): Promise<void> {
    for (const cfg of this.configs) {
      try {
        const client = new Client({ name: `woss-mcp-${cfg.id}`, version: '1.0.0' }, { capabilities: {} });
        const headers: Record<string, string> = { Authorization: `Bearer ${cfg.token}` };
        if (cfg.readonly) headers['X-MCP-Readonly'] = 'true';
        const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
          requestInit: { headers },
          ...(cfg.timeout ? { timeout: cfg.timeout } : {}),
        });
        await client.connect(transport);
        this.clients.set(cfg.id, { client, transport });
        console.log(`MCP connected: ${cfg.id}`);
      } catch (err) {
        console.error(`MCP connect failed: ${cfg.id}`, err);
      }
    }
  }

  async listAllTools(): Promise<
    { name: string; serverId: string; description?: string; inputSchema?: Record<string, unknown> }[]
  > {
    const all: { name: string; serverId: string; description?: string; inputSchema?: Record<string, unknown> }[] = [];
    const nameCounts = new Map<string, number>();
    const toolServerMap = new Map<string, string[]>();

    for (const [serverId, { client }] of this.clients) {
      const result = await client.listTools();
      for (const tool of result.tools) {
        all.push({ name: tool.name, serverId, description: tool.description, inputSchema: tool.inputSchema });
        nameCounts.set(tool.name, (nameCounts.get(tool.name) ?? 0) + 1);
        if (!toolServerMap.has(tool.name)) toolServerMap.set(tool.name, []);
        toolServerMap.get(tool.name)!.push(serverId);
      }
    }

    // Resolve collisions: prefix with serverId if name appears in multiple servers
    this.toolIndex.clear();
    for (const tool of all) {
      const resolvedName = (nameCounts.get(tool.name) ?? 0) > 1 ? `${tool.serverId}_${tool.name}` : tool.name;
      this.toolIndex.set(resolvedName, tool.serverId);
    }

    return all.map((tool) => ({
      ...tool,
      name: (nameCounts.get(tool.name) ?? 0) > 1 ? `${tool.serverId}_${tool.name}` : tool.name,
    }));
  }

  async executeTool(resolvedName: string, args: Record<string, unknown>): Promise<unknown> {
    const serverId = this.toolIndex.get(resolvedName);
    if (!serverId) throw new Error(`Unknown tool: ${resolvedName}`);
    const entry = this.clients.get(serverId);
    if (!entry) throw new Error(`Server not connected: ${serverId}`);

    // Strip prefix for actual tool name
    const originalName =
      resolvedName.includes('_') && this.toolIndex.has(resolvedName)
        ? resolvedName.slice(serverId.length + 1)
        : resolvedName;

    const result = await entry.client.callTool({ name: originalName, arguments: args });
    return result.content;
  }

  getSystemPrompt(): string {
    const parts: string[] = [];
    for (const [serverId, { client }] of this.clients) {
      // In practice, load descriptions from config or listTools
      parts.push(`[${serverId}] MCP tools available via ${serverId}_ prefix if name collisions exist.`);
    }
    return parts.join('\n');
  }

  async disconnectAll(): Promise<void> {
    for (const [serverId, { transport }] of this.clients) {
      try {
        await transport.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    this.toolIndex.clear();
  }
}
```

### `src/lib/server/config.ts` — Updated `mcp` block

```typescript
import { parseMcpServers } from './mcp/config';

// In loadConfig():
return {
  // ... other config ...
  mcp: {
    servers: parseMcpServers(process.env.MCP_SERVERS),
  },
  // ...
};
```

### `src/lib/server/openai-provider.ts` — Tools from McpManager

```typescript
// In startGeneration(), before chatStreamWithTools:
const mcpTools = await mcpManager.listAllTools();
const tools: ToolSet = {};
for (const t of mcpTools) {
  tools[t.name] = {
    description: t.description,
    parameters: t.inputSchema as Record<string, unknown>,
    execute: async (args) => mcpManager.executeTool(t.name, args),
  };
}
const stream = chatStreamWithTools(messages, tools);
```

## Phase 2 Verification

1. Set `MCP_SERVERS` JSON in `.env` with at least one server (github)
2. Start dev server, verify connection logs
3. Ask question triggering tools — verify routing works
4. Add second test server, verify collision prefixing
5. Set `MCP_SERVERS` to empty/undefined — verify graceful fallback
6. Toggle `enabled: false` on one server — verify it's excluded

## Migration Path

1. Add `MCP_SERVERS` to `.env` while keeping `GITHUB_TOKEN`/`GITHUB_MCP_URL`
2. Update config.ts to parse `MCP_SERVERS` (fall back to hardcoded if absent)
3. Implement McpManager
4. Rewrite client.ts → manager.ts
5. Update tools.ts
6. Remove old env vars once verified
