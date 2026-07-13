import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

vi.mock('$lib/server/db', () => ({
  db: {
    content: {
      getPosts: vi.fn(),
      getExperience: vi.fn(),
    },
    vector: {
      searchChunks: vi.fn(),
    },
  },
}));

vi.mock('$lib/server/embed', () => ({
  embedText: vi.fn(),
}));

// Import AFTER mocks so the module scope picks up the mocked db/embed
import { mcpServer } from './index';
import { db } from '$lib/server/db';
import { embedText } from '$lib/server/embed';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockPost = {
  id: 1,
  slug: 'test-post',
  title: 'Test Post',
  excerpt: 'A test excerpt',
  content: '# Test Content',
  date: '2025-01-01',
  tags: ['test'],
  status: 'published',
  description: 'Test description',
  toc: [] as { id: string; text: string; level: number }[],
  headerImage: null as string | null,
  featured: false,
  position: null as number | null,
  partOfSeries: null as number | null,
  workflowFiles: null as
    | { label: string; file: string; placeholders: { key: string; label: string; hint?: string }[] }[]
    | null,
};

const mockExperience = {
  slug: 'senior-dev',
  company: 'Acme Corp',
  role: 'Senior Developer',
  duration: '2022 - 2025',
  skills: ['TypeScript', 'Node.js'],
  description: 'Built amazing things',
  content: '# Senior Developer at Acme',
  startDate: '2022-01-01',
  endDate: '2025-01-01',
  jobRole: 'Senior Developer',
  published: true,
};

