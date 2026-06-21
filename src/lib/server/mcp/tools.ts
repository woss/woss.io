/**
 * MCP tool adapter for OpenAI function-calling.
 * Converts MCP tool definitions to OpenAI tool format and executes calls.
 */
import { mcp } from './client.ts';
import { CAT, createLogger } from '$lib/server/logger';
import type { McpToolDefinition, McpToolCallResult } from './client.ts';
import { toRecord } from './utils.ts';

const log = createLogger(CAT.mcp);

/** Description overrides for tools needing critical LLM usage hints */
const TOOL_DESCRIPTION_OVERRIDES: Record<string, string> = {
  traverse:
    'Primary content discovery tool. from types: user(nickname), keyword(keyword), license(license), directory(pathCid), file(unifiedId), root. EDGE RULES: user→uploads|profile, keyword→tagged_files, license→has_license, directory→contains|info, file→info, root→random|recent|search|keywords. Use filter.what(images|videos|files|all), filter.allowAi(true|false) to exclude AI-gen, filter.allowedAiTraining(true|false) for DMI, filter.nickname(str) by creator to narrow. File fields: id, title, kind, mimeType, rawDataUrl, htmlPageUrl, buyPageUrl, thumbnailUrl, fileSize, publishedAt, license, owner (nickname, displayName, avatarUrl), keywords[], directory (pathCid, name), dataMining. Returns {items, total, after} for paginated edges or {item} for single-item edges. CRITICAL: directory pathCid MUST come from get_users directories[].pathCid. Fabricated CIDs return 0 items. CRITICAL: only root supports random|recent edges. NEVER use recent or random edge with user — those only work with root and will return an error.',
  get_users:
    'Batch lookup Macula user profiles by nickname array. Returns UserNode with avatarUrl, bio, fileCount, and directories (albums with pathCid, name, fileCount). Null for not-found nicknames. Use this to get REAL directory pathCids before calling traverse(directory→contains).',

  get_file:
    'Get file/media info from Macula by unifiedId. Use `fields` to select specific fields via JSONPath (e.g. fields=["title","_links.raw","ai.model"]). Returns title, description, creator, dimensions, filesize, _links (raw, base, buy, json, jsonLd, metadata, copyright, webStatement, license), AI metadata, license, owner. _links.raw provides the image URL. Use get_file when you need EXIF, AI metadata, copyright, or _links details beyond rawDataUrl/htmlPageUrl/buyPageUrl. Primary tool for rich metadata beyond traverse results.',
  get_file_metadata:
    'Get full EXIF/XMP/IPTC metadata for a Macula file. Returns camera details (make, model, ISO, aperture, shutter speed, GPS), panorama stitching info, music metadata.',
  search_issues:
    'Search GitHub issues and pull requests by keyword. CRITICAL: ALWAYS include "is:public" in every query to restrict results to public repositories. Examples: "is:pr author:woss is:public", "is:open is:issue is:public", "bug report is:public".',
  search_repositories:
    'Discover GitHub repositories by name, description, topic, or README content. Essential for verifying repo existence and finding Daniel Maricic\'s projects. Always use when asked about a specific repo to confirm it exists before answering. CRITICAL: ALWAYS include "is:public" in every query to restrict results to public repositories. Supports advanced qualifiers: repo:owner/name, user:woss, language:typescript, topic:react, etc.',
};

/** Suffix appended to all tool descriptions for Q&A context */

/** @group Helpers */

/**
 * Parse a JSON string into Record<string, unknown>.
 * Returns empty object on parse failure, null/undefined input, or non-object JSON.
 */
function parseRecord(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(parsed)) {
      result[key] = val;
    }
    return result;
  } catch (e) {
    log.warn`Failed to parse MCP tool record: ${e}`;
    return {};
  }
}

/** @group Cache */

export interface McpToolDef {
  name: string;
  serverId: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

interface OpenAiTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

const CACHE_TTL_MS = 60_000; // 60 seconds

let _openAiToolsCache: { data: OpenAiTool[]; ts: number } | null = null;
let _mcpToolDefsCache: { data: McpToolDef[]; ts: number } | null = null;
let _mcpResourceContent: { data: string; ts: number } | null = null;
let _mcpPromptContent: { data: string; ts: number } | null = null;

/** @group OpenAI Tool Format */

/**
 * Map an MCP tool definition to OpenAI function-calling format.
 * Description must include TOOL_ONLY_HINT before calling — this function does not add it.
 */
function toOpenAiTool(tool: McpToolDefinition): OpenAiTool {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema || { type: 'object', properties: {} },
    },
  };
}

function resetMcpToolDefsCache(): void {
  _mcpToolDefsCache = null;
}

function resetOpenAiToolsCache(): void {
  _openAiToolsCache = null;
}

/**
 * Fetch all MCP tools and return them in OpenAI function-calling format.
 * Results are cached so subsequent calls return the same list.
 */
