import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecordId, Table } from 'surrealdb';

// ─── Mock: $lib/server/surreal ──────────────────────────────────────────────
// Provide a fake Surreal client that satisfies the chainable API used by
// MessageRepo, UserRepo, and ChatRepo.

function buildMockSurreal() {
  const calls: { method: string; args: unknown[] }[] = [];

  const mockOutput = {
    output: vi.fn().mockResolvedValue({ id: 'messages:test-msg-id' }),
  };
  const mockContent = {
    content: vi.fn().mockReturnValue(mockOutput),
  };
  const mockMergeResult = vi.fn().mockResolvedValue({});
  const mockUpdate = {
    merge: mockMergeResult,
  };

  const db = {
    query: vi.fn().mockResolvedValue([[]]),
    create: vi.fn().mockReturnValue(mockContent),
    relate: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnValue(mockUpdate),
    select: vi.fn().mockResolvedValue(null),
  };

  return { db, calls, mockOutput, mockContent, mockMergeResult, mockUpdate };
}

let mockSurreal: ReturnType<typeof buildMockSurreal>;

vi.mock('./surreal', () => ({
  getSurreal: () => mockSurreal.db,
  initSurreal: vi.fn().mockResolvedValue(undefined),
  closeSurreal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/server/logger', () => ({
  CAT: { db: 'db' },
  createLogger: vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  })),
}));

vi.mock('../trace-context', () => ({
  getCurrentTraceContext: vi.fn().mockReturnValue(null),
}));

vi.mock('$lib/search-config', () => ({
  EMBEDDING_DIM: 384,
  EMBEDDING_MODEL: 'test-model',
}));

// ─── Import AFTER mocks ─────────────────────────────────────────────────────
import { SurrealDatabaseService } from './surreal-service';

