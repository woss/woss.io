import { json } from '@sveltejs/kit';
import { mcp } from '$lib/server/mcp';

export async function GET() {
  const servers = await mcp.getServerStatus();
  return json({ servers });
}