async function getOpenAiTools(): Promise<OpenAiTool[]> {
  if (_openAiToolsCache && Date.now() - _openAiToolsCache.ts < CACHE_TTL_MS) return _openAiToolsCache.data;

  const tools = await mcp.listTools();
  const mapped = tools.map((t) =>
    toOpenAiTool({
      name: t.name,
      serverId: t.serverId,
      description: TOOL_DESCRIPTION_OVERRIDES[t.name] ?? t.description ?? '',
      inputSchema: toRecord(t.inputSchema),
    }),
  );
  _openAiToolsCache = { data: mapped, ts: Date.now() };
  return mapped;
}

/**
 * Fetch all MCP tools and return them in McpToolDef format.
 * Results are cached so subsequent calls return the same list.
 */
async function getMcpToolDefs(): Promise<McpToolDef[]> {
  if (_mcpToolDefsCache && Date.now() - _mcpToolDefsCache.ts < CACHE_TTL_MS) return _mcpToolDefsCache.data;
  const tools = await mcp.listTools();
  const mapped = tools.map((t) => ({
    name: t.name,
    serverId: t.serverId,
    description: TOOL_DESCRIPTION_OVERRIDES[t.name] ?? t.description ?? '',
    inputSchema: toRecord(t.inputSchema),
  }));
  _mcpToolDefsCache = { data: mapped, ts: Date.now() };
  log.info`🔧 tools: ${mapped.map((t) => t.name).join(', ')} (${mapped.length}/${tools.length})`;
  return mapped;
}

/**
 * Execute an MCP tool call from an OpenAI function call request.
 * Parses the JSON-stringified arguments and delegates to the MCP client.
 */
async function executeMcpToolCall(toolCall: { name: string; arguments?: string }): Promise<McpToolCallResult> {
  const args = parseRecord(toolCall.arguments);
  log.debug`Tool call: ${toolCall.name}(${JSON.stringify(args)})`;
  const result = await mcp.callTool(toolCall.name, args);
  // Check if any content item indicates a tool error
  const errorText = (result.content ?? [])
    .filter((c: { type?: string; text?: string }) => c.type === 'text' && c.text?.startsWith('Tool returned an error'))
    .map((c: { text?: string }) => c.text)
    .join(' | ');
  if (errorText) {
    log.warn`Tool ${toolCall.name} returned error: ${errorText}`;
  }
  return result;
}

/**
 * Fetch MCP resource text content for system prompt injection.
 * Filters by serverId if provided. Results are cached across requests.
 */
async function getMcpResourceContent(serverId?: string): Promise<string> {
  if (_mcpResourceContent && Date.now() - _mcpResourceContent.ts < CACHE_TTL_MS) return _mcpResourceContent.data;
  const resources = await mcp.listResources();
  const filtered = serverId ? resources.filter((r) => r.serverId === serverId) : resources;
  const parts: string[] = [];
  for (const resource of filtered) {
    const content = await mcp.readResource(resource.uri, resource.serverId);
    if (content && content.text) {
      parts.push(`=== ${resource.uri} ===\n${content.text}`);
    }
  }
  const data = parts.length > 0 ? parts.join('\n\n') : '';
  _mcpResourceContent = { data, ts: Date.now() };
  if (parts.length > 0) {
    log.info`📄 resources: ${filtered.map((r) => r.uri).join(', ')}`;
  }
  return data;
}

/**
 * Fetch all MCP prompt templates for system prompt injection.
 * Results are cached across requests.
 */
async function getMcpPromptContent(): Promise<string> {
  if (_mcpPromptContent && Date.now() - _mcpPromptContent.ts < CACHE_TTL_MS) return _mcpPromptContent.data;
  const prompts = await mcp.listPrompts();
  const parts: string[] = [];
  for (const prompt of prompts) {
    const messages = await mcp.getPrompt(prompt.name, prompt.serverId);
    if (messages.length > 0) {
      const text = messages.map((m) => m.text).join('\n');
      parts.push(`=== PROMPT: ${prompt.name} ===\n${text}`);
    }
  }
  const data = parts.length > 0 ? parts.join('\n\n') : '';
  _mcpPromptContent = { data, ts: Date.now() };
  if (parts.length > 0) {
    log.info`📋 prompts: ${prompts.map((p) => p.name).join(', ')}`;
  }
  return data;
}

function resetMcpResourceContent(): void {
  _mcpResourceContent = null;
}
function resetMcpPromptContent(): void {
  _mcpPromptContent = null;
}

export {
  executeMcpToolCall,
  getMcpToolDefs,
  getMcpResourceContent,
  getMcpPromptContent,
  getOpenAiTools,
  resetMcpToolDefsCache,
  resetMcpResourceContent,
  resetMcpPromptContent,
  resetOpenAiToolsCache,
};
