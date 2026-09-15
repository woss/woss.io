import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Unit tests for McpManager invalid-session recovery (task 1.1).
//
// The MCP SDK (@modelcontextprotocol/client) is fully mocked — no network.
// Each McpManager.connectServer() constructs a fresh Client, so mock clients
// are recorded in clientRecs as they are constructed. Response seeding uses
// per-server QUEUES (not direct mockReturnValue chains) because the recovery
// path constructs a NEW client mid-executeTool: the retry consumes the next
// queued response from the freshly constructed client.
//
// Reconnect cooldown is wall-clock based (Date.now()), so tests run under
// fake timers and advance time explicitly past RECONNECT_COOLDOWN_MS (30s).
// ---------------------------------------------------------------------------

type Seed = { value?: unknown; throw?: unknown };

type FakeClient = {
  serverId: string;
  connect: Mock;
  listTools: Mock;
  callTool: Mock;
  listResources: Mock;
  readResource: Mock;
  listPrompts: Mock;
  getPrompt: Mock;
};

type ClientRec = { serverId: string; instance: FakeClient };
type TransportRec = { url: URL; opts: { requestInit?: { headers?: Record<string, string> } }; close: Mock };

const { clientRecs, transportRecs, listToolsQueues, callToolQueues, loggerMock } = vi.hoisted(() => {

  return {
    clientRecs: [] as ClientRec[],
    transportRecs: [] as TransportRec[],
    listToolsQueues: {} as Record<string, Seed[]>,
    callToolQueues: {} as Record<string, Seed[]>,
    loggerMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
});

vi.mock('@modelcontextprotocol/client', () => {
  const take = (serverId: string, queues: Record<string, Seed[]>, fallback: unknown): unknown => {
    const next = queues[serverId]?.shift();
    if (!next) return fallback;
    if ('throw' in next) throw next.throw;
    return 'value' in next ? next.value : fallback;
  };

  class FakeClient {
    serverId: string;
    connect: Mock;
    listTools: Mock;
    callTool: Mock;
    listResources: Mock;
    readResource: Mock;
    listPrompts: Mock;
    getPrompt: Mock;

    constructor(clientInfo: { name?: string }) {
      this.serverId = (clientInfo?.name ?? '').replace(/^woss-mcp-/, '');
      this.connect = vi.fn(async () => {});
      this.listTools = vi.fn(async () => take(this.serverId, listToolsQueues, { tools: [] }));
      this.callTool = vi.fn(async () => take(this.serverId, callToolQueues, { content: [] }));
      this.listResources = vi.fn(async () => ({ resources: [] }));
      this.readResource = vi.fn(async () => ({ contents: [] }));
      this.listPrompts = vi.fn(async () => ({ prompts: [] }));
      this.getPrompt = vi.fn(async () => ({ messages: [] }));
      clientRecs.push({ serverId: this.serverId, instance: this as unknown as FakeClient });
    }
  }

  class FakeTransport {
    close: Mock = vi.fn(async () => {});
    constructor(
      public url: URL,
      public opts: TransportRec['opts'],
    ) {
      transportRecs.push({ url: this.url, opts: this.opts, close: this.close });
    }
  }

  return { Client: FakeClient, StreamableHTTPClientTransport: FakeTransport };
});

vi.mock('$lib/server/logger', () => ({
  CAT: { mcp: 'mcp' },
  createLogger: () => loggerMock,
}));

import { McpManager } from './manager.ts';
import type { McpServerConfig } from './config.ts';

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const SERVERS: McpServerConfig[] = [
  { id: 'srv-a', url: 'http://mcp-a.test/mcp', token: 'tok-a', label: 'A' },
  { id: 'srv-b', url: 'http://mcp-b.test/mcp', token: '', label: 'B', readonly: true, tools: 'beta' },
];

/** SdkError-shaped invalid-session error: CLIENT_HTTP_NOT_IMPLEMENTED, HTTP 400, body says "invalid session". */
function invalidSessionError(): Error {
  const err = new Error(
    'Error: POST http://mcp-a.test/mcp: 501 Not Implemented {"jsonrpc":"2.0","error":{"code":-32000,"message":"invalid session"}}',
  );
  Object.assign(err, { code: 'CLIENT_HTTP_NOT_IMPLEMENTED', data: { status: 400 } });
  return err;
}

function clientsFor(serverId: string): FakeClient[] {
  return clientRecs.filter((c) => c.serverId === serverId).map((c) => c.instance);
}

function seedListTools(serverId: string, ...seeds: Seed[]): void {
  (listToolsQueues[serverId] ??= []).push(...seeds);
}

function seedCallTool(serverId: string, ...seeds: Seed[]): void {
  (callToolQueues[serverId] ??= []).push(...seeds);
}

/** Init a manager whose servers expose the given tool-name lists. */
async function initManager(toolsA: string[], toolsB: string[]): Promise<McpManager> {
  seedListTools('srv-a', { value: { tools: toolsA.map((name) => ({ name })) } });
  seedListTools('srv-b', { value: { tools: toolsB.map((name) => ({ name })) } });
  const mgr = new McpManager(SERVERS);
  await mgr.init();
  return mgr;
}

beforeEach(() => {
  vi.useFakeTimers();
  clientRecs.length = 0;
  transportRecs.length = 0;
  for (const k of Object.keys(listToolsQueues)) delete listToolsQueues[k];
  for (const k of Object.keys(callToolQueues)) delete callToolQueues[k];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Invalid-session recovery in executeTool
// ---------------------------------------------------------------------------

describe('McpManager.executeTool invalid-session recovery', () => {
  it('reconnects on invalid-session error and retries once successfully on the fresh session', async () => {
    const mgr = await initManager(['get_me'], ['beta']);

    // Cooldown was stamped by init's connectServer — move past the 30s window.
    vi.advanceTimersByTime(31_000);

    const [oldClient] = clientsFor('srv-a');
    // First response consumed by the OLD client (rejects), second by the NEW client (resolves).
    seedCallTool(
      'srv-a',
      { throw: invalidSessionError() },
      { value: { content: [{ type: 'text', text: 'hello woss' }] } },
    );

    const result = await mgr.executeTool('get_me', { user: 'woss' });

    expect(result).toEqual({ content: [{ type: 'text', text: 'hello woss' }] });

    // Old client: exactly one failed attempt, original (prefix-stripped) name + args.
    expect(oldClient!.callTool).toHaveBeenCalledTimes(1);
    expect(oldClient!.callTool).toHaveBeenCalledWith({ name: 'get_me', arguments: { user: 'woss' } });

    // Fresh session was created through connectServer and retried exactly once.
    const allA = clientsFor('srv-a');
    expect(allA.length).toBe(2);
    const freshClient = allA[1]!;
    expect(freshClient.connect).toHaveBeenCalledTimes(1);
    expect(freshClient.callTool).toHaveBeenCalledTimes(1);
    expect(freshClient.callTool).toHaveBeenCalledWith({ name: 'get_me', arguments: { user: 'woss' } });

    // Connection map points at the replacement — server still reported connected.
    expect(mgr.getServerStatus().find((s) => s.id === 'srv-a')?.connected).toBe(true);
  });

  it('recovers from a message-only "invalid session" error even without data.status', async () => {
    const mgr = await initManager(['get_me'], ['beta']);
    vi.advanceTimersByTime(31_000);

    seedCallTool(
      'srv-a',
      { throw: new Error('MCP transport closed: invalid session') },
      { value: { content: [{ type: 'text', text: 'ok' }] } },
    );

    const result = await mgr.executeTool('get_me', {});
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
    expect(clientsFor('srv-a').length).toBe(2);
  });

  it('does NOT reconnect or retry on unrelated errors', async () => {
    const mgr = await initManager(['get_me'], ['beta']);
    vi.advanceTimersByTime(31_000); // cooldown is NOT the blocker here — classification is

    seedCallTool('srv-a', { throw: new Error('socket hang up') });

    await expect(mgr.executeTool('get_me', {})).rejects.toThrow('socket hang up');

    expect(clientsFor('srv-a').length).toBe(1);
    const client = clientsFor('srv-a')[0]!;
    expect(client.connect).toHaveBeenCalledTimes(1); // only the init connect
    expect(client.callTool).toHaveBeenCalledTimes(1); // no retry
    expect(mgr.getServerStatus().find((s) => s.id === 'srv-a')?.connected).toBe(true);
  });

  it('does NOT treat non-400 data.status as an invalid session', async () => {
    const mgr = await initManager(['get_me'], ['beta']);
    vi.advanceTimersByTime(31_000);

    const serverError = Object.assign(new Error('internal error'), { code: 'CLIENT_INTERNAL', data: { status: 500 } });
    seedCallTool('srv-a', { throw: serverError });

    await expect(mgr.executeTool('get_me', {})).rejects.toThrow('internal error');
    expect(clientsFor('srv-a').length).toBe(1);
    expect(clientsFor('srv-a')[0]!.callTool).toHaveBeenCalledTimes(1);
  });

  it('cooldown suppresses an immediate second recovery attempt', async () => {
    const mgr = await initManager(['get_me'], ['beta']);
    vi.advanceTimersByTime(31_000);
    // Recovery's refreshToolIndex re-lists tools from the fresh session — seed
    // it so get_me is re-added to the index and stays routable afterwards.
    seedListTools('srv-a', { value: { tools: [{ name: 'get_me' }] } });

    // First recovery succeeds and stamps a fresh cooldown timestamp.
    seedCallTool('srv-a', { throw: invalidSessionError() }, { value: { content: [{ type: 'text', text: 'first' }] } });
    expect(await mgr.executeTool('get_me', {})).toEqual({ content: [{ type: 'text', text: 'first' }] });
    expect(clientsFor('srv-a').length).toBe(2);

    // Immediate second invalid-session error: cooldown blocks reconnect+retry.
    seedCallTool('srv-a', { throw: invalidSessionError() });
    await expect(mgr.executeTool('get_me', {})).rejects.toThrow(/invalid session/);

    expect(clientsFor('srv-a').length).toBe(2); // no third client constructed
    const current = clientsFor('srv-a')[1]!;
    expect(current.connect).toHaveBeenCalledTimes(1); // not reconnected again
    // client2 served recovery-1's successful retry AND this failing attempt.
    expect(current.callTool).toHaveBeenCalledTimes(2);
  });

  it('allows recovery again once the 30s cooldown has elapsed', async () => {
    const mgr = await initManager(['get_me'], ['beta']);
    vi.advanceTimersByTime(31_000);
    seedListTools('srv-a', { value: { tools: [{ name: 'get_me' }] } });

    seedCallTool('srv-a', { throw: invalidSessionError() }, { value: { content: [{ type: 'text', text: 'r1' }] } });
    expect(await mgr.executeTool('get_me', {})).toEqual({ content: [{ type: 'text', text: 'r1' }] });
    expect(clientsFor('srv-a').length).toBe(2);

    vi.advanceTimersByTime(31_000); // past the cooldown stamped by the first recovery

    seedCallTool('srv-a', { throw: invalidSessionError() }, { value: { content: [{ type: 'text', text: 'r2' }] } });
    expect(await mgr.executeTool('get_me', {})).toEqual({ content: [{ type: 'text', text: 'r2' }] });
    expect(clientsFor('srv-a').length).toBe(3);
  });

  it("purges only the failed server's tools from the index; other server stays routable", async () => {
    // Colliding tool name forces prefixed entries for BOTH servers.
    const mgr = await initManager(['alpha', 'shared'], ['beta', 'shared']);
    expect(
      mgr
        .listAllTools()
        .map((t) => t.name)
        .sort(),
    ).toEqual(['alpha', 'beta', 'srv-a_shared', 'srv-b_shared']);
    vi.advanceTimersByTime(31_000);

    seedCallTool('srv-a', { throw: invalidSessionError() });
    // Fresh session's listTools fails: refreshToolIndex swallows the error,
    // drops the reconnected server, and rebuilds the index WITHOUT srv-a.
    // The retry is then impossible, so executeTool surfaces the ORIGINAL
    // transport error (manager rethrows when the reconnected server is gone).
    seedListTools('srv-a', { throw: new Error('still down') });
    // srv-b is re-listed during the same refresh — seed it so its tools stay.
    seedListTools('srv-b', { value: { tools: [{ name: 'beta' }, { name: 'shared' }] } });

    await expect(mgr.executeTool('alpha', {})).rejects.toThrow(/invalid session/);

    // Purge precision: srv-a entries gone, srv-b entries untouched.
    expect(
      mgr
        .listAllTools()
        .map((t) => t.name)
        .sort(),
    ).toEqual(['beta', 'shared']);
    await expect(mgr.executeTool('alpha', {})).rejects.toThrow('Unknown tool: alpha');
    await expect(mgr.executeTool('srv-a_shared', {})).rejects.toThrow('Unknown tool: srv-a_shared');

    // Other server still routes end-to-end.
    seedCallTool('srv-b', { value: { content: [{ type: 'text', text: 'b-ok' }] } });
    expect(await mgr.executeTool('beta', {})).toEqual({ content: [{ type: 'text', text: 'b-ok' }] });
    expect(clientsFor('srv-b')[0]!.callTool).toHaveBeenCalledWith({ name: 'beta', arguments: {} });
  });

  it('after successful recovery the index is rebuilt from the fresh session', async () => {
    const mgr = await initManager(['alpha'], ['beta']);
    vi.advanceTimersByTime(31_000);

    seedCallTool('srv-a', { throw: invalidSessionError() }, { value: { content: [{ type: 'text', text: 'ok' }] } });
    // Post-reconnect refresh lists an updated tool set for srv-a.
    seedListTools('srv-a', { value: { tools: [{ name: 'alpha_v2' }] } });
    seedListTools('srv-b', { value: { tools: [{ name: 'beta' }] } });

    expect(await mgr.executeTool('alpha', {})).toEqual({ content: [{ type: 'text', text: 'ok' }] });

    expect(
      mgr
        .listAllTools()
        .map((t) => t.name)
        .sort(),
    ).toEqual(['alpha_v2', 'beta']);
    await expect(mgr.executeTool('alpha', {})).rejects.toThrow('Unknown tool: alpha');

    // New routing goes through the FRESH client.
    seedCallTool('srv-a', { value: { content: [{ type: 'text', text: 'v2' }] } });
    expect(await mgr.executeTool('alpha_v2', {})).toEqual({ content: [{ type: 'text', text: 'v2' }] });
    expect(clientsFor('srv-a')[1]!.callTool).toHaveBeenCalledWith({ name: 'alpha_v2', arguments: {} });
  });
});

// ---------------------------------------------------------------------------
// Shared connectServer helper: init + reconnectTools paths
// ---------------------------------------------------------------------------

describe('McpManager connectServer (shared by init and reconnect)', () => {
  it('init builds one transport per server with per-server headers', async () => {
    await initManager(['alpha'], ['beta']);

    const tA = transportRecs.find((t) => String(t.url) === 'http://mcp-a.test/mcp');
    expect(tA).toBeDefined();
    expect(tA!.opts.requestInit?.headers).toEqual({
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer tok-a',
    });

    const tB = transportRecs.find((t) => String(t.url) === 'http://mcp-b.test/mcp');
    expect(tB).toBeDefined();
    // Empty token -> no Authorization key; readonly/tools flags applied.
    expect(tB!.opts.requestInit?.headers).toEqual({
      Accept: 'application/json, text/event-stream',
      'X-MCP-Readonly': 'true',
      'X-MCP-Tools': 'beta',
    });
  });

  it('reconnectTools rebuilds a dropped server through the same connectServer path', async () => {
    // srv-b's listTools fails during init's refresh -> refreshToolIndex drops it.
    seedListTools('srv-a', { value: { tools: [{ name: 'alpha' }] } });
    seedListTools('srv-b', { throw: new Error('list down') });
    const mgr = new McpManager(SERVERS);
    await mgr.init();

    expect(mgr.getServerStatus().find((s) => s.id === 'srv-b')?.connected).toBe(false);
    expect(clientsFor('srv-b').length).toBe(1); // connected, then dropped by refresh

    seedListTools('srv-b', { value: { tools: [{ name: 'beta' }] } });
    // reconnectTools' refresh re-lists ALL connected servers — seed srv-a too
    // or its tools are dropped from the rebuilt index.
    seedListTools('srv-a', { value: { tools: [{ name: 'alpha' }] } });
    await mgr.reconnectTools();

    // Fresh client + fresh transport constructed through connectServer.
    expect(clientsFor('srv-b').length).toBe(2);
    expect(clientsFor('srv-b')[1]!.connect).toHaveBeenCalledTimes(1);
    expect(transportRecs.filter((t) => String(t.url) === 'http://mcp-b.test/mcp').length).toBe(2);
    expect(mgr.getServerStatus().find((s) => s.id === 'srv-b')?.connected).toBe(true);
    expect(
      mgr
        .listAllTools()
        .map((t) => t.name)
        .sort(),
    ).toEqual(['alpha', 'beta']);

    // All-connected follow-up is a no-op (no extra sessions constructed).
    await mgr.reconnectTools();
    expect(clientsFor('srv-b').length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Remaining public API surface
// ---------------------------------------------------------------------------

describe('McpManager remaining public API', () => {
  it('getSystemPrompt lists tools grouped per connected server', async () => {
    const mgr = await initManager(['alpha'], ['beta']);
    const prompt = mgr.getSystemPrompt();
    expect(prompt).toContain('[srv-a] MCP tools: alpha.');
    expect(prompt).toContain('[srv-b] MCP tools: beta.');
  });

  it('disconnectAll closes every transport and clears all state', async () => {
    const mgr = await initManager(['alpha'], ['beta']);
    await mgr.disconnectAll();

    expect(transportRecs.map((t) => t.close)).toHaveLength(2);
    for (const close of transportRecs.map((t) => t.close)) expect(close).toHaveBeenCalledTimes(1);
    expect(mgr.getServerStatus().every((s) => !s.connected)).toBe(true);
    expect(mgr.listAllTools()).toEqual([]);
    expect(mgr.getSystemPrompt()).toBe('');
  });

  it('listAllResources maps resource metadata with serverId', async () => {
    const mgr = await initManager(['alpha'], ['beta']);
    clientsFor('srv-a')[0]!.listResources.mockResolvedValue({
      resources: [{ uri: 'macula://x', name: 'X', mimeType: 'image/png' }],
    });
    expect(await mgr.listAllResources()).toEqual([
      { uri: 'macula://x', name: 'X', description: undefined, mimeType: 'image/png', serverId: 'srv-a' },
    ]);
  });

  it('readResource returns first text content, scoped and unscoped, null when absent', async () => {
    const mgr = await initManager(['alpha'], ['beta']);
    const expected = { uri: 'macula://x', text: 'body', mimeType: 'text/plain' };
    clientsFor('srv-a')[0]!.readResource.mockResolvedValue({ contents: [expected] });

    expect(await mgr.readResource('macula://x', 'srv-a')).toEqual(expected);
    expect(await mgr.readResource('macula://x')).toEqual(expected);
    expect(await mgr.readResource('macula://x', 'nope')).toBeNull();

    clientsFor('srv-a')[0]!.readResource.mockRejectedValueOnce(new Error('boom'));
    expect(await mgr.readResource('macula://x', 'srv-a')).toBeNull();
  });

  it('listAllPrompts and getPrompt map prompt payloads with serverId', async () => {
    const mgr = await initManager(['alpha'], ['beta']);
    clientsFor('srv-a')[0]!.listPrompts.mockResolvedValue({ prompts: [{ name: 'p1', description: 'd' }] });
    expect(await mgr.listAllPrompts()).toEqual([{ name: 'p1', description: 'd', serverId: 'srv-a' }]);

    clientsFor('srv-a')[0]!.getPrompt.mockResolvedValue({
      messages: [{ role: 'user', content: { type: 'text', text: 'hi' } }],
    });
    expect(await mgr.getPrompt('p1', 'srv-a')).toEqual([{ role: 'user', text: 'hi' }]);
    expect(await mgr.getPrompt('p1', 'nope')).toEqual([]);
  });

  it('executeTool wraps isError results into a text error payload', async () => {
    const mgr = await initManager(['alpha'], ['beta']);
    seedCallTool('srv-a', { value: { content: [{ type: 'text', text: 'kaputt' }], isError: true } });
    expect(await mgr.executeTool('alpha', {})).toEqual({
      content: [{ type: 'text', text: 'Tool returned an error: kaputt' }],
    });
  });

  it('executeTool replaces empty output with an explanatory text item', async () => {
    const mgr = await initManager(['alpha'], ['beta']);
    seedCallTool('srv-a', { value: { content: [] } });
    expect(await mgr.executeTool('alpha', {})).toEqual({
      content: [{ type: 'text', text: 'Tool "alpha" returned no output.' }],
    });
  });

  it('executeTool rejects with Unknown tool for unindexed names', async () => {
    const mgr = await initManager(['alpha'], ['beta']);
    await expect(mgr.executeTool('missing', {})).rejects.toThrow('Unknown tool: missing');
    expect(clientsFor('srv-a')[0]!.callTool).not.toHaveBeenCalled();
  });
});
