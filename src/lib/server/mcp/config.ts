/**
 * MCP server configuration types and env-var parser.
 *
 * Parses the MCP_SERVERS JSON env var into an array of McpServerConfig.
 * Supports $VAR placeholder substitution from process.env.
 */

export type McpServerConfig = {
  /** Unique identifier (used as prefix for tool name collisions) */
  id: string;
  /** MCP endpoint URL */
  url: string;
  /** Bearer token (env var references like $GITHUB_TOKEN are resolved) */
  token: string;
  /** Set X-MCP-Readonly header if true */
  readonly?: boolean;
  /** If false, this server is skipped. Default true. */
  enabled?: boolean;
  /** Connection timeout in ms */
  timeout?: number;
  /** User-visible server name (e.g. "GitHub", "Macula"). Falls back to id. */
  label?: string;
  /** Homepage URL (e.g. for linking) */
  homepage?: string;
  /** Comma-separated list of tool names to expose (X-MCP-Tools header). If unset, all tools loaded. */
  tools?: string;
  /** Extra HTTP headers to include in every request to this MCP server. Merged before Authorization. */
  headers?: Record<string, string>;
};

/**
 * Parse MCP_SERVERS JSON env var, resolving $VAR placeholders from process.env.
 * Filters out disabled servers (enabled: false).
 * Returns empty array if raw is undefined/null/empty.
 */
export function parseMcpServers(raw: string | undefined): McpServerConfig[] {
  if (!raw) return [];

  // Resolve $VAR and ${VAR} placeholders from process.env
  const unresolved: string[] = [];
  const resolved = raw.replace(/\$\$|\$(\w+)|\$\{(\w+)\}/g, (match, v1, v2) => {
    if (match === '$$') return '$';
    const name = v1 ?? v2;
    const value = process.env[name];
    if (value === undefined) {
      unresolved.push(name);
      return match;
    }
    return value;
  });
  if (unresolved.length > 0) {
    console.warn(
      `[mcp/config] ${unresolved.length} unresolvable env var(s) in MCP_SERVERS: ${unresolved.join(', ')} — using literal strings`,
    );
  }

  let parsed: McpServerConfig[];
  try {
    parsed = JSON.parse(resolved);
  } catch (e) {
    const errMsg = e instanceof SyntaxError ? e.message : String(e);
    throw new Error(
      `Failed to parse MCP_SERVERS (after env var resolution): ${errMsg}. ` +
        `Raw (first 200 chars): ${raw.slice(0, 200)}`,
      { cause: e },
    );
  }

  return parsed.filter((s) => s.enabled !== false);
}
