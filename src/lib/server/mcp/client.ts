/**
 * MCP client adapter.
 *
 * Wraps McpManager for backward compatibility with existing consumers.
 * Creates an McpManager from the global config and delegates all calls.
 */
import { config } from '$lib/server/config';
import { CAT, createLogger } from '$lib/server/logger';
import {
  McpManager,
  type McpToolDefinition,
  type McpToolCallResult,
  type McpResourceInfo,
  type McpResourceContent,
  type McpPromptInfo,
  type McpPromptMessage,
} from './manager.ts';

const log = createLogger(CAT.mcp);

/* ── Singleton Manager ── */

let manager: McpManager | null = null;

function getManager(): McpManager {
  if (!manager) {
    manager = new McpManager(config().mcp.servers);
  }
  return manager;
}

/* ── Client Wrapper ── */

class McpClient {
  private initPromise: Promise<void> | null = null;

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    if (config().mcp.servers.length === 0) {
      log.debug`initialize: no MCP servers configured`;
      return;
    }
    try {
      await getManager().init();
      log.debug`initialized with ${config().mcp.servers.length} servers`;
    } catch (err) {
      log.warn`ERROR: initialize failed: ${err}`;
      this.initPromise = null;
    }
  }

  async getServerStatus(): Promise<Array<{ id: string; label?: string; connected: boolean; homepage?: string }>> {
    if (config().mcp.servers.length === 0) return [];
    try {
      return getManager().getServerStatus();
    } catch (err) {
      log.warn`ERROR: getServerStatus failed: ${err}`;
      return config().mcp.servers.map((s) => ({ id: s.id, label: s.label ?? s.id, connected: false }));
    }
  }

  async listTools(): Promise<McpToolDefinition[]> {
    if (config().mcp.servers.length === 0) return [];
    try {
      await this.initialize();
      return getManager().listAllTools();
    } catch (err) {
      log.warn`ERROR: listTools failed: ${err}`;
      return [];
    }
  }

  async reconnectTools(): Promise<void> {
    if (config().mcp.servers.length === 0) return;
    try {
      await this.initialize();
      return getManager().reconnectTools();
    } catch (err) {
      log.warn`ERROR: reconnectTools failed: ${err}`;
    }
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<McpToolCallResult> {
    if (config().mcp.servers.length === 0) return { content: [] };
    try {
      await this.initialize();
      return await getManager().executeTool(name, args ?? {});
    } catch (err) {
      log.warn`ERROR: callTool(${name}) failed: ${err}`;
      return {
        content: [{ type: 'text', text: `Tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}` }],
      };
    }
  }

  async listResources(): Promise<McpResourceInfo[]> {
    if (config().mcp.servers.length === 0) return [];
    try {
      await this.initialize();
      return getManager().listAllResources();
    } catch (err) {
      log.warn`ERROR: listResources failed: ${err}`;
      return [];
    }
  }

  async readResource(uri: string, serverId?: string): Promise<McpResourceContent | null> {
    if (config().mcp.servers.length === 0) return null;
    try {
      await this.initialize();
      return await getManager().readResource(uri, serverId);
    } catch (err) {
      log.warn`ERROR: readResource(${uri}) failed: ${err}`;
      return null;
    }
  }

  async listPrompts(): Promise<McpPromptInfo[]> {
    if (config().mcp.servers.length === 0) return [];
    try {
      await this.initialize();
      return getManager().listAllPrompts();
    } catch (err) {
      log.warn`ERROR: listPrompts failed: ${err}`;
      return [];
    }
  }

  async getPrompt(name: string, serverId?: string): Promise<McpPromptMessage[]> {
    if (config().mcp.servers.length === 0) return [];
    try {
      await this.initialize();
      return await getManager().getPrompt(name, serverId);
    } catch (err) {
      log.warn`ERROR: getPrompt(${name}) failed: ${err}`;
      return [];
    }
  }
}

export const mcp = new McpClient();
export type {
  McpToolDefinition,
  McpToolCallResult,
  McpResourceInfo,
  McpResourceContent,
  McpPromptInfo,
  McpPromptMessage,
};
