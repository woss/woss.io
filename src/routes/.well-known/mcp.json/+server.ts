import { json } from '@sveltejs/kit';

const ORIGIN = process.env.ORIGIN ?? 'https://woss.io';

/**
 * MCP auto-discovery endpoint (.well-known/mcp.json)
 *
 * Returns the MCP server configuration for client auto-discovery.
 * Clients find this at GET /.well-known/mcp.json
 */
export function GET() {
  return json({
    name: 'woss.io-mcp',
    description: 'MCP server for woss.io — blog posts, experience, and search',
    url: `${ORIGIN}/mcp`,
    type: 'streamable-http',
  });
}
