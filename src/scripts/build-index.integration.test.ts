import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { initDatabase } from '../lib/server/schema.js';
import { parseSlugHashRows, computeChanges } from './build-index.js';
import type { FileEntry } from './build-index.js';

const TEST_DB_PATH = join(process.cwd(), 'data/test-woss.db');

function cleanSchema(db: Database.Database): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  initDatabase(db);
}

describe('build-index integration (real SQLite)', () => {
  let db: Database.Database;

  beforeAll(() => {
    const dataDir = dirname(TEST_DB_PATH);
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    db = new Database(TEST_DB_PATH);
    cleanSchema(db);
  });

  afterAll(() => {
    if (db) db.close();
    if (existsSync(TEST_DB_PATH)) unlinkSync(TEST_DB_PATH);
  });

  beforeEach(() => {
    db.exec('DELETE FROM chunks');
    db.exec('DELETE FROM page_posts');
    db.exec('DELETE FROM page_experience');
  });

  it('parseSlugHashRows with real DB rows', () => {
    db.prepare('INSERT INTO page_posts (slug, hash, content) VALUES (?, ?, ?)').run('hello', 'abc123', 'first post');
    db.prepare('INSERT INTO page_posts (slug, hash, content) VALUES (?, ?, ?)').run('world', 'def456', 'second post');

    const rows = db.prepare('SELECT slug, hash FROM page_posts').all();
    const result = parseSlugHashRows(rows);

    expect(result).toEqual([
      { slug: 'hello', hash: 'abc123' },
      { slug: 'world', hash: 'def456' },
    ]);
  });

  it('hash query -> Map -> computeChanges: all match', () => {
    db.prepare('INSERT INTO page_posts (slug, hash, content) VALUES (?, ?, ?)').run('a', 'hash1', 'content A');
    db.prepare('INSERT INTO page_posts (slug, hash, content) VALUES (?, ?, ?)').run('b', 'hash2', 'content B');

    const storedHashes = new Map<string, string>();
    for (const row of parseSlugHashRows(db.prepare('SELECT slug, hash FROM page_posts').all())) {
      storedHashes.set(row.slug, row.hash);
    }

    const files: FileEntry[] = [
      { slug: 'a', hash: 'hash1', type: 'post', relativePath: 'a.md' },
      { slug: 'b', hash: 'hash2', type: 'post', relativePath: 'b.md' },
    ];

    const { changedEntries, removedSlugs } = computeChanges(files, storedHashes, false);

    expect(changedEntries).toHaveLength(0);
    expect(removedSlugs).toHaveLength(0);
  });

  it('hash mismatch detection', () => {
    db.prepare('INSERT INTO page_posts (slug, hash, content) VALUES (?, ?, ?)').run(
      'test-post',
      'oldhash',
      'some content',
    );

    const storedHashes = new Map<string, string>();
    for (const row of parseSlugHashRows(db.prepare('SELECT slug, hash FROM page_posts').all())) {
      storedHashes.set(row.slug, row.hash);
    }

    const files: FileEntry[] = [{ slug: 'test-post', hash: 'newhash', type: 'post', relativePath: 'test-post.md' }];

    const { changedEntries, removedSlugs } = computeChanges(files, storedHashes, false);

    expect(changedEntries).toHaveLength(1);
    expect(changedEntries[0].slug).toBe('test-post');
    expect(removedSlugs).toHaveLength(0);
  });

  it('slug override detection (frontmatter slug != filename slug)', () => {
    db.prepare('INSERT INTO page_posts (slug, hash, content) VALUES (?, ?, ?)').run('old-filename', 'abc', 'content');

    const storedHashes = new Map<string, string>();
    for (const row of parseSlugHashRows(db.prepare('SELECT slug, hash FROM page_posts').all())) {
      storedHashes.set(row.slug, row.hash);
    }

    const files: FileEntry[] = [
      {
        slug: 'new-frontmatter-slug',
        hash: 'abc',
        type: 'post',
        relativePath: 'old-filename.md',
      },
    ];

    const { changedEntries, removedSlugs } = computeChanges(files, storedHashes, false);

    expect(changedEntries).toHaveLength(1);
    expect(changedEntries[0].slug).toBe('new-frontmatter-slug');
    expect(removedSlugs).toEqual(['old-filename']);
  });

  it('file deletion detection', () => {
    db.prepare('INSERT INTO page_posts (slug, hash, content) VALUES (?, ?, ?)').run('keep-me', 'hash1', 'content keep');
    db.prepare('INSERT INTO page_posts (slug, hash, content) VALUES (?, ?, ?)').run(
      'delete-me',
      'hash2',
      'content delete',
    );

    const storedHashes = new Map<string, string>();
    for (const row of parseSlugHashRows(db.prepare('SELECT slug, hash FROM page_posts').all())) {
      storedHashes.set(row.slug, row.hash);
    }

    const files: FileEntry[] = [{ slug: 'keep-me', hash: 'hash1', type: 'post', relativePath: 'keep-me.md' }];

    const { changedEntries, removedSlugs } = computeChanges(files, storedHashes, false);

    expect(changedEntries).toHaveLength(0);
    expect(removedSlugs).toEqual(['delete-me']);
  });

  it('delete old chunks + re-insert workflow', () => {
    db.prepare(
      'INSERT INTO chunks (chunk_id, text, title, date, tags, section, embedding, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('test-post_chunk_0', 'some text', 'Post', null, '[]', '', '[0.1,0.2]', 'post');

    const before = db.prepare('SELECT COUNT(*) AS c FROM chunks').get() as { c: number };
    expect(before.c).toBe(1);

    db.prepare('DELETE FROM chunks WHERE chunk_id LIKE ?').run('test-post_chunk_%');

    const afterDelete = db.prepare('SELECT COUNT(*) AS c FROM chunks').get() as {
      c: number;
    };
    expect(afterDelete.c).toBe(0);

    db.prepare(
      'INSERT INTO chunks (chunk_id, text, title, date, tags, section, embedding, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run('test-post_chunk_0', 'new text', 'Post', null, '[]', '', '[0.3,0.4]', 'post');

    const afterReinsert = db.prepare('SELECT COUNT(*) AS c FROM chunks').get() as {
      c: number;
    };
    expect(afterReinsert.c).toBe(1);
  });
});
