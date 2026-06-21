# MCP Flow & LLM Processing in opencode

> Comprehensive research document covering MCP configuration, runtime, tool integration, session processing, and LLM provider transforms.

## 1. MCP Configuration Schema

**File:** `packages/opencode/src/config/mcp.ts` (60 lines)

Defines two MCP server types using Effect Schema:

### Local (`McpLocalConfig`)

- `type: "local"` — runs a subprocess
- `command: string[]` — command and arguments
- `environment?` — env vars for subprocess
- `enabled?: boolean` — disable on startup
- `timeout?: PositiveInt` — per-request timeout in ms (default 5000)

### Remote (`McpRemoteConfig`)

- `type: "remote"` — connects via URL
- `url: string` — server URL
- `enabled?: boolean`
- `headers?` — HTTP headers
- `oauth?: OAuth | false` — OAuth config or explicit disable
- `timeout?: PositiveInt`

### OAuth (`McpOAuthConfig`)

- `clientId?` — if omitted, attempts RFC 7591 dynamic registration
- `clientSecret?`
- `scope?`
- `callbackPort?` — default 19876
- `redirectUri?` — default `http://127.0.0.1:19876/mcp/oauth/callback`

---

## 2. MCP Runtime — Client Management

**File:** `packages/opencode/src/mcp/index.ts` (981 lines)

### Architecture

- **Service class**: `MCP.Service` — Effect service (`@opencode/MCP`)
- **State**: `InstanceState.make<State>` — config, status, clients, defs per-project
- **Layer**: `MCP.layer` → depends on `McpAuth`, `Bus`, `Config`, `CrossSpawnSpawner`, `AppFileSystem`
- **Default layer**: `MCP.defaultLayer` composes all above

### Client Creation (`create`)

1. **Disabled check** — `mcp.enabled === false` returns `DISABLED_RESULT`
2. **Type dispatch**:
   - **`connectLocal`** — creates `StdioClientTransport` with command, args, cwd (from `InstanceState.directory`), env (merges `process.env`, `BUN_BE_BUN=1` if command is `opencode`, custom env)
   - **`connectRemote`** — tries `StreamableHTTPClientTransport` first, falls back to `SSEClientTransport`. Both pass `authProvider` (OAuth) and optional headers
3. **Transport connection**: `connectTransport()` — `acquireUseRelease` pattern, uses `withTimeout(client.connect(t), timeout)`. On failure, closes transport. On success, returns client
4. **Tool listing**: `listTools(key, client, timeout)` — calls `client.listTools()`, retries with tolerant schema if output schema validation fails
5. **Caching**: Tools cached in `state.defs[name]`, clients in `state.clients[name]`

### Tool Conversion (`convertMcpTool`)

**File:** `packages/opencode/src/mcp/index.ts` (lines 158–186)

Converts raw MCP tool definitions into AI SDK `dynamicTool`:

```typescript
function convertMcpTool(mcpTool: MCPToolDef, client: MCPClient, timeout?: number): Tool {
  const schema: JSONSchema7 = {
    ...(inputSchema as JSONSchema7),
    type: 'object',
    properties: inputSchema.properties ?? {},
    additionalProperties: false,
  };
  return dynamicTool({
    description: mcpTool.description ?? '',
    inputSchema: jsonSchema(schema),
    execute: async (args: unknown) => {
      return client.callTool(
        {
          name: mcpTool.name,
          arguments: (args || {}) as Record<string, unknown>,
        },
        CallToolResultSchema,
        { resetTimeoutOnProgress: true, timeout },
      );
    },
  });
}
```

Key points:

- Forces `type: "object"` and `additionalProperties: false`
- Tool name is NOT sanitized here (sanitization happens at call site)
- `resetTimeoutOnProgress: true` keeps long-running tools alive
- Default timeout: `DEFAULT_TIMEOUT = 30_000`

### Tool Assembly (`tools()`)

**File:** `packages/opencode/src/mcp/index.ts` (lines 670–703)

- Filters connected clients from `state.status`
- Iterates over `state.clients` + `state.defs` (cached tool defs)
- Keyed by `sanitize(clientName) + "_" + sanitize(mcpTool.name)`
  - `sanitize()` replaces `/[^a-zA-Z0-9_-]/g` with `_`
- Each tool uses `convertMcpTool(mcpTool, client, timeout)`
- Timeout per-tool: `entry?.timeout ?? defaultTimeout` (where `defaultTimeout` comes from `cfg.experimental?.mcp_timeout`)

### Status & Lifecycle

Six statuses (Effect Schema discriminated union on `status`):
| Status | Meaning |
|--------|---------|
| `"connected"` | Client connected, tools available |
| `"disabled"` | Server has `enabled: false` |
| `"failed"` | Error with message string |
| `"needs_auth"` | Remote server requires OAuth |
| `"needs_client_registration"` | Server needs pre-registered `clientId` |

Other methods:

