/**
 * Multi-MCP server orchestration.
 *
 * McpManager connects to all configured MCP servers and provides
 * aggregated tool listing with collision resolution, tool execution
 * routing, and clean shutdown.
 */
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { CAT, createLogger } from '$lib/server/logger';
import type { McpServerConfig } from './config.ts';
import { toRecord } from './utils.ts';
import type { jsonSchemaValidator, JsonSchemaType, JsonSchemaValidator } from '@modelcontextprotocol/sdk/validation';

const log = createLogger(CAT.mcp);

/** @group Types */

type McpConnection = {
  client: Client;
  transport: StreamableHTTPClientTransport;
};

export type McpToolDefinition = {
  name: string;
  serverId: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type McpToolCallResult = { content: Array<{ type?: string; text?: string }> };

export type McpResourceInfo = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  serverId: string;
};

export type McpResourceContent = {
  uri: string;
  text: string;
  mimeType?: string;
};

export type McpPromptInfo = {
  name: string;
  description?: string;
  serverId: string;
};

export type McpPromptMessage = {
  role: string;
  text: string;
};

/** @group Helpers */

/**
 * Extract type/text fields from MCP content items without type casts.
 * Each item is checked at runtime for shape before field access.
 */
function parseMcpContent(content: unknown[]): Array<{ type?: string; text?: string }> {
  return content.map((item) => {
    if (typeof item !== 'object' || item === null) return {};
    return {
      type: 'type' in item && typeof item.type === 'string' ? item.type : undefined,
      text: 'text' in item && typeof item.text === 'string' ? item.text : undefined,
    };
  });
}

/**
 * Wraps native fetch to log MCP rate-limit headers from server responses.
 * Headers read: x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset,
 * x-slow-down-limit, x-slow-down-remaining.
 * Non-destructive — response passes through unchanged.
 */
function withRateLimitLogging(): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init);
    const limit = response.headers.get('x-ratelimit-limit');
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');
    const slowLimit = response.headers.get('x-slow-down-limit');
    const slowRemaining = response.headers.get('x-slow-down-remaining');
    if (limit || remaining || reset || slowLimit || slowRemaining) {
      log.debug`MCP rate-limit headers: limit=${limit} remaining=${remaining} reset=${reset} slow-limit=${slowLimit} slow-remaining=${slowRemaining}`;
    }
    return response;
  };
}

/** @group Noop JSON Schema Validator */

/**
 * No-op validator that accepts all input without validation.
 * MCP tools provide their own validation if needed — this avoids
 * the overhead of AJV or other schema validators at the manager level.
 */
class NoopValidator implements jsonSchemaValidator {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getValidator<T>(_schema: JsonSchemaType): JsonSchemaValidator<T> {
    return (input: unknown) => ({
      valid: true as const,
      // Intentional: no-op validator trusts all input as type T.
      // This `as T` is the entire point — we skip validation and accept the type assertion.
      data: input as T,
      errorMessage: undefined,
    });
  }
}

/** @group Manager */

export class McpManager {
  private connections = new Map<string, McpConnection>();
  private toolIndex = new Map<string, string>(); // resolvedName → serverId
  private toolDefs: McpToolDefinition[] = [];
  private initialized = false;

  constructor(private configs: readonly McpServerConfig[]) {}

  /* ── Connection ───────────────────────────────────────────────── */

