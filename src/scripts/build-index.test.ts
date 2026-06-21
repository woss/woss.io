import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock ALL external dependencies BEFORE imports
// ---------------------------------------------------------------------------

vi.mock('dotenv/config', () => ({}));

vi.mock('../lib/server/logger.js', () => ({
  initLogger: vi.fn().mockResolvedValue(undefined),
  CAT: { search: 'search' },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

vi.mock('../lib/server/db.js', () => ({
  getDb: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      run: vi.fn(),
      iterate: vi.fn(function* () {}),
    })),
    transaction: vi.fn((fn: (rows: unknown[]) => void) => fn),
  })),
  closeDb: vi.fn(),
}));

vi.mock('../lib/server/embed.js', () => ({
  embedTexts: vi.fn().mockResolvedValue([{ data: Array(1024).fill(0.1) }, { data: Array(1024).fill(0.2) }]),
  releaseExtractor: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./chunk-content.js', () => ({
  chunkContent: vi.fn().mockImplementation(async (body: string) => {
    if (!body || !body.trim()) return [];
    return [{ text: body, section: '', title: '', date: null, tags: [] }];
  }),
}));

vi.mock('./seed-data.js', () => ({
  centroidDataChanged: vi.fn().mockResolvedValue(false),
  embedAndComputeCentroids: vi.fn(),
  saveCentroids: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  readdirSync: vi.fn().mockReturnValue([]),
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

// Prevent module-level buildIndex().catch(...) from calling real process.exit
vi.stubGlobal('process', { ...process, exit: vi.fn() });

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import {
  computeChanges,
  processFile,
  parseSlugHashRows,
  asNumberArray,
  generateChunkId,
  extractToc,
  parseFrontmatterSlug,
  walkMdFiles,
  readFileEntries,
} from './build-index.js';

import { chunkContent } from './chunk-content.js';
import { embedTexts } from '../lib/server/embed.js';

import type { FileEntry } from './build-index.js';

import { readdirSync, existsSync, readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function entry(slug: string, hash: string, type: 'post' | 'experience' = 'post', relativePath?: string): FileEntry {
  return { slug, hash, type, relativePath: relativePath ?? `${slug}.md` };
}

function storedMap(...pairs: [string, string][]): Map<string, string> {
  return new Map(pairs);
}

// ===========================================================================
// Describe 1: computeChanges
// ===========================================================================

describe('computeChanges', () => {
  it('returns empty changes when all hashes match', () => {
    const files = [entry('hello', 'abc')];
    const stored = storedMap(['hello', 'abc']);

    const { changedEntries, removedSlugs } = computeChanges(files, stored, false);

    expect(changedEntries).toHaveLength(0);
    expect(removedSlugs).toHaveLength(0);
  });

  it('detects content modification via hash change', () => {
    const files = [entry('hello', 'newhash')];
    const stored = storedMap(['hello', 'oldhash']);

    const { changedEntries, removedSlugs } = computeChanges(files, stored, false);

    expect(changedEntries).toHaveLength(1);
    expect(changedEntries[0].slug).toBe('hello');
    expect(removedSlugs).toHaveLength(0);
  });

  it('detects new file not in stored hashes', () => {
    const files = [entry('new-file', 'hash123')];
    // 'other' has a stored hash but no matching current file → removed slug
    const stored = storedMap(['other', 'oldhash']);

    const { changedEntries, removedSlugs } = computeChanges(files, stored, false);

    expect(changedEntries).toHaveLength(1);
    expect(changedEntries[0].slug).toBe('new-file');
    expect(removedSlugs).toEqual(['other']);
  });

  it('detects file deletion (stored slug not in current)', () => {
    const files = [entry('current', 'hash123')];
    const stored = storedMap(['current', 'hash123'], ['deleted', 'oldhash']);

    const { changedEntries, removedSlugs } = computeChanges(files, stored, false);

    expect(changedEntries).toHaveLength(0);
    expect(removedSlugs).toEqual(['deleted']);
  });

  it('handles slug override — old slug removed, new slug changed', () => {
    // File now reports under frontmatter slug
    const files = [entry('new-frontmatter-slug', 'samehash')];
    // DB has the old filename slug
    const stored = storedMap(['old-filename-slug', 'samehash']);

    const { changedEntries, removedSlugs } = computeChanges(files, stored, false);

    // New slug not in stored → changed entry
    expect(changedEntries).toHaveLength(1);
    expect(changedEntries[0].slug).toBe('new-frontmatter-slug');
    // Old slug no longer in current files → removed
    expect(removedSlugs).toEqual(['old-filename-slug']);
  });

  it('treats all files as changed in --update mode', () => {
    const files = [entry('a', 'h1'), entry('b', 'h2')];
    const stored = storedMap(['a', 'h1'], ['b', 'h2']);

    const { changedEntries, removedSlugs } = computeChanges(files, stored, true);

    expect(changedEntries).toHaveLength(2);
    expect(removedSlugs).toHaveLength(0);
  });

  it('handles empty file entries', () => {
    const files: FileEntry[] = [];
    const stored = storedMap(['orphan', 'hash']);

    const { changedEntries, removedSlugs } = computeChanges(files, stored, false);

    expect(changedEntries).toHaveLength(0);
    expect(removedSlugs).toEqual(['orphan']);
  });
});

// ===========================================================================
// Describe 2: Pure utility functions
// ===========================================================================

describe('parseSlugHashRows', () => {
  it('parses valid rows', () => {
    const rows = [
      { slug: 'hello', hash: 'abc' },
      { slug: 'world', hash: 'def' },
    ];
    expect(parseSlugHashRows(rows)).toEqual([
      { slug: 'hello', hash: 'abc' },
      { slug: 'world', hash: 'def' },
    ]);
  });

  it('skips null/undefined rows', () => {
    const rows = [null, undefined, { slug: 'valid', hash: '123' }];
    const result = parseSlugHashRows(rows as unknown[]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ slug: 'valid', hash: '123' });
  });

  it('handles empty array', () => {
    expect(parseSlugHashRows([])).toEqual([]);
  });

  it('coerces missing fields to empty strings', () => {
    const rows = [
      { slug: 'hello' } as { slug: string; hash: string },
      { hash: 'abc' } as { slug: string; hash: string },
    ];
    expect(parseSlugHashRows(rows)).toEqual([
      { slug: 'hello', hash: '' },
      { slug: '', hash: 'abc' },
    ]);
  });
});

describe('asNumberArray', () => {
  it('converts valid number array', () => {
    expect(asNumberArray([1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('coerces string values to numbers', () => {
    expect(asNumberArray(['1', '2', '3'])).toEqual([1, 2, 3]);
  });

  it('returns empty for non-array input', () => {
    expect(asNumberArray(null)).toEqual([]);
    expect(asNumberArray(undefined)).toEqual([]);
    expect(asNumberArray('hello')).toEqual([]);
    expect(asNumberArray({})).toEqual([]);
  });

  it('returns empty for empty array', () => {
    expect(asNumberArray([])).toEqual([]);
  });
});

describe('generateChunkId', () => {
  it('generates correct format', () => {
    expect(generateChunkId('my-slug', 0)).toBe('my-slug_chunk_0');
    expect(generateChunkId('my-slug', 5)).toBe('my-slug_chunk_5');
  });

  it('handles slugs with special characters', () => {
    expect(generateChunkId('hello-world-123', 42)).toBe('hello-world-123_chunk_42');
  });
});

describe('extractToc', () => {
  it('extracts h2 and h3 headings', () => {
    const md = '## Intro\n\nSome text\n\n### Details\n\nMore text\n\n## Conclusion';
    const toc = extractToc(md);
    expect(toc).toHaveLength(3);
    expect(toc[0]).toEqual({ id: 'intro', text: 'Intro', level: 2 });
    expect(toc[1]).toEqual({ id: 'details', text: 'Details', level: 3 });
    expect(toc[2]).toEqual({ id: 'conclusion', text: 'Conclusion', level: 2 });
  });

  it('ignores headings inside fenced code blocks', () => {
    const md = '## Real heading\n\n```\n## Fake heading\n```\n\n### Another real';
    const toc = extractToc(md);
    expect(toc).toHaveLength(2);
    expect(toc[0].text).toBe('Real heading');
    expect(toc[1].text).toBe('Another real');
  });

  it('ignores headings inside inline code', () => {
    const md = '## Real heading\n\n`## fake heading` text\n\n### Another real';
    const toc = extractToc(md);
    expect(toc).toHaveLength(2);
    expect(toc[0].text).toBe('Real heading');
    expect(toc[1].text).toBe('Another real');
  });

  it('returns empty array when no headings', () => {
    expect(extractToc('Just plain text with no headings.')).toEqual([]);
  });
});

// ===========================================================================
// Describe 3: processFile with mocked dependencies
// ===========================================================================

describe('processFile', () => {
  beforeEach(() => {
    vi.mocked(chunkContent).mockClear();
    vi.mocked(embedTexts).mockClear();
  });

  it('processes content into rows and index keys', async () => {
    const content = '# Hello\n\nThis is a test post body with enough text to create chunks.';
    const file = {
      slug: 'test-post',
      title: 'Test Post',
      date: '2024-01-15',
      tags: ['test', 'example'],
      body: content,
      type: 'post' as const,
    };

    // chunkContent will return [text: content] by default (see mock above)
    // embedTexts returns [data: [0.1, ...], data: [0.2, ...]]

    const result = await processFile(file, 0);

    expect(result.rows).toHaveLength(1);
    expect(result.indexKeys).toHaveLength(1);

    const row = result.rows[0];
    expect(row.chunkId).toBe('test-post_chunk_0');
    expect(row.text).toBe(content);
    expect(row.title).toBe('Test Post');
    expect(row.date).toBe('2024-01-15');
    expect(row.tags).toEqual(['test', 'example']);
    expect(row.type).toBe('post');
    expect(row.embedding).toHaveLength(1024);
  });

  it('filters out empty chunks', async () => {
    vi.mocked(chunkContent).mockResolvedValueOnce([
      { text: '', section: '', title: '', date: null, tags: [] },
      { text: '  ', section: '', title: '', date: null, tags: [] },
    ]);

    const file = {
      slug: 'empty',
      title: 'Empty',
      date: null,
      tags: [],
      body: '',
      type: 'post' as const,
    };

    const result = await processFile(file, 0);
    expect(result.rows).toHaveLength(0);
    expect(result.indexKeys).toHaveLength(0);
  });

  it('uses chunk metadata when provided (title, date, tags overrides)', async () => {
    vi.mocked(chunkContent).mockResolvedValueOnce([
      {
        text: 'Chunk body text',
        section: 'Overview',
        title: 'Chunk Title',
        date: '2025-01-01',
        tags: ['chunk-tag'],
      },
    ]);

    const file = {
      slug: 'meta-test',
      title: 'File Title',
      date: '2024-01-01',
      tags: ['file-tag'],
      body: 'Some body text',
      type: 'post' as const,
    };

    const result = await processFile(file, 0);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.title).toBe('Chunk Title');
    expect(row.date).toBe('2025-01-01');
    expect(row.tags).toEqual(['chunk-tag']);
    expect(row.section).toBe('Overview');
  });

  it('applies chunkOffset to index keys', async () => {
    const file = {
      slug: 'offset-test',
      title: 'Offset',
      date: null,
      tags: [],
      body: 'Some body text here that will produce chunks',
      type: 'post' as const,
    };

    // First chunk will produce 1 row with offset=0 → key=1
    // With offset=100 → key=101
    const result = await processFile(file, 100);
    expect(result.indexKeys[0]).toBe(101n);
  });
});

// ===========================================================================
// Describe 4: parseFrontmatterSlug
// ===========================================================================

describe('parseFrontmatterSlug', () => {
  it('returns null for no frontmatter (no --- delimiters)', () => {
    expect(parseFrontmatterSlug('# Just a heading\n\nSome body text')).toBeNull();
  });

  it('returns null for invalid YAML inside frontmatter', () => {
    const raw = '---\n: invalid yaml [[[\n---\n# Content';
    expect(parseFrontmatterSlug(raw)).toBeNull();
  });

  it('returns null when slug is not a string (number, boolean)', () => {
    const numberSlug = '---\nslug: 42\n---\n# Content';
    expect(parseFrontmatterSlug(numberSlug)).toBeNull();
    const boolSlug = '---\nslug: true\n---\n# Content';
    expect(parseFrontmatterSlug(boolSlug)).toBeNull();
  });

  it('returns the slug when valid string frontmatter slug', () => {
    const raw = '---\nslug: my-custom-slug\n---\n# Hello\nWorld';
    expect(parseFrontmatterSlug(raw)).toBe('my-custom-slug');
  });

  it('returns null when frontmatter exists but has no slug field', () => {
    const raw = '---\ntitle: No Slug Here\ndate: 2024-01-01\n---\n# Content';
    expect(parseFrontmatterSlug(raw)).toBeNull();
  });
});

// ===========================================================================
// Describe 5: walkMdFiles
// ===========================================================================

describe('walkMdFiles', () => {
  beforeEach(() => {
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(existsSync).mockReturnValue(true);
  });

  afterEach(() => {
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(existsSync).mockReturnValue(true);
  });

  it('yields nothing when dir does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    const result = [...walkMdFiles('/nonexistent')];
    expect(result).toHaveLength(0);
  });

  it('yields nothing for empty directory', () => {
    const result = [...walkMdFiles('/empty-dir')];
    expect(result).toHaveLength(0);
  });

  it('yields .md file paths', () => {
    vi.mocked(readdirSync).mockReturnValue([{ name: 'post.md', isDirectory: () => false }] as unknown as never[]);
    const result = [...walkMdFiles('/posts')];
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/post\.md$/);
  });

  it('yields only .md files from a mix', () => {
    vi.mocked(readdirSync).mockReturnValue([
      { name: 'post.md', isDirectory: () => false },
      { name: 'notes.txt', isDirectory: () => false },
      { name: 'data.json', isDirectory: () => false },
    ] as unknown as never[]);
    const result = [...walkMdFiles('/posts')];
    expect(result).toHaveLength(1);
    expect(result[0]).toMatch(/post\.md$/);
  });

  it('recurses into subdirectories', () => {
    vi.mocked(readdirSync).mockImplementation((dirPath: unknown) => {
      if (typeof dirPath === 'string' && dirPath.includes('subdir')) {
        return [{ name: 'nested.md', isDirectory: () => false }] as unknown as never[];
      }
      return [
        { name: 'root.md', isDirectory: () => false },
        { name: 'subdir', isDirectory: () => true },
      ] as unknown as never[];
    });
    const result = [...walkMdFiles('/posts')];
    expect(result).toHaveLength(2);
    expect(result.some((p) => p.endsWith('root.md'))).toBe(true);
    expect(result.some((p) => p.endsWith('nested.md'))).toBe(true);
  });
});

// ===========================================================================
// Describe 6: readFileEntries
// ===========================================================================

describe('readFileEntries', () => {
  beforeEach(() => {
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('');
  });

  afterEach(() => {
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue('');
  });

  it('returns empty array when walkMdFiles yields nothing', () => {
    const result = readFileEntries();
    expect(result).toHaveLength(0);
  });

  it('returns post entries from POSTS_DIR', () => {
    vi.mocked(readdirSync).mockImplementation((dirPath: unknown) => {
      if (typeof dirPath === 'string' && dirPath.includes('posts')) {
        return [{ name: 'hello.md', isDirectory: () => false }] as unknown as never[];
      }
      return [];
    });
    vi.mocked(readFileSync).mockReturnValue('# Hello\nWorld');
    const result = readFileEntries();
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe('hello');
    expect(result[0].type).toBe('post');
    expect(result[0].hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses frontmatter slug when present (overrides filename slug)', () => {
    vi.mocked(readdirSync).mockImplementation((dirPath: unknown) => {
      if (typeof dirPath === 'string' && dirPath.includes('posts')) {
        return [{ name: 'hello.md', isDirectory: () => false }] as unknown as never[];
      }
      return [];
    });
    vi.mocked(readFileSync).mockReturnValue('---\nslug: my-custom-slug\n---\n# Hello\nWorld');
    const result = readFileEntries();
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe('my-custom-slug');
  });

  it('returns experience entries from EXPERIENCE_DIR', () => {
    vi.mocked(readdirSync).mockImplementation((dirPath: unknown) => {
      if (typeof dirPath === 'string' && dirPath.includes('experience')) {
        return [{ name: 'work.md', isDirectory: () => false }] as unknown as never[];
      }
      return [];
    });
    vi.mocked(readFileSync).mockReturnValue('# Work Experience\nWorked at a company.');
    const result = readFileEntries();
    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe('work');
    expect(result[0].type).toBe('experience');
  });
});
