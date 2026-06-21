// Lightpanda-based mermaid renderer
// Lightpanda runs at boot, CDP WebSocket stays alive across requests.
// Each request reuses the existing page for Runtime.evaluate.
//
// CDP protocol note: Lightpanda requires Target.createTarget + Target.attachToTarget
// before any page-level commands (Page.*, Runtime.*). The root session only handles
// target/browser-level methods. All page commands must include sessionId.

const API_KEY = Deno.env.get('MERMAID_API_KEY') || '';
const PORT = parseInt(Deno.env.get('PORT') || '3000');
const LP_PORT = 9222;
const RENDER_TIMEOUT = 15_000;

function ts(): string {
  return new Date().toISOString().slice(11, 23);
}

console.log(`[${ts()}] mermaid service starting on port ${PORT}, lightpanda port ${LP_PORT}`);

if (!API_KEY) {
  console.error(`[${ts()}] MERMAID_API_KEY environment variable is required`);
  Deno.exit(1);
}

interface CdpResponse {
  id: number;
  sessionId?: string;
  result?: {
    targetId?: string;
    sessionId?: string;
    result?: { type?: string; value?: unknown };
  };
  error?: { message: string };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Minimal CDP client — sends commands, resolves on matching response id.
 *  When sessionId is provided, the command targets a specific page session
 *  (required by Lightpanda for Page.* and Runtime.* methods). */
function cdpCommand(
  ws: WebSocket,
  msgId: number,
  method: string,
  params: Record<string, unknown> = {},
  sessionId?: string,
): Promise<CdpResponse> {
  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent) => {
      const msg = JSON.parse(event.data) as CdpResponse;
      if (msg.id === msgId) {
        ws.removeEventListener('message', handler);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg);
      }
    };
    ws.addEventListener('message', handler);
    const message: Record<string, unknown> = { id: msgId, method, params };
    if (sessionId) message.sessionId = sessionId;
    ws.send(JSON.stringify(message));
  });
}

/* ─── Persistent CDP state ─── */

let rootWs: WebSocket | null = null;
let pageSessionId = '';
let msgId = 0;

/* ─── Boot: spawn lightpanda, connect CDP, create page session ─── */

async function initBrowser(): Promise<void> {
  // Pre-flight: verify lightpanda binary exists
  const which = new Deno.Command('which', { args: ['lightpanda'] });
  const { success } = await which.output();
  if (!success) {
    console.error(`[${ts()}] lightpanda binary not found. Install it from https://lightpanda.io`);
    Deno.exit(1);
  }
  console.log(`[${ts()}] lightpanda binary found`);

  // Spawn lightpanda (stays alive for lifetime of container)
  console.log(`[${ts()}] spawning lightpanda serve --port ${LP_PORT}`);
  const proc = new Deno.Command('lightpanda', {
    args: ['serve', '--port', String(LP_PORT)],
    stdout: 'null',
    stderr: 'null',
  }).spawn();

  // Kill lightpanda on Deno exit
  globalThis.addEventListener('unload', () => {
    try {
      proc.kill('SIGTERM');
    } catch {
      /* ok */
    }
  });

  // Wait for CDP server to be ready
  console.log(`[${ts()}] waiting for lightpanda CDP server...`);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  // Connect root WebSocket (handles Target.* and Browser.* methods)
  console.log(`[${ts()}] connecting CDP WebSocket ws://127.0.0.1:${LP_PORT}`);
  const ws = new WebSocket(`ws://127.0.0.1:${LP_PORT}`);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      ws.close();
      reject(new Error('CDP WebSocket connection timeout'));
    }, 5000);
    ws.onopen = () => {
      clearTimeout(t);
      console.log(`[${ts()}] CDP WebSocket connected`);
      resolve();
    };
    ws.onerror = () => {
      clearTimeout(t);
      reject(new Error('CDP WebSocket connection failed'));
    };
  });

  msgId = 0;

  // Create a page target (required before any page-level commands)
  console.log(`[${ts()}] Target.createTarget about:blank`);
  const targetResult = await cdpCommand(ws, ++msgId, 'Target.createTarget', { url: 'about:blank' });
  const targetId = targetResult.result?.targetId as string;
  console.log(`[${ts()}] target created: ${targetId}`);

  // Attach to the target with flatten=true to get a sessionId
  // All page commands (Page.*, Runtime.*) must include this sessionId
  console.log(`[${ts()}] Target.attachToTarget ${targetId} (flatten)`);
  const attachResult = await cdpCommand(ws, ++msgId, 'Target.attachToTarget', {
    targetId,
    flatten: true,
  });
  pageSessionId = attachResult.result?.sessionId as string;
  console.log(`[${ts()}] attached, sessionId: ${pageSessionId}`);

  // Enable page events and navigate to a blank page
  console.log(`[${ts()}] Page.enable (session ${pageSessionId})`);
  await cdpCommand(ws, ++msgId, 'Page.enable', {}, pageSessionId);

  console.log(`[${ts()}] Page.navigate about:blank (session ${pageSessionId})`);
  await cdpCommand(ws, ++msgId, 'Page.navigate', { url: 'about:blank' }, pageSessionId);

  // Wait for navigation to complete
  await new Promise((resolve) => setTimeout(resolve, 500));

  rootWs = ws;
  console.log(`[${ts()}] browser ready — accepting requests`);
}

/* ─── Render: reuse existing page via persistent session ─── */

async function renderMermaid(code: string): Promise<string> {
  if (!rootWs || !pageSessionId) throw new Error('CDP session not initialized');

  const expression = `(async () => {
    try {
      const m = await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs');
      m.default.initialize({ startOnLoad: false });
      const { svg } = await m.default.render('s', ${JSON.stringify(code)});
      return svg;
    } catch (e) {
      return 'ERROR: ' + (e instanceof Error ? e.message : String(e));
    }
  })()`;

  console.log(`[${ts()}] Runtime.evaluate (mermaid render, ${code.length} chars)`);
  const result = await cdpCommand(
    rootWs,
    ++msgId,
    'Runtime.evaluate',
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
    },
    pageSessionId,
  );

  const value = result.result?.result?.value as string | undefined;
  if (!value) throw new Error('No SVG returned from mermaid render');
  if (value.startsWith('ERROR: ')) {
    throw new Error(value.slice(7));
  }
  return value;
}

/* ─── HTTP handler ─── */

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  console.log(`[${ts()}] ${req.method} ${url.pathname}`);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (API_KEY && req.headers.get('X-API-Key') !== API_KEY) return json({ error: 'Unauthorized' }, 401);
  if (url.pathname !== '/render') return json({ error: 'Not found' }, 404);

  try {
    const { code } = await req.json();
    if (!code || typeof code !== 'string') return json({ error: 'code required' }, 400);

    const svg = await Promise.race([
      renderMermaid(code),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('Render timeout')), RENDER_TIMEOUT)),
    ]);

    console.log(`[${ts()}] render success, SVG length=${svg.length}`);
    return json({ svg });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${ts()}] render failed:`, msg);
    return json({ error: msg }, 500);
  }
}

/* ─── Boot ─── */

await initBrowser();
Deno.serve({ port: PORT, onListen: ({ port }) => console.log(`[${ts()}] ready on port ${port}`) }, handler);
