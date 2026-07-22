import { json } from '@sveltejs/kit';
import { mcp } from '$lib/server/mcp';
import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.mcp);

/** One-shot: fire MCP warm-up only on first status poll, not every 10s interval */
let _warmupDone = false;

export async function GET() {
  if (!_warmupDone) {
    _warmupDone = true;
    // Warm-up: trigger MCP init so tools are pre-loaded when user queries
    mcp.listTools().catch((err) => {
      log.debug`status: warm-up listTools failed: ${err}`;
    });
  }
  const servers = await mcp.getServerStatus();
  return json({ servers });
}