const mockSearchResult = {
  chunk: {
    id: 'chunk-1',
    slug: 'test-post',
    text: 'Some chunk text about TypeScript',
    title: 'Test Post',
    date: '2025-01-01',
    tags: ['test'],
    section: 'Intro',
    embedding: [0.1, 0.2],
    type: 'post' as 'post' | 'experience',
  },
  score: 0.95,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

let client: Client;
let clientTransport: InMemoryTransport;
let serverTransport: InMemoryTransport;

async function setupClient() {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  clientTransport = ct;
  serverTransport = st;

  client = new Client({ name: 'test-client', version: '1.0.0' });

  await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('MCP server', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupClient();
  });

  afterEach(async () => {
    await clientTransport.close();
    await serverTransport.close();
  });

  // ── Tools ───────────────────────────────────────────────────────────────────

  describe('tools/list', () => {
    it('returns all 4 registered tools', async () => {
      const result = await client.listTools();
      expect(result.tools).toHaveLength(4);
      const names = result.tools.map((t) => t.name);
      expect(names).toContain('get_posts');
      expect(names).toContain('get_post');
      expect(names).toContain('get_experience');
      expect(names).toContain('search_content');
    });
  });

  // ── get_posts ───────────────────────────────────────────────────────────────

  describe('get_posts tool', () => {
    it('returns formatted post list from db', async () => {
      vi.mocked(db.content.getPosts).mockResolvedValue([mockPost]);

      const result = await client.callTool({ name: 'get_posts', arguments: {} });

      expect(result.content).toHaveLength(1);
      const text = (result.content as { type: string; text: string }[])[0].text;
      expect(text).toContain('Test Post');
      expect(text).toContain('A test excerpt');
      expect(text).toContain('# [2025-01-01] Test Post');
      expect(db.content.getPosts).toHaveBeenCalledTimes(1);
    });

    it('formats multiple posts separated by dividers', async () => {
      const secondPost = { ...mockPost, slug: 'second', title: 'Second Post', excerpt: 'Second excerpt' };
      vi.mocked(db.content.getPosts).mockResolvedValue([mockPost, secondPost]);

      const result = await client.callTool({ name: 'get_posts', arguments: {} });
      const text = (result.content as { type: string; text: string }[])[0].text;

      expect(text).toContain('Test Post');
      expect(text).toContain('Second Post');
      expect(text).toContain('---');
    });

    it('returns empty content when no posts exist', async () => {
      vi.mocked(db.content.getPosts).mockResolvedValue([]);

      const result = await client.callTool({ name: 'get_posts', arguments: {} });
      const text = (result.content as { type: string; text: string }[])[0].text;

      expect(text).toBe('');
    });

    it('passes last param as limit to getPosts', async () => {
      vi.mocked(db.content.getPosts).mockResolvedValue([mockPost]);

      await client.callTool({ name: 'get_posts', arguments: { last: 5 } });

      expect(db.content.getPosts).toHaveBeenCalledWith(expect.objectContaining({ limit: 5 }));
    });

    it('passes sort and order params to getPosts', async () => {
      vi.mocked(db.content.getPosts).mockResolvedValue([mockPost]);

      await client.callTool({
        name: 'get_posts',
        arguments: { sort: 'title', order: 'asc' },
      });

      expect(db.content.getPosts).toHaveBeenCalledWith(expect.objectContaining({ sort: 'title', order: 'asc' }));
    });

    it('omits limit when last is not provided', async () => {
      vi.mocked(db.content.getPosts).mockResolvedValue([mockPost]);

      await client.callTool({ name: 'get_posts', arguments: {} });

      expect(db.content.getPosts).toHaveBeenCalledWith(expect.objectContaining({ sort: 'date', order: 'desc' }));
      // limit should be undefined when last is not provided
      const callArgs = vi.mocked(db.content.getPosts).mock.calls[0]?.[0];
      expect(callArgs?.limit).toBeUndefined();
    });

    it('formats posts with date range filtering', async () => {
      const earlyPost = { ...mockPost, slug: 'early', title: 'Early Post', date: '2025-01-01' };
      const latePost = { ...mockPost, slug: 'late', title: 'Late Post', date: '2025-12-31' };
      vi.mocked(db.content.getPosts).mockResolvedValue([earlyPost, latePost]);

      const result = await client.callTool({
        name: 'get_posts',
        arguments: { from: '2025-06-01', to: '2025-12-31' },
      });
      const text = (result.content as { type: string; text: string }[])[0].text;

      // Only latePost should pass the date filter
      expect(text).toContain('Late Post');
      expect(text).not.toContain('Early Post');
    });
  });

  // ── get_post ────────────────────────────────────────────────────────────────

  describe('get_post tool', () => {
    it('returns post content for valid slug', async () => {
      vi.mocked(db.content.getPosts).mockResolvedValue([mockPost]);

      const result = await client.callTool({
        name: 'get_post',
        arguments: { slug: 'test-post' },
      });

      expect(result.content).toHaveLength(1);
      const text = (result.content as { type: string; text: string }[])[0].text;
      expect(text).toContain('Test Post');
      expect(text).toContain('# Test Content');
      expect(result.isError).toBeFalsy();
      expect(db.content.getPosts).toHaveBeenCalledWith({ slug: 'test-post' });
    });

    it('returns isError for non-existent slug', async () => {
      vi.mocked(db.content.getPosts).mockResolvedValue([]);

      const result = await client.callTool({
        name: 'get_post',
        arguments: { slug: 'does-not-exist' },
      });

      expect(result.isError).toBe(true);
      const text = (result.content as { type: string; text: string }[])[0].text;
      expect(text).toContain('No post found');
      expect(text).toContain('does-not-exist');
    });
  });

  // ── get_experience ──────────────────────────────────────────────────────────

  describe('get_experience tool', () => {
    it('returns formatted experience entries', async () => {
      vi.mocked(db.content.getExperience).mockResolvedValue([mockExperience]);

      const result = await client.callTool({ name: 'get_experience', arguments: {} });

      expect(result.content).toHaveLength(1);
      const text = (result.content as { type: string; text: string }[])[0].text;
      expect(text).toContain('Senior Developer');
      expect(text).toContain('Acme Corp');
      expect(text).toContain('TypeScript');
      expect(text).toContain('Node.js');
      expect(db.content.getExperience).toHaveBeenCalledTimes(1);
    });

    it('returns empty content when no experience exists', async () => {
      vi.mocked(db.content.getExperience).mockResolvedValue([]);

      const result = await client.callTool({ name: 'get_experience', arguments: {} });
      const text = (result.content as { type: string; text: string }[])[0].text;

      expect(text).toBe('');
    });

    it('formats multiple entries separated by dividers', async () => {
      const second = { ...mockExperience, slug: 'junior-dev', role: 'Junior Developer', company: 'Startup Inc' };
      vi.mocked(db.content.getExperience).mockResolvedValue([mockExperience, second]);

      const result = await client.callTool({ name: 'get_experience', arguments: {} });
      const text = (result.content as { type: string; text: string }[])[0].text;

      expect(text).toContain('Senior Developer');
      expect(text).toContain('Junior Developer');
      expect(text).toContain('---');
    });
  });

  // ── search_content ──────────────────────────────────────────────────────────

  describe('search_content tool', () => {
    it('embeds query and returns search results', async () => {
      vi.mocked(embedText).mockResolvedValue({ data: [0.1, 0.2, 0.3], dimensions: 3 });
      vi.mocked(db.vector.searchChunks).mockResolvedValue([mockSearchResult]);

      const result = await client.callTool({
        name: 'search_content',
        arguments: { query: 'TypeScript patterns' },
      });

      expect(embedText).toHaveBeenCalledWith('TypeScript patterns');
      expect(db.vector.searchChunks).toHaveBeenCalledWith([0.1, 0.2, 0.3], 216, undefined);

      const text = (result.content as { type: string; text: string }[])[0].text;
      expect(text).toContain('Test Post');
      expect(text).toContain('Some chunk text about TypeScript');
      expect(text).toContain('0.950');
    });

    it('passes type filter when provided', async () => {
      vi.mocked(embedText).mockResolvedValue({ data: [0.5], dimensions: 1 });
      vi.mocked(db.vector.searchChunks).mockResolvedValue([]);

      await client.callTool({
        name: 'search_content',
        arguments: { query: 'hello', type: 'experience' },
      });

      expect(db.vector.searchChunks).toHaveBeenCalledWith([0.5], 216, 'experience');
    });

    it('returns message when no results found', async () => {
      vi.mocked(embedText).mockResolvedValue({ data: [0.1], dimensions: 1 });
      vi.mocked(db.vector.searchChunks).mockResolvedValue([]);

      const result = await client.callTool({
        name: 'search_content',
        arguments: { query: 'nonexistent topic' },
      });

      const text = (result.content as { type: string; text: string }[])[0].text;
      expect(text).toContain('No matching content found');
    });

    it('formats multiple results with scores', async () => {
      const second = {
        chunk: { ...mockSearchResult.chunk, id: 'chunk-2', title: 'Another Post', text: 'Different text' },
        score: 0.72,
      };
      vi.mocked(embedText).mockResolvedValue({ data: [0.1], dimensions: 1 });
      vi.mocked(db.vector.searchChunks).mockResolvedValue([mockSearchResult, second]);

      const result = await client.callTool({
        name: 'search_content',
        arguments: { query: 'search term' },
      });

      const text = (result.content as { type: string; text: string }[])[0].text;
      expect(text).toContain('0.950');
      expect(text).toContain('0.720');
      expect(text).toContain('Another Post');
      expect(text).toContain('---');
    });
  });

  // ── Resources ───────────────────────────────────────────────────────────────

  describe('resources/list', () => {
    it('lists experience resource', async () => {
      const result = await client.listResources();
      const uris = result.resources.map((r) => r.uri);
      expect(uris).toContain('woss://experience');
    });

    it('lists resource templates', async () => {
      const result = await client.listResourceTemplates();
      const templates = result.resourceTemplates.map((t) => t.uriTemplate);
      expect(templates).toContain('woss://posts/{slug}');
    });
  });

  describe('resources/read', () => {
    it('reads experience resource', async () => {
      vi.mocked(db.content.getExperience).mockResolvedValue([mockExperience]);

      const result = await client.readResource({ uri: 'woss://experience' });

      expect(result.contents).toHaveLength(1);
      const content = result.contents[0] as { uri: string; text: string; mimeType: string };
      expect(content.uri).toBe('woss://experience');
      expect(content.text).toContain('Senior Developer');
      expect(content.mimeType).toBe('text/markdown');
    });

    it('reads posts resource template', async () => {
      vi.mocked(db.content.getPosts).mockResolvedValue([mockPost]);

      const result = await client.readResource({ uri: 'woss://posts/test-post' });

      expect(result.contents).toHaveLength(1);
      const content = result.contents[0] as { uri: string; text: string; mimeType: string };
      expect(content.uri).toBe('woss://posts/test-post');
      expect(content.text).toBe('# Test Content');
      expect(content.mimeType).toBe('text/markdown');
      expect(db.content.getPosts).toHaveBeenCalledWith({ slug: 'test-post' });
    });

    it('throws for non-existent post resource', async () => {
      vi.mocked(db.content.getPosts).mockResolvedValue([]);

      await expect(client.readResource({ uri: 'woss://posts/missing' })).rejects.toThrow('Post not found: missing');
    });
  });

  // ── Prompts ─────────────────────────────────────────────────────────────────

  describe('prompts/list', () => {
    it('lists analyze_portfolio prompt', async () => {
      const result = await client.listPrompts();
      expect(result.prompts).toHaveLength(1);
      expect(result.prompts[0].name).toBe('analyze_portfolio');
    });
  });

  describe('prompts/get', () => {
    it('returns formatted prompt with posts and experience', async () => {
      vi.mocked(db.content.getPosts).mockResolvedValue([mockPost]);
      vi.mocked(db.content.getExperience).mockResolvedValue([mockExperience]);

      const result = await client.getPrompt({ name: 'analyze_portfolio', arguments: {} });

      expect(result.messages).toHaveLength(1);
      const msg = result.messages[0];
      expect(msg.role).toBe('user');
      const content = msg.content as { type: string; text: string };
      expect(content.type).toBe('text');
      expect(content.text).toContain('Test Post');
      expect(content.text).toContain('A test excerpt');
      expect(content.text).toContain('Senior Developer');
      expect(content.text).toContain('Acme Corp');
      expect(content.text).toContain('TypeScript, Node.js');
      expect(content.text).toContain('Analyze the woss.io portfolio');
    });

    it('includes focus instruction when provided', async () => {
      vi.mocked(db.content.getPosts).mockResolvedValue([mockPost]);
      vi.mocked(db.content.getExperience).mockResolvedValue([mockExperience]);

      const result = await client.getPrompt({
        name: 'analyze_portfolio',
        arguments: { focus: 'TypeScript expertise' },
      });

      const content = result.messages[0].content as { type: string; text: string };
      expect(content.text).toContain('Focus your analysis on: TypeScript expertise');
    });

    it('omits focus instruction when not provided', async () => {
      vi.mocked(db.content.getPosts).mockResolvedValue([]);
      vi.mocked(db.content.getExperience).mockResolvedValue([]);

      const result = await client.getPrompt({
        name: 'analyze_portfolio',
        arguments: {},
      });

      const content = result.messages[0].content as { type: string; text: string };
      expect(content.text).not.toContain('Focus your analysis on');
    });
  });
});