- `add(name, mcp)` — adds to state + creates/stores client
- `connect(name)` — enables + reconnects
- `disconnect(name)` — closes client
- `getPrompt(clientName, name, args?)` — proxies to MCP SDK
- `readResource(clientName, uri)` — proxies to MCP SDK
- `startAuth / authenticate / finishAuth / removeAuth` — OAuth flow

### OAuth Flow

1. `startAuth()` — creates `StreamableHTTPClientTransport` with `McpOAuthProvider`, captures redirect URL
2. Opens browser to authorization URL via `open` npm package
3. `McpOAuthCallback.waitForCallback(oauthState, mcpName)` — waits for callback on local HTTP server
4. `finishAuth(authorizationCode)` — calls `transport.finishAuth(code)`, then `createAndStore()` to reconnect and cache tools
5. CSRF protection via OAuth state comparison

### Cleanup

On instance disposal (`Effect.addFinalizer`):

- Finds all descendant PIDs via `pgrep -P` recursively
- Sends `SIGTERM` to all descendants
- Closes all MCP clients
- Clears pending OAuth transport map

---

## 3. Tool Resolution — Session Level

**File:** `packages/opencode/src/session/tools.ts`

`resolve()` combines tools from multiple sources:

1. **Built-in tools** (from `ToolRegistry`) — core opencode tools
2. **MCP tools** — from `MCP.Service.tools()` (the `tools()` method above)
3. **Wrapping** — each tool is wrapped with:
   - Permission checks
   - Plugin hooks
   - Truncation logic

Result: a flat `Record<string, Tool>` passed to the LLM runtime.

---

## 4. LLM Request Pipeline

### Request Preparation

**File:** `packages/opencode/src/session/llm/request.ts`

`prepare()`:

- Merges system prompts
- Resolves model parameters from config
- Filters tools by permissions
- Handles Copilot `_noop` tool edge case

### Runtime Selection

**File:** `packages/opencode/src/session/llm.ts`

- **Native runtime** (`native-runtime.ts`): used for OpenAI/Anthropic/opencode providers with direct API keys
- **AI SDK runtime**: for all other providers (Groq, Ollama, Google, etc.)
- `streamText()` at line 272 with prepared tools
- `experimental_repairToolCall` for case-insensitive tool name matching
- `wrapLanguageModel` middleware applies `ProviderTransform.message` from `provider/transform.ts`

### AI SDK → LLMEvent Conversion

**File:** `packages/opencode/src/session/llm/ai-sdk.ts`

`toLLMEvents()` converts AI SDK `fullStream` events into `@opencode-ai/llm` LLMEvent types:

| AI SDK Event                 | LLMEvent                     |
| ---------------------------- | ---------------------------- |
| `text` delta                 | `text` delta                 |
| `reasoning`                  | `reasoning`                  |
| `tool-input` start/delta/end | `tool-input-start/delta/end` |
| `tool-call`                  | `tool-call`                  |
| `tool-result`                | `tool-result`                |

### Native Runtime (Direct Provider APIs)

**File:** `packages/opencode/src/session/llm/native-runtime.ts`

- Gate: only OpenAI/Anthropic/opencode providers with API keys
- `nativeTools()` bridges AI SDK `Tool.execute` into `@opencode-ai/llm` tool format
- Bypasses AI SDK, calls provider APIs directly

**File:** `packages/opencode/src/session/llm/native-request.ts`

- Lowers AI SDK `ModelMessage` into `@opencode-ai/llm` `LLMRequest` format
- Maps SDK package names to internal provider IDs

---

## 5. Session Processor — Event Loop

**File:** `packages/opencode/src/session/processor.ts`

Handles LLMEvent types in a stateful loop:

| Event                        | Handler                                         |
| ---------------------------- | ----------------------------------------------- |
| `reasoning`                  | Accumulates reasoning text                      |
| `tool-input-start/delta/end` | Tracks tool input construction                  |
| `tool-call`                  | Doom loop detection (infinite tool call cycles) |
| `tool-result`                | Image normalization for multimodal results      |
| `tool-error`                 | Error propagation                               |
| `text`                       | Text delta accumulation and display             |
| `step-start/finish`          | Step boundary tracking                          |

---

## 6. Provider Transforms

**File:** `packages/opencode/src/provider/transform.ts`

Provider-specific message transforms applied via `wrapLanguageModel` middleware:

| Provider              | Transform                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Anthropic**         | Filters empty parts from messages; adds cache headers via `applyCaching()`                                                      |
| **Claude (obsolete)** | Scrubs `toolCallId` values with underscore prefix                                                                               |
| **Mistral**           | Sets `toolCallId` to 9 characters (Mistral constraint)                                                                          |
| **DeepSeek**          | Forces empty reasoning part on every assistant turn; strips reasoning into `providerOptions.openaiCompatible.reasoning_content` |
| **All**               | `unsupportedParts()` — filters unsupported modalities per model                                                                 |
| **All**               | `variants()` — creates reasoning_effort tiers based on config                                                                   |
| **Moonshot / Gemini** | `schema()` — adjusts JSON Schema for compatibility                                                                              |