beforeEach(() => {
  vi.clearAllMocks();
  mockSurreal = buildMockSurreal();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('MessageRepo.createMessageForStreaming', () => {
  it('creates a message record with empty content defaults and returns the provided msgId', async () => {
    const service = new SurrealDatabaseService();
    const msgId = 'my-custom-msg-id';

    const result = await service.messages.createMessageForStreaming({
      userId: 'user-1',
      chatId: 'chat-1',
      role: 'assistant',
      msgId,
    });

    // Returns the provided msgId
    expect(result).toBe('my-custom-msg-id');

    // db.create was called to create the message record
    expect(mockSurreal.db.create).toHaveBeenCalledTimes(1);

    // Verify the create was called with a RecordId targeting 'messages' table
    const createArg = mockSurreal.db.create.mock.calls[0][0] as InstanceType<typeof RecordId>;
    expect(createArg).toBeInstanceOf(RecordId);
    expect(createArg.table.name).toBe('messages');
    expect(createArg.id).toBe('my-custom-msg-id');

    // Verify content() was called with empty-content defaults
    const contentArg = mockSurreal.db.create.mock.results[0].value.content.mock.calls[0][0];
    expect(contentArg.content).toBe('');
    expect(contentArg.sources).toBe('[]');
    expect(contentArg.reasoning).toBe('');
    expect(contentArg.tokens_in).toBe(0);
    expect(contentArg.tokens_out).toBe(0);
    expect(contentArg.duration_ms).toBe(0);
    expect(contentArg.max_tokens).toBe(0);
    expect(contentArg.irrecoverable).toBe(false);
    expect(contentArg.error).toBeUndefined();
    expect(contentArg.from_cache).toBe(false);

    // Verify user_id is a RecordId link
    expect(contentArg.user_id).toBeInstanceOf(RecordId);
    expect((contentArg.user_id as InstanceType<typeof RecordId>).table.name).toBe('users');
    expect((contentArg.user_id as InstanceType<typeof RecordId>).id).toBe('user-1');

    // Verify role
    expect(contentArg.role).toBe('assistant');

    // Verify output('after') was called on the content chain
    expect(mockSurreal.mockOutput.output).toHaveBeenCalledWith('after');
  });

  it('creates a has_message edge when chatId is provided', async () => {
    const service = new SurrealDatabaseService();

    await service.messages.createMessageForStreaming({
      userId: 'user-2',
      chatId: 'chat-99',
      role: 'user',
      msgId: 'msg-edge-test',
    });

    // db.relate was called once for the has_message edge
    expect(mockSurreal.db.relate).toHaveBeenCalledTimes(1);

    const [from, table, to, data] = mockSurreal.db.relate.mock.calls[0];
    expect(from).toBeInstanceOf(RecordId);
    expect((from as InstanceType<typeof RecordId>).table.name).toBe('chats');
    expect((from as InstanceType<typeof RecordId>).id).toBe('chat-99');
    expect(table).toBeInstanceOf(Table);
    expect((table as Table).name).toBe('has_message');
    expect(to).toBeInstanceOf(RecordId);
    expect((to as InstanceType<typeof RecordId>).table.name).toBe('messages');
    expect((to as InstanceType<typeof RecordId>).id).toBe('msg-edge-test');
    expect(data).toHaveProperty('created_at');
  });

  it('does NOT create a has_message edge when chatId is omitted', async () => {
    const service = new SurrealDatabaseService();

    await service.messages.createMessageForStreaming({
      userId: 'user-3',
      role: 'assistant',
      msgId: 'msg-no-chat',
    });

    expect(mockSurreal.db.relate).not.toHaveBeenCalled();
  });

  it('generates a UUID when msgId is not provided', async () => {
    const service = new SurrealDatabaseService();

    const result = await service.messages.createMessageForStreaming({
      userId: 'user-4',
      role: 'assistant',
    });

    // Should be a UUID-like string (not empty, not the literal undefined)
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // UUID format: 8-4-4-4-12
    expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('sets query_type when provided', async () => {
    const service = new SurrealDatabaseService();

    await service.messages.createMessageForStreaming({
      userId: 'user-5',
      role: 'assistant',
      msgId: 'msg-query-type',
      queryType: 'rag',
    });

    const contentArg = mockSurreal.db.create.mock.results[0].value.content.mock.calls[0][0];
    expect(contentArg.query_type).toBe('rag');
  });

  it('sets query_type to null when not provided', async () => {
    const service = new SurrealDatabaseService();

    await service.messages.createMessageForStreaming({
      userId: 'user-6',
      role: 'assistant',
      msgId: 'msg-no-query-type',
    });

    const contentArg = mockSurreal.db.create.mock.results[0].value.content.mock.calls[0][0];
    expect(contentArg.query_type).toBeUndefined();
  });
});

describe('MessageRepo.finalizeMessage', () => {
  it('calls db.update().merge() with the correct fields', async () => {
    const service = new SurrealDatabaseService();

    await service.messages.finalizeMessage('msg-123', {
      content: 'Hello world',
      sources: '[{"title":"doc1"}]',
      reasoning: 'Because...',
      tokensIn: 100,
      tokensOut: 200,
      durationMs: 1500,
      maxTokens: 4096,
      irrecoverable: false,
      fromCache: false,
    });

    // db.update was called with a RecordId for the message
    expect(mockSurreal.db.update).toHaveBeenCalledTimes(1);
    const updateArg = mockSurreal.db.update.mock.calls[0][0];
    expect(updateArg).toBeInstanceOf(RecordId);
    expect((updateArg as InstanceType<typeof RecordId>).table.name).toBe('messages');
    expect((updateArg as InstanceType<typeof RecordId>).id).toBe('msg-123');

    // merge was called with the correct mapped fields
    expect(mockSurreal.mockMergeResult).toHaveBeenCalledTimes(1);
    const mergeArg = mockSurreal.mockMergeResult.mock.calls[0][0];
    expect(mergeArg).toEqual({
      content: 'Hello world',
      sources: '[{"title":"doc1"}]',
      reasoning: 'Because...',
      tokens_in: 100,
      tokens_out: 200,
      duration_ms: 1500,
      max_tokens: 4096,
      irrecoverable: false,
      error: null,
      from_cache: false,
    });
  });

  it('applies default values for omitted optional fields', async () => {
    const service = new SurrealDatabaseService();

    await service.messages.finalizeMessage('msg-456', {
      content: 'Minimal update',
    });

    const mergeArg = mockSurreal.mockMergeResult.mock.calls[0][0];
    expect(mergeArg).toEqual({
      content: 'Minimal update',
      sources: '[]',
      reasoning: '',
      tokens_in: 0,
      tokens_out: 0,
      duration_ms: 0,
      max_tokens: 0,
      irrecoverable: false,
      error: null,
      from_cache: false,
    });
  });

  it('sets irrecoverable and error when provided', async () => {
    const service = new SurrealDatabaseService();

    await service.messages.finalizeMessage('msg-err', {
      content: '',
      irrecoverable: true,
      error: 'Rate limit exceeded',
    });

    const mergeArg = mockSurreal.mockMergeResult.mock.calls[0][0];
    expect(mergeArg.irrecoverable).toBe(true);
    expect(mergeArg.error).toBe('Rate limit exceeded');
    expect(mergeArg.content).toBe('');
  });

  it('sets fromCache to true when provided', async () => {
    const service = new SurrealDatabaseService();

    await service.messages.finalizeMessage('msg-cache', {
      content: 'Cached response',
      fromCache: true,
    });

    const mergeArg = mockSurreal.mockMergeResult.mock.calls[0][0];
    expect(mergeArg.from_cache).toBe(true);
  });
});

// ─── ToolCallRepo — two-step graph traversal ────────────────────────────────

describe('ToolCallRepo.getToolCallsByMessageId', () => {
  it('returns tool calls for a single message via two-step traversal', async () => {
    const service = new SurrealDatabaseService();

    // Step 1 mock: graph traversal returns tool_call IDs
    // Step 2 mock: query tool_calls by those IDs
    mockSurreal.db.query
      .mockResolvedValueOnce([[{ toolCallId: 'tc-1' }, { toolCallId: 'tc-2' }]])
      .mockResolvedValueOnce([
        [
          {
            id: 'tc-1',
            name: 'web_search',
            serverId: 'fetch-server',
            startedAt: '2025-01-15T10:00:00.000Z',
            finishedAt: '2025-01-15T10:00:02.000Z',
          },
          {
            id: 'tc-2',
            name: 'read_file',
            serverId: 'fs-server',
            startedAt: '2025-01-15T10:00:03.000Z',
            finishedAt: null,
          },
        ],
      ]);

    const result = await service.toolCalls.getToolCallsByMessageId('msg-abc');

    expect(result).toHaveLength(2);

    // First tool call — completed, has durationMs
    expect(result[0]).toEqual({
      id: 'tc-1',
      name: 'web_search',
      serverId: 'fetch-server',
      startedAt: '2025-01-15T10:00:00.000Z',
      finishedAt: '2025-01-15T10:00:02.000Z',
      durationMs: 2000,
    });

    // Second tool call — in progress, no durationMs
    expect(result[1]).toEqual({
      id: 'tc-2',
      name: 'read_file',
      serverId: 'fs-server',
      startedAt: '2025-01-15T10:00:03.000Z',
      finishedAt: null,
      durationMs: null,
    });

    // Verify step 1 query: graph traversal on has_tool_call edges
    const step1Sql = mockSurreal.db.query.mock.calls[0][0] as string;
    expect(step1Sql).toContain('has_tool_call');
    expect(step1Sql).toContain('meta::id(out)');

    // Verify step 1 vars: messageId wrapped in RecordId
    const step1Vars = mockSurreal.db.query.mock.calls[0][1] as Record<string, unknown>;
    expect(step1Vars.messageId).toBeInstanceOf(RecordId);
    expect((step1Vars.messageId as InstanceType<typeof RecordId>).table.name).toBe('messages');
    expect((step1Vars.messageId as InstanceType<typeof RecordId>).id).toBe('msg-abc');

    // Verify step 2 query: SELECT from tool_calls by IDs
    const step2Sql = mockSurreal.db.query.mock.calls[1][0] as string;
    expect(step2Sql).toContain('tool_calls');
    expect(step2Sql).toContain('id IN $toolCallIds');

    // Verify step 2 vars: toolCallIds is an array of RecordId
    const step2Vars = mockSurreal.db.query.mock.calls[1][1] as Record<string, unknown>;
    const ids = step2Vars.toolCallIds as InstanceType<typeof RecordId>[];
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeInstanceOf(RecordId);
    expect(ids[0].table.name).toBe('tool_calls');
    expect(ids[0].id).toBe('tc-1');
    expect(ids[1].id).toBe('tc-2');
  });

  it('returns empty array when no tool calls exist for a message', async () => {
    const service = new SurrealDatabaseService();

    // Step 1 returns empty — no edges found
    mockSurreal.db.query.mockResolvedValueOnce([[]]);

    const result = await service.toolCalls.getToolCallsByMessageId('msg-empty');

    expect(result).toEqual([]);

    // Only step 1 should have been called — step 2 skipped
    expect(mockSurreal.db.query).toHaveBeenCalledTimes(1);
  });

  it('computes durationMs correctly for various durations', async () => {
    const service = new SurrealDatabaseService();

    mockSurreal.db.query.mockResolvedValueOnce([[{ toolCallId: 'tc-ms-1' }]]).mockResolvedValueOnce([
      [
        {
          id: 'tc-ms-1',
          name: 'calc',
          serverId: 'math-server',
          startedAt: '2025-01-15T10:00:00.000Z',
          finishedAt: '2025-01-15T10:00:00.500Z',
        },
      ],
    ]);

    const result = await service.toolCalls.getToolCallsByMessageId('msg-ms');

    expect(result[0].durationMs).toBe(500);
  });
});

describe('ToolCallRepo.getToolCallsForMessages', () => {
  it('returns empty object for empty input array', async () => {
    const service = new SurrealDatabaseService();

    const result = await service.toolCalls.getToolCallsForMessages([]);

    expect(result).toEqual({});
    // No queries should be issued
    expect(mockSurreal.db.query).not.toHaveBeenCalled();
  });

  it('returns correct mapping for multiple messages with tool calls', async () => {
    const service = new SurrealDatabaseService();

    // Step 1: graph traversal returns msgId→toolCallId mappings
    mockSurreal.db.query.mockResolvedValueOnce([
      [
        { msgId: 'msg-1', toolCallId: 'tc-a' },
        { msgId: 'msg-1', toolCallId: 'tc-b' },
        { msgId: 'msg-2', toolCallId: 'tc-c' },
      ],
    ]);

    // Step 2: all tool_calls in one query
    mockSurreal.db.query.mockResolvedValueOnce([
      [
        {
          id: 'tc-a',
          name: 'search',
          serverId: 's1',
          startedAt: '2025-01-15T10:00:00.000Z',
          finishedAt: '2025-01-15T10:00:01.000Z',
        },
        {
          id: 'tc-b',
          name: 'fetch',
          serverId: 's2',
          startedAt: '2025-01-15T10:00:02.000Z',
          finishedAt: null,
        },
        {
          id: 'tc-c',
          name: 'parse',
          serverId: 's3',
          startedAt: '2025-01-15T10:00:03.000Z',
          finishedAt: '2025-01-15T10:00:03.500Z',
        },
      ],
    ]);

    const result = await service.toolCalls.getToolCallsForMessages(['msg-1', 'msg-2']);

    // msg-1 has 2 tool calls
    expect(result['msg-1']).toHaveLength(2);
    expect(result['msg-1'][0]).toEqual({
      id: 'tc-a',
      name: 'search',
      serverId: 's1',
      startedAt: '2025-01-15T10:00:00.000Z',
      finishedAt: '2025-01-15T10:00:01.000Z',
      durationMs: 1000,
    });
    expect(result['msg-1'][1]).toEqual({
      id: 'tc-b',
      name: 'fetch',
      serverId: 's2',
      startedAt: '2025-01-15T10:00:02.000Z',
      finishedAt: null,
      durationMs: null,
    });

    // msg-2 has 1 tool call
    expect(result['msg-2']).toHaveLength(1);
    expect(result['msg-2'][0]).toEqual({
      id: 'tc-c',
      name: 'parse',
      serverId: 's3',
      startedAt: '2025-01-15T10:00:03.000Z',
      finishedAt: '2025-01-15T10:00:03.500Z',
      durationMs: 500,
    });

    // Verify step 1: batch traversal with IN clause
    const step1Sql = mockSurreal.db.query.mock.calls[0][0] as string;
    expect(step1Sql).toContain('has_tool_call');
    expect(step1Sql).toContain('meta::id(in)');
    expect(step1Sql).toContain('meta::id(out)');

    // Verify step 1 vars: array of RecordId
    const step1Vars = mockSurreal.db.query.mock.calls[0][1] as Record<string, unknown>;
    const msgIds = step1Vars.messageIds as InstanceType<typeof RecordId>[];
    expect(msgIds).toHaveLength(2);
    expect(msgIds[0]).toBeInstanceOf(RecordId);
    expect(msgIds[0].table.name).toBe('messages');
    expect(msgIds[0].id).toBe('msg-1');
    expect(msgIds[1].id).toBe('msg-2');

    // Verify step 2: single query with all tool_call IDs
    const step2Sql = mockSurreal.db.query.mock.calls[1][0] as string;
    expect(step2Sql).toContain('tool_calls');
    expect(step2Sql).toContain('id IN $allToolCallIds');
  });

  it('excludes messages with no tool calls from result map', async () => {
    const service = new SurrealDatabaseService();

    // Step 1: only msg-1 has edges, msg-no-tools has none
    mockSurreal.db.query.mockResolvedValueOnce([[{ msgId: 'msg-has-tools', toolCallId: 'tc-x' }]]);

    // Step 2: one tool call returned
    mockSurreal.db.query.mockResolvedValueOnce([
      [
        {
          id: 'tc-x',
          name: 'grep',
          serverId: 'code-server',
          startedAt: '2025-01-15T10:00:00.000Z',
          finishedAt: '2025-01-15T10:00:00.100Z',
        },
      ],
    ]);

    const result = await service.toolCalls.getToolCallsForMessages(['msg-has-tools', 'msg-no-tools']);

    // msg-has-tools present
    expect(result['msg-has-tools']).toHaveLength(1);
    expect(result['msg-has-tools'][0].id).toBe('tc-x');

    // msg-no-tools NOT in result
    expect(result['msg-no-tools']).toBeUndefined();
  });

  it('returns empty object when no edges found for any message', async () => {
    const service = new SurrealDatabaseService();

    // Step 1: no edges
    mockSurreal.db.query.mockResolvedValueOnce([[]]);

    const result = await service.toolCalls.getToolCallsForMessages(['msg-a', 'msg-b']);

    expect(result).toEqual({});
    // Step 2 should be skipped
    expect(mockSurreal.db.query).toHaveBeenCalledTimes(1);
  });

  it('uses only unique tool_call IDs in step 2 query', async () => {
    const service = new SurrealDatabaseService();

    // Both messages share the same tool call (edge case: duplicate IDs)
    mockSurreal.db.query.mockResolvedValueOnce([
      [
        { msgId: 'msg-1', toolCallId: 'tc-shared' },
        { msgId: 'msg-2', toolCallId: 'tc-shared' },
      ],
    ]);

    mockSurreal.db.query.mockResolvedValueOnce([
      [
        {
          id: 'tc-shared',
          name: 'shared_tool',
          serverId: 's1',
          startedAt: '2025-01-15T10:00:00.000Z',
          finishedAt: '2025-01-15T10:00:00.050Z',
        },
      ],
    ]);

    const result = await service.toolCalls.getToolCallsForMessages(['msg-1', 'msg-2']);

    // Both messages map to the same tool call
    expect(result['msg-1']).toHaveLength(1);
    expect(result['msg-2']).toHaveLength(1);
    expect(result['msg-1'][0].id).toBe('tc-shared');
    expect(result['msg-2'][0].id).toBe('tc-shared');

    // Step 2 vars: only one unique ID despite two messages
    const step2Vars = mockSurreal.db.query.mock.calls[1][1] as Record<string, unknown>;
    const allIds = step2Vars.allToolCallIds as InstanceType<typeof RecordId>[];
    expect(allIds).toHaveLength(1);
    expect(allIds[0].id).toBe('tc-shared');
  });
});
