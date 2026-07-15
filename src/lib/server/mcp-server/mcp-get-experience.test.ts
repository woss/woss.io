import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

// ── Mocks must come before module import ──────────────────────────────────────

vi.mock('$lib/server/db', () => ({
  db: {
    content: {
      getPosts: vi.fn(),
      getExperience: vi.fn(),
    },
    vector: { searchChunks: vi.fn() },
  },
}));

vi.mock('$lib/server/embed', () => ({
  embedText: vi.fn(),
}));

vi.mock('$lib/server/logger', () => ({
  CAT: { mcp: 'mcp' },
  createLogger: () => ({
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  }),
}));

import { mcpServer } from '$lib/server/mcp-server/index';
import { db } from '$lib/server/db';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const svelteEntry = {
  slug: 'svelte-dev',
  company: 'SvelteKit Studios',
  role: 'Frontend Lead',
  duration: '2023 - 2025',
  skills: ['Svelte', 'SvelteKit', 'TypeScript'],
  description: 'Built SvelteKit applications with server-side rendering',
  content: '# Frontend Lead at SvelteKit Studios',
  startDate: '2023-06-01',
  endDate: '2025-01-01',
  jobRole: 'Frontend Lead',
  published: true,
};

const pythonEntry = {
  slug: 'python-eng',
  company: 'Data Corp',
  role: 'Backend Engineer',
  duration: '2020 - 2022',
  skills: ['Python', 'Django', 'PostgreSQL'],
  description: 'Built data pipelines and REST APIs',
  content: '# Backend Engineer at Data Corp',
  startDate: '2020-03-01',
  endDate: '2022-12-01',
  jobRole: 'Backend Engineer',
  published: true,
};

const fullstackEntry = {
  slug: 'fullstack-dev',
  company: 'WebCo',
  role: 'Full Stack Developer',
  duration: '2021 - 2024',
  skills: ['TypeScript', 'React', 'Svelte', 'Node.js'],
  description: 'Developed full-stack web applications using TypeScript and Svelte',
  content: '# Full Stack Developer at WebCo',
  startDate: '2021-01-15',
  endDate: '2024-06-01',
  jobRole: 'Full Stack Developer',
  published: true,
};

const allEntries = [svelteEntry, pythonEntry, fullstackEntry];

// ─── Helpers ──────────────────────────────────────────────────────────────────

let client: Client;
let clientTransport: InMemoryTransport;
let serverTransport: InMemoryTransport;

async function setupClient() {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  clientTransport = ct;
  serverTransport = st;
  client = new Client({ name: 'test-keywords', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), mcpServer.connect(serverTransport)]);
}