---

## 7. LLM Protocols — OpenAI Chat Protocol

**File:** `packages/llm/src/protocols/openai-chat.ts`

### Body Schema (`OpenAIChatBody`)

- Defines the request body structure for OpenAI-compatible endpoints
- Includes standard fields: messages, tools, tool_choice, stream, temperature, etc.

### Request Lowering (`fromRequest`)

- Converts internal `LLMRequest` into OpenAI-compatible `OpenAIChatBody`

### Stream Parsing

State machine that processes SSE events from streaming responses:

- `delta.content` and `delta.tool_calls` processed independently
- `finishEvents` overrides `finish_reason "stop"` → `"tool-calls"` when tool calls are accumulated
- `ToolStream` accumulates partial tool call deltas

### DeepSeek-Specific Behavior

- In `openai-chat.ts`: no hacks — DeepSeek is treated as standard OpenAI-compatible
- In `transform.ts`: forces empty reasoning part on every assistant turn
- Strips reasoning content into `providerOptions.openaiCompatible.reasoning_content`

### Shared Utilities

**File:** `packages/llm/src/protocols/shared.ts`

- `parseJson` — safe JSON parsing
- `parseToolInput` — converts empty string to `"{}"` for tool calls with no input
- `sseFraming` — SSE encoding/decoding
- `matchToolChoice` — maps tool_choice values
- Token counting helpers

### Protocol Type Definition

**File:** `packages/llm/src/route/protocol.ts`

- `Protocol` type: `body.schema` + `body.from` + `stream.event` + `stream.step` + `stream.initial` + `stream.onHalt`
- `jsonEvent()` — SSE event decode helper

---

## 8. Complete Tool Call Flow

```
User Message
    │
    ▼
SessionProcessor
    │
    ▼
session/tools.ts:resolve()
    ├── Built-in tools (ToolRegistry)
    └── MCP tools (MCP.Service.tools())
           │
           ▼
session/llm/request.ts:prepare()
    ├── Merge system prompts
    ├── Resolve model params
    ├── Filter tools by permissions
    └── Edge cases (Copilot _noop)
           │
           ▼
session/llm.ts:streamText()
    ├── Select runtime: native vs AI SDK
    ├── Attach tools to request
    ├── experimental_repairToolCall (case-insensitive names)
    └── wrapLanguageModel (ProviderTransform)
           │
           ▼
AI SDK / Native Runtime
    │
    ├── AI SDK: fullStream events
    │   │
    │   ▼
    │   LLMAISDK.toLLMEvents()
    │       ├── text → text
    │       ├── reasoning → reasoning
    │       ├── tool-input → tool-input-start/delta/end
    │       ├── tool-call → tool-call
    │       └── tool-result → tool-result
    │
    └── Native: direct provider API calls
            │
            ▼
session/processor.ts:handleEvent()
    ├── reasoning blocks
    ├── tool input tracking
    ├── doom loop detection
    ├── image normalization
    ├── text accumulation
    └── step boundaries
```

---

## 9. Key File Index

| File                                                  | Purpose                                                  |
| ----------------------------------------------------- | -------------------------------------------------------- |
| `packages/opencode/src/config/mcp.ts`                 | MCP config schema (Local/Remote/OAuth)                   |
| `packages/opencode/src/mcp/index.ts`                  | MCP runtime: client creation, tool conversion, lifecycle |
| `packages/opencode/src/mcp/oauth-provider.ts`         | MCP OAuth provider                                       |
| `packages/opencode/src/mcp/oauth-callback.ts`         | OAuth callback HTTP server                               |
| `packages/opencode/src/mcp/auth.ts`                   | MCP auth credential storage                              |
| `packages/opencode/src/session/tools.ts`              | Tool resolution: built-in + MCP                          |
| `packages/opencode/src/session/llm.ts`                | LLM runtime: streamText, tool repair, middleware         |
| `packages/opencode/src/session/llm/request.ts`        | Request preparation: system prompts, tool filtering      |
| `packages/opencode/src/session/llm/ai-sdk.ts`         | AI SDK → LLMEvent conversion                             |
| `packages/opencode/src/session/llm/native-runtime.ts` | Native runtime for OpenAI/Anthropic                      |
| `packages/opencode/src/session/llm/native-request.ts` | Native request lowering                                  |
| `packages/opencode/src/session/processor.ts`          | Session event loop processing                            |
| `packages/opencode/src/provider/transform.ts`         | Provider-specific message transforms                     |
| `packages/llm/src/protocols/openai-chat.ts`           | OpenAI chat protocol body, request, stream parsing       |
| `packages/llm/src/protocols/shared.ts`                | Shared protocol utilities                                |
| `packages/llm/src/route/protocol.ts`                  | Protocol type definition                                 |
