import { describe, it, expect, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ALL external dependencies BEFORE importing the module under test.
// normalizeArgs is module-private, so it is exercised through the exported
// executeMcpToolCall: stringified arguments -> parseRecord -> normalizeArgs ->
// mcp.callTool. Asserting on the args mcp.callTool receives tests the full
// coercion path without changing production code.
// ---------------------------------------------------------------------------

// vi.mock factories are hoisted above imports, so mocks must be created with
// vi.hoisted to be safely referenceable inside factory closures.
const { callToolMock, configMock, loggerMock } = vi.hoisted(() => ({
  // Params are intentionally unnamed-underscored: the mock is generic, tests
  // assert the real (name, args) via callToolMock.mock.calls[0].
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  callToolMock: vi.fn(async (_name: string, _args?: Record<string, unknown>) => ({ content: [] })),
  configMock: vi.fn(() => ({ mcp: { servers: [] } })),
  loggerMock: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('./client.ts', () => ({
  mcp: { callTool: callToolMock },
}));

vi.mock('$lib/server/config', () => ({
  config: configMock,
}));

vi.mock('$lib/server/logger', () => ({
  CAT: { mcp: 'mcp' },
  createLogger: () => loggerMock,
}));

import { executeMcpToolCall } from './tools.ts';

/**
 * Run a full tool call whose arguments are a JSON string of `args`, then
 * return the exact arguments object mcp.callTool received after coercion.
 */
async function callWithArgs(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  callToolMock.mockClear();
  const result = await executeMcpToolCall({ name: 'traverse', arguments: JSON.stringify(args) });
  expect(result).toEqual({ content: [] });
  expect(callToolMock).toHaveBeenCalledTimes(1);
  expect(callToolMock).toHaveBeenCalledWith('traverse', expect.any(Object));
  return callToolMock.mock.calls[0]![1] as Record<string, unknown>;
}

describe('normalizeArgs (exercised via executeMcpToolCall)', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('FR-001: coerces stringified-JSON object value into a real object (from)', async () => {
    const args = await callWithArgs({ from: '{"type":"keyword","keyword":"eclipse"}' });
    expect(args.from).toEqual({ type: 'keyword', keyword: 'eclipse' });
  });

  it('FR-001: coerces stringified-JSON object value into a real object (filter)', async () => {
    const args = await callWithArgs({ filter: '{"what":"images","allowAi":true}' });
    expect(args.filter).toEqual({ what: 'images', allowAi: true });
  });

  it('FR-001: coerces stringified-JSON array value into a real array', async () => {
    const args = await callWithArgs({ nicknames: '["alice","bob"]' });
    expect(args.nicknames).toEqual(['alice', 'bob']);
  });

  it('FR-002: coerces numeric-string limit "20" into number 20', async () => {
    const args = await callWithArgs({ limit: '20' });
    expect(args.limit).toBe(20);
  });

  it('FR-002: coerces numeric strings for all known numeric keys', async () => {
    const args = await callWithArgs({ limit: '20', maxResults: '5', perPage: '10', page: '2', offset: '0' });
    expect(args).toEqual({ limit: 20, maxResults: 5, perPage: 10, page: 2, offset: 0 });
  });

  it('FR-003: plain non-JSON string passes through unchanged', async () => {
    const args = await callWithArgs({ query: 'bug report is:public' });
    expect(args.query).toBe('bug report is:public');
  });

  it('edge: non-finite numeric string for a numeric key is kept as string', async () => {
    const args = await callWithArgs({ limit: 'abc' });
    expect(args.limit).toBe('abc');
  });

  it('edge: invalid JSON string starting with "{" is kept as original string', async () => {
    const args = await callWithArgs({ from: '{not json' });
    expect(args.from).toBe('{not json');
  });

  it('edge: invalid JSON string starting with "[" is kept as original string', async () => {
    const args = await callWithArgs({ ids: '[1,2' });
    expect(args.ids).toBe('[1,2');
  });

  it('edge: input object is not mutated and a new object is returned', async () => {
    const input = { from: '{"type":"keyword","keyword":"eclipse"}', limit: '20', query: 'is:public' };
    const snapshot = JSON.stringify(input);
    callToolMock.mockClear();
    await executeMcpToolCall({ name: 'traverse', arguments: JSON.stringify(input) });
    expect(JSON.stringify(input)).toBe(snapshot);
    expect(input).toEqual({ from: '{"type":"keyword","keyword":"eclipse"}', limit: '20', query: 'is:public' });
    const received = callToolMock.mock.calls[0]![1];
    expect(received).not.toBe(input);
  });

  it('edge: non-string values pass through unchanged', async () => {
    const parsedFilter = { type: 'keyword', keyword: 'eclipse' };
    const ids = [1, 2, 3];
    const args = await callWithArgs({
      limit: 20,
      enabled: true,
      filter: parsedFilter,
      ids,
      nothing: null,
    });
    expect(args).toEqual({ limit: 20, enabled: true, filter: parsedFilter, ids, nothing: null });
  });

  it('property: normalizeArgs is idempotent — already-normalized args stay stable', async () => {
    const normalized = { limit: 20, filter: { type: 'keyword' }, nicknames: ['alice'], query: 'is:public' };
    const args = await callWithArgs(normalized);
    expect(args).toEqual(normalized);
  });

  it('boundary: empty args object passes through as empty object', async () => {
    const args = await callWithArgs({});
    expect(args).toEqual({});
  });
});