function getText(result: Awaited<ReturnType<typeof client.callTool>>): string {
  return (result.content as { type: string; text: string }[])[0].text;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('get_experience keywords filtering', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await setupClient();
  });

  afterEach(async () => {
    await clientTransport.close();
    await serverTransport.close();
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it('returns all entries when no keywords provided', async () => {
    vi.mocked(db.content.getExperience).mockResolvedValue(allEntries);

    const result = await client.callTool({ name: 'get_experience', arguments: {} });
    const text = getText(result);

    expect(text).toContain('SvelteKit Studios');
    expect(text).toContain('Data Corp');
    expect(text).toContain('WebCo');
    expect(text).toContain('---');
    expect(db.content.getExperience).toHaveBeenCalledTimes(1);
  });

  it('filters entries matching a single keyword in skills', async () => {
    vi.mocked(db.content.getExperience).mockResolvedValue(allEntries);

    const result = await client.callTool({
      name: 'get_experience',
      arguments: { keywords: 'Svelte' },
    });
    const text = getText(result);

    // svelteEntry has 'Svelte' in skills
    expect(text).toContain('SvelteKit Studios');
    // fullstackEntry has 'Svelte' in skills
    expect(text).toContain('WebCo');
    // pythonEntry has no Svelte
    expect(text).not.toContain('Data Corp');
  });

  it('filters entries matching keyword in description (case-insensitive)', async () => {
    vi.mocked(db.content.getExperience).mockResolvedValue(allEntries);

    const result = await client.callTool({
      name: 'get_experience',
      arguments: { keywords: 'sveltekit' },
    });
    const text = getText(result);

    // svelteEntry description: 'Built SvelteKit applications...'
    expect(text).toContain('SvelteKit Studios');
    // pythonEntry doesn't mention SvelteKit
    expect(text).not.toContain('Data Corp');
  });

  it('filters entries matching keyword in company name', async () => {
    vi.mocked(db.content.getExperience).mockResolvedValue(allEntries);

    const result = await client.callTool({
      name: 'get_experience',
      arguments: { keywords: 'Data Corp' },
    });
    const text = getText(result);

    expect(text).toContain('Backend Engineer');
    expect(text).toContain('Data Corp');
    expect(text).not.toContain('SvelteKit Studios');
    expect(text).not.toContain('WebCo');
  });

  it('filters entries matching keyword in jobRole', async () => {
    vi.mocked(db.content.getExperience).mockResolvedValue(allEntries);

    const result = await client.callTool({
      name: 'get_experience',
      arguments: { keywords: 'Frontend Lead' },
    });
    const text = getText(result);

    expect(text).toContain('SvelteKit Studios');
    expect(text).not.toContain('Data Corp');
    expect(text).not.toContain('WebCo');
  });

  // ── Comma-separated keywords ──────────────────────────────────────────────

  it('filters using comma-separated keywords (OR logic)', async () => {
    vi.mocked(db.content.getExperience).mockResolvedValue(allEntries);

    const result = await client.callTool({
      name: 'get_experience',
      arguments: { keywords: 'Svelte,TypeScript' },
    });
    const text = getText(result);

    // svelteEntry: has 'Svelte' in skills and 'TypeScript' in skills → match
    expect(text).toContain('SvelteKit Studios');
    // fullstackEntry: has 'TypeScript' in skills and 'Svelte' in skills → match
    expect(text).toContain('WebCo');
    // pythonEntry: no match for either term
    expect(text).not.toContain('Data Corp');
  });

  it('filters using space-separated keywords (OR logic)', async () => {
    vi.mocked(db.content.getExperience).mockResolvedValue(allEntries);

    const result = await client.callTool({
      name: 'get_experience',
      arguments: { keywords: 'Python Django' },
    });
    const text = getText(result);

    // pythonEntry has both 'Python' and 'Django' in skills → match
    expect(text).toContain('Data Corp');
    // svelteEntry and fullstackEntry don't match
    expect(text).not.toContain('SvelteKit Studios');
    expect(text).not.toContain('WebCo');
  });

  // ── Empty / no-match results ──────────────────────────────────────────────

  it('returns empty when keyword matches nothing', async () => {
    vi.mocked(db.content.getExperience).mockResolvedValue(allEntries);

    const result = await client.callTool({
      name: 'get_experience',
      arguments: { keywords: 'nonexistent123xyz' },
    });
    const text = getText(result);

    expect(text).toBe('');
  });

  it('returns all entries when keyword is empty string', async () => {
    vi.mocked(db.content.getExperience).mockResolvedValue(allEntries);

    const result = await client.callTool({
      name: 'get_experience',
      arguments: { keywords: '' },
    });
    const text = getText(result);

    // Empty string → no terms after filter → no filtering applied
    expect(text).toContain('SvelteKit Studios');
    expect(text).toContain('Data Corp');
    expect(text).toContain('WebCo');
  });

  // ── Date + keyword composition ────────────────────────────────────────────

  it('composes date range and keyword filters correctly', async () => {
    vi.mocked(db.content.getExperience).mockResolvedValue(allEntries);

    const result = await client.callTool({
      name: 'get_experience',
      arguments: {
        from: '2015-01-01',
        to: '2026-01-01',
        keywords: 'Svelte',
      },
    });
    const text = getText(result);

    // All entries have startDate within range; keyword filters to Svelte matches
    expect(text).toContain('SvelteKit Studios');
    expect(text).toContain('WebCo');
    expect(text).not.toContain('Data Corp');
  });

  it('date range narrows before keyword filter', async () => {
    vi.mocked(db.content.getExperience).mockResolvedValue(allEntries);

    // svelteEntry starts 2023-06-01, pythonEntry starts 2020-03-01, fullstackEntry starts 2021-01-15
    // from 2023-01-01 to 2026-01-01 → only svelteEntry survives date filter
    const result = await client.callTool({
      name: 'get_experience',
      arguments: {
        from: '2023-01-01',
        to: '2026-01-01',
        keywords: 'Svelte',
      },
    });
    const text = getText(result);

    expect(text).toContain('SvelteKit Studios');
    expect(text).not.toContain('Data Corp');
    expect(text).not.toContain('WebCo');
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('handles whitespace-only keywords gracefully', async () => {
    vi.mocked(db.content.getExperience).mockResolvedValue(allEntries);

    const result = await client.callTool({
      name: 'get_experience',
      arguments: { keywords: '   , ,  ' },
    });
    const text = getText(result);

    // Only whitespace/comma → no terms after filter → no filtering
    expect(text).toContain('SvelteKit Studios');
    expect(text).toContain('Data Corp');
    expect(text).toContain('WebCo');
  });

  it('keyword matching is case-insensitive', async () => {
    vi.mocked(db.content.getExperience).mockResolvedValue(allEntries);

    const result = await client.callTool({
      name: 'get_experience',
      arguments: { keywords: 'TYPESCRIPT' },
    });
    const text = getText(result);

    // svelteEntry and fullstackEntry have 'TypeScript' in skills
    expect(text).toContain('SvelteKit Studios');
    expect(text).toContain('WebCo');
    expect(text).not.toContain('Data Corp');
  });

  it('returns empty result when experience list is empty', async () => {
    vi.mocked(db.content.getExperience).mockResolvedValue([]);

    const result = await client.callTool({
      name: 'get_experience',
      arguments: { keywords: 'Svelte' },
    });
    const text = getText(result);

    expect(text).toBe('');
  });

  it('single-character keyword works correctly', async () => {
    vi.mocked(db.content.getExperience).mockResolvedValue(allEntries);

    // 'a' appears in many entries (company, description, etc.)
    const result = await client.callTool({
      name: 'get_experience',
      arguments: { keywords: 'Corp' },
    });
    const text = getText(result);

    // 'Data Corp' contains 'Corp'
    expect(text).toContain('Data Corp');
    // 'SvelteKit Studios' doesn't contain 'Corp'
    expect(text).not.toContain('SvelteKit Studios');
  });
});