  async init(): Promise<void> {
    const connectStart = Date.now();
    await Promise.all(
      this.configs.map(async (cfg) => {
        const connStart = Date.now();
        try {
          const client = new Client(
            { name: `woss-mcp-${cfg.id}`, version: '1.0.0' },
            { capabilities: {}, jsonSchemaValidator: new NoopValidator() },
          );

          const headers: Record<string, string> = {
            Accept: 'application/json, text/event-stream',
            ...(cfg.headers ?? {}),
          };
          if (!headers.Authorization && cfg.token) {
            headers.Authorization = `Bearer ${cfg.token}`;
          }
          if (cfg.readonly) headers['X-MCP-Readonly'] = 'true';
          if (cfg.tools) headers['X-MCP-Tools'] = cfg.tools;

          const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
            requestInit: { headers },
            fetch: withRateLimitLogging(),
          });

          await client.connect(transport);
          this.connections.set(cfg.id, { client, transport });
          log.info`init: connected ${cfg.id} in ${Date.now() - connStart}ms (${cfg.url})`;
        } catch (err) {
          log.warn`init: ${cfg.id} failed after ${Date.now() - connStart}ms — ${err instanceof Error ? err.message : String(err)}`;
        }
      }),
    );

    log.info`init: all connections done in ${Date.now() - connectStart}ms (${this.connections.size}/${this.configs.length} connected)`;

    // Mark initialized before fetching tool index so getServerStatus works even if refreshToolIndex is slow or fails
    this.initialized = true;
    await this.refreshToolIndex();
  }

  /* ── Server Status ────────────────────────────────────────────── */

  getServerStatus(): Array<{ id: string; label?: string; connected: boolean; homepage?: string }> {
    if (!this.initialized) return this.configs.map((c) => ({ id: c.id, connected: false }));
    return this.configs.map((cfg) => ({
      id: cfg.id,
      label: cfg.label,
      connected: this.connections.has(cfg.id),
      homepage: cfg.homepage,
    }));
  }

  /* ── Tool Index ───────────────────────────────────────────────── */

  private async refreshToolIndex(): Promise<void> {
    const all: McpToolDefinition[] = [];
    const nameCounts = new Map<string, number>();
    const failedServers: string[] = [];
    this.toolDefs = [];
    const start = Date.now();
    const entries = Array.from(this.connections.entries());

    await Promise.all(
      entries.map(async ([serverId, { client }]) => {
        const toolStart = Date.now();
        try {
          const cfg = this.configs.find((c) => c.id === serverId);
          const result = await client.listTools({}, cfg?.timeout ? { timeout: cfg.timeout } : {});

          for (const tool of result.tools) {
            all.push({
              name: tool.name,
              serverId,
              description: tool.description,
              inputSchema: toRecord(tool.inputSchema),
            });
            nameCounts.set(tool.name, (nameCounts.get(tool.name) ?? 0) + 1);
          }
          log.info`listTools: ${serverId} — ${result.tools.length} tools in ${Date.now() - toolStart}ms`;
        } catch (err) {
          log.warn`listTools: ${serverId} failed after ${Date.now() - toolStart}ms — ${err instanceof Error ? err.message : String(err)}`;
          failedServers.push(serverId);
        }
      }),
    );

    // Remove failed servers
    for (const sid of failedServers) {
      this.connections.delete(sid);
    }

    // Build tool index with collision resolution
    this.toolIndex.clear();
    for (const tool of all) {
      const needsPrefix = (nameCounts.get(tool.name) ?? 0) > 1;
      const resolvedName = needsPrefix ? `${tool.serverId}_${tool.name}` : tool.name;
      this.toolIndex.set(resolvedName, tool.serverId);
      this.toolDefs.push({ ...tool, name: resolvedName });
    }

    log.info`refreshToolIndex: ${this.toolDefs.length} tools from ${this.connections.size} servers in ${Date.now() - start}ms`;
  }

  /* ── Tool Listing ─────────────────────────────────────────────── */

  listAllTools(): McpToolDefinition[] {
    return this.toolDefs;
  }

  /* ── Reconnect ─────────────────────────────────────────────────── */

  /**
   * Reconnect to any configured servers not currently connected, then refresh tool index.
   * Useful after transient failures like listTools timeouts that left servers in a dead state.
   */
  async reconnectTools(): Promise<void> {
    const connectedIds = new Set(this.connections.keys());
    const toReconnect = this.configs.filter((cfg) => !connectedIds.has(cfg.id));

    if (toReconnect.length === 0) {
      log.debug`reconnectTools: all servers already connected`;
      return;
    }

    log.info`reconnectTools: attempting ${toReconnect.length} servers: ${toReconnect.map((c) => c.id).join(', ')}`;
    const start = Date.now();

    await Promise.all(
      toReconnect.map(async (cfg) => {
        const connStart = Date.now();
        try {
          const client = new Client(
            { name: `woss-mcp-${cfg.id}`, version: '1.0.0' },
            { capabilities: {}, jsonSchemaValidator: new NoopValidator() },
          );
          const headers: Record<string, string> = {
            Accept: 'application/json, text/event-stream',
            ...(cfg.headers ?? {}),
          };
          if (!headers.Authorization && cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
          if (cfg.readonly) headers['X-MCP-Readonly'] = 'true';
          if (cfg.tools) headers['X-MCP-Tools'] = cfg.tools;
          const transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
            requestInit: { headers },
            fetch: withRateLimitLogging(),
          });
          await client.connect(transport);
          this.connections.set(cfg.id, { client, transport });
          log.info`reconnectTools: ${cfg.id} reconnected in ${Date.now() - connStart}ms`;
        } catch (err) {
          log.warn`reconnectTools: ${cfg.id} failed after ${Date.now() - connStart}ms — ${err instanceof Error ? err.message : String(err)}`;
        }
      }),
    );

    log.info`reconnectTools: ${this.connections.size} connected (attempted ${toReconnect.length}) in ${Date.now() - start}ms`;

    if (this.connections.size > 0) {
      await this.refreshToolIndex();
    }
    log.info`reconnectTools: complete — ${this.connections.size} servers, ${this.toolDefs.length} tools`;
  }

  /* ── Resources ────────────────────────────────────────────────── */

  async listAllResources(): Promise<McpResourceInfo[]> {
    const all: McpResourceInfo[] = [];
    for (const [serverId, { client }] of this.connections) {
      try {
        const result = await client.listResources();
        for (const resource of result.resources) {
          all.push({
            uri: resource.uri,
            name: resource.name,
            description: resource.description,
            mimeType: resource.mimeType,
            serverId,
          });
        }
      } catch (err) {
        log.debug`listResources failed for ${serverId}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    return all;
  }

  /** Read a specific resource by URI, optionally scoped to a server.
   * @param uri - Resource URI to read
   * @param serverId - When provided, queries only that server
   * @returns Resource content or null when not found
   */
  async readResource(uri: string, serverId?: string): Promise<McpResourceContent | null> {
    if (serverId) {
      const conn = this.connections.get(serverId);
      if (!conn) return null;
      try {
        const result = await conn.client.readResource({ uri });
        for (const content of result.contents) {
          if ('text' in content) {
            return { uri: content.uri, text: content.text, mimeType: content.mimeType };
          }
        }
      } catch (err) {
        log.debug`readResource failed for ${uri} on ${serverId}: ${err instanceof Error ? err.message : String(err)}`;
      }
      return null;
    }
    for (const [sid, { client }] of this.connections) {
      try {
        const result = await client.readResource({ uri });
        for (const content of result.contents) {
          if ('text' in content) {
            return { uri: content.uri, text: content.text, mimeType: content.mimeType };
          }
        }
      } catch (err) {
        log.debug`readResource failed for ${uri} on ${sid}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    return null;
  }

  /* ── Prompts ──────────────────────────────────────────────────── */

  async listAllPrompts(): Promise<McpPromptInfo[]> {
    const all: McpPromptInfo[] = [];
    for (const [serverId, { client }] of this.connections) {
      try {
        const result = await client.listPrompts();
        for (const prompt of result.prompts) {
          all.push({
            name: prompt.name,
            description: prompt.description,
            serverId,
          });
        }
      } catch (err) {
        log.debug`listPrompts failed for ${serverId}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    return all;
  }

  /** Get a specific prompt by name, optionally scoped to a server.
   * @param name - Prompt name
   * @param serverId - When provided, queries only that server
   * @returns Array of prompt messages
   */
  async getPrompt(name: string, serverId?: string): Promise<McpPromptMessage[]> {
    if (serverId) {
      const conn = this.connections.get(serverId);
      if (!conn) return [];
      try {
        const result = await conn.client.getPrompt({ name });
        return result.messages.map((m) => ({
          role: m.role,
          text: m.content.type === 'text' ? m.content.text : '',
        }));
      } catch (err) {
        log.debug`getPrompt failed for ${name} on ${serverId}: ${err instanceof Error ? err.message : String(err)}`;
      }
      return [];
    }
    for (const [sid, { client }] of this.connections) {
      try {
        const result = await client.getPrompt({ name });
        return result.messages.map((m) => ({
          role: m.role,
          text: m.content.type === 'text' ? m.content.text : '',
        }));
      } catch (err) {
        log.debug`getPrompt failed for ${name} on ${sid}: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    return [];
  }

  /* ── Tool Execution ───────────────────────────────────────────── */

  /** Execute a tool by its resolved name (may include serverId prefix for collision resolution).
   * @param resolvedName - Tool name, optionally prefixed with serverId_
   * @param args - Tool arguments
   * @returns Tool execution result with content items
   */
  async executeTool(resolvedName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const serverId = this.toolIndex.get(resolvedName);
    if (!serverId) throw new Error(`Unknown tool: ${resolvedName}`);

    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`Server not connected: ${serverId}`);

    // Strip prefix to get original tool name
    const originalName = this.stripPrefix(resolvedName, serverId);

    const start = Date.now();
    log.info('Executing MCP tool', { tool: resolvedName, serverId });
    const cfg = this.configs.find((c) => c.id === serverId);
    const toolTimeout = cfg?.timeout ?? 60_000;

    let timeoutHandle!: ReturnType<typeof setTimeout>;
    let result: { content: Array<Record<string, unknown>>; isError?: boolean };
    try {
      const callToolPromise = conn.client.callTool({ name: originalName, arguments: args });
      // Swallow orphan rejection if timeout wins (prevents unhandledRejection crash)
      callToolPromise.catch(() => {});
      result = await Promise.race([
        callToolPromise,
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`MCP callTool timed out after ${toolTimeout}ms for ${resolvedName}`)),
            toolTimeout,
          );
        }),
      ]);
      clearTimeout(timeoutHandle);
    } catch (err) {
      clearTimeout(timeoutHandle);
      throw err;
    }

    const durationMs = Date.now() - start;
    log.info('MCP tool completed', {
      tool: resolvedName,
      serverId,
      durationMs,
      isError: result.isError,
      contentLength: result.content.length,
    });

    let contentItems = parseMcpContent(result.content);
    if (result.isError) {
      const errText = contentItems
        .filter((c) => c.type === 'text')
        .map((c) => c.text || '')
        .join(' | ');
      contentItems = [{ type: 'text', text: `Tool returned an error: ${errText || 'Unknown error'}` }];
      log.debug`[mcp/manager] executeTool ${resolvedName} ERROR: ${errText || 'Unknown error'}`;
    } else if (contentItems.length === 0) {
      contentItems = [{ type: 'text', text: `Tool "${resolvedName}" returned no output.` }];
    }

    return { content: contentItems };
  }

  /* ── Helpers ──────────────────────────────────────────────────── */

  /**
   * Strip the serverId prefix from a resolved tool name.
   * e.g. "github_get_me" → "get_me" when serverId is "github"
   */
  private stripPrefix(resolvedName: string, serverId: string): string {
    const prefix = `${serverId}_`;
    if (resolvedName.startsWith(prefix)) {
      return resolvedName.slice(prefix.length);
    }
    return resolvedName;
  }

  /* ── System Prompt ────────────────────────────────────────────── */

  getSystemPrompt(): string {
    const parts: string[] = [];
    for (const serverId of this.connections.keys()) {
      const toolsForServer = this.toolDefs.filter((t) => t.serverId === serverId);
      parts.push(`[${serverId}] MCP tools: ${toolsForServer.map((t) => t.name).join(', ')}.`);
    }
    return parts.join('\n');
  }

  /* ── Shutdown ─────────────────────────────────────────────────── */

  async disconnectAll(): Promise<void> {
    for (const [serverId, { transport }] of this.connections) {
      try {
        await transport.close();
        log.debug`disconnected: ${serverId}`;
      } catch (e) {
        log.warn`Failed to disconnect MCP server ${serverId}: ${e}`;
      }
    }
    this.connections.clear();
    this.toolIndex.clear();
    this.toolDefs = [];
  }
}
