import 'dotenv/config';

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import GithubSlugger from 'github-slugger';
import { Index, MetricKind, ScalarKind } from 'usearch';
import Database from 'better-sqlite3';
import { parseFrontmatter } from '../content/index.js';
import { load as parseYaml } from 'js-yaml';
import { getDb, closeDb } from '../lib/server/db.js';
import { embedTexts, releaseExtractor } from '../lib/server/embed.js';
import { chunkContent } from './chunk-content.js';
import { initDatabase } from '../lib/server/schema.js';
import { initLogger, CAT, createLogger } from '../lib/server/logger.js';
import { centroidDataChanged, embedAndComputeCentroids, saveCentroids } from './seed-data.js';
import { saveEmbeddingVisualizations } from './visualize-embedding-space.js';

// ---------------------------------------------------------------------------
// Frontmatter helpers
// ---------------------------------------------------------------------------

/**
 * YAML frontmatter regex — matches `---\n...\n---` at start of file.
 */
const YAML_FM_RE = /^---\n([\s\S]*?)\n---\n?/;

/**
 * Extract slug from frontmatter YAML, if present.
 * Uses js-yaml (same parser as parseMarkdownFrontmatter).
 * Returns null if no frontmatter or no slug field.
 */
export function parseFrontmatterSlug(raw: string): string | null {
  const match = raw.match(YAML_FM_RE);
  if (!match) return null;
  try {
    const data = parseYaml(match[1]) as Record<string, unknown>;
    if (data?.slug && typeof data.slug === 'string') return data.slug;
  } catch {
    /* ignore parse errors — fall through to null */
  }
  return null;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DATA_DIR = './data';
const INDEX_PATH = `${DATA_DIR}/woss.usearch`;

const POSTS_DIR = join(process.cwd(), 'src', 'content', 'posts');
const EXPERIENCE_DIR = join(process.cwd(), 'src', 'content', 'experience');

const args = process.argv.slice(2);
const update = args.includes('--update');

await initLogger((process.env.LOG_LEVEL as 'trace' | 'debug' | 'info' | 'warning' | 'error') || 'info');
const log = createLogger(CAT.search);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ContentItem {
  slug: string;
  title: string;
  date: string | null;
  tags: string[];
  body: string;
  type: 'post' | 'experience';
}

export interface ChunkRow {
  chunkId: string;
  text: string;
  title: string;
  date: string | null;
  tags: string[];
  section: string;
  embedding: number[];
  type: string;
}

export interface ProcessResult {
  rows: ChunkRow[];
  indexKeys: bigint[];
}

export interface FileEntry {
  slug: string;
  relativePath: string;
  type: 'post' | 'experience';
  hash: string;
  dirTag?: string;
}

/**
 * Safely parse unknown SQL rows with slug/hash shape.
 * @param rows The raw rows from the database.
 * @returns An array of safe slug/hash pairs.
 */
export function parseSlugHashRows(rows: unknown[]): { slug: string; hash: string }[] {
  const parsed: { slug: string; hash: string }[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    parsed.push({ slug: String(Reflect.get(row, 'slug') ?? ''), hash: String(Reflect.get(row, 'hash') ?? '') });
  }
  return parsed;
}

/**
 * Safely coerce an unknown value from JSON parse to a number array.
 * @param value The parsed JSON value.
 * @returns A number array.
 */
export function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (const v of value) out.push(Number(v));
  return out;
}

/**
 * Generate a unique chunk ID based on the file slug and chunk index. This ensures stable IDs across runs for unchanged files, which allows us to skip re-indexing unchanged content.
 * @param slug The slug of the content item.
 * @param index The index of the chunk within the content item.
 * @returns A unique chunk ID.
 */
export function generateChunkId(slug: string, index: number): string {
  return `${slug}_chunk_${index}`;
}

/**
 * Extract table of contents entries from raw markdown content.
 * Uses GitHub-slugger algorithm to match rehype-slug's ID generation.
 */
export function extractToc(content: string): { id: string; text: string; level: number }[] {
  const slugger = new GithubSlugger();
  const toc: { id: string; text: string; level: number }[] = [];

  // Remove fenced code blocks to avoid false positives
  const withoutCode = content.replace(/```[\s\S]*?```/g, '');
  // Remove inline code to avoid false positives
  const withoutInlineCode = withoutCode.replace(/`[^`]+`/g, '');

  const headingRegex = /^(#{2,3})\s+(.+)$/gm;
  let match;
  while ((match = headingRegex.exec(withoutInlineCode)) !== null) {
    const level = match[1].length; // 2 or 3
    const text = match[2].trim();
    const id = slugger.slug(text);
    toc.push({ id, text, level });
  }

  return toc;
}

/**
 * Recursively walk a directory and yield all markdown file paths.
 * @param dir The directory to walk.
 */
export function* walkMdFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkMdFiles(fullPath);
    else if (entry.name.endsWith('.md')) yield fullPath;
  }
}

/**
 * Read all content files and compute per-file SHA-256 hashes.
 * Frontmatter `slug` field overrides filename-derived slug when present.
 * @returns An array of file entries with slug, type, and hash.
 */
export function readFileEntries(): FileEntry[] {
  const entries: FileEntry[] = [];

  for (const fp of walkMdFiles(POSTS_DIR)) {
    const raw = readFileSync(fp, 'utf-8');
    const relativePath = fp.replace(POSTS_DIR + '/', '');
    const dirTag = relativePath.includes('/') ? relativePath.split('/')[0] : undefined;
    const hash = createHash('sha256').update(raw).digest('hex');
    // Frontmatter slug overrides filename slug — critical for hash key consistency
    const slug = parseFrontmatterSlug(raw) ?? basename(relativePath, '.md');
    entries.push({ slug, relativePath, type: 'post', hash, dirTag });
  }

  for (const fp of walkMdFiles(EXPERIENCE_DIR)) {
    const raw = readFileSync(fp, 'utf-8');
    const relativePath = fp.replace(EXPERIENCE_DIR + '/', '');
    const dirTag = relativePath.includes('/') ? relativePath.split('/')[0] : undefined;
    const hash = createHash('sha256').update(raw).digest('hex');
    const slug = parseFrontmatterSlug(raw) ?? basename(relativePath, '.md');
    entries.push({ slug, relativePath, type: 'experience', hash, dirTag });
  }

  return entries;
}

export interface ChangeResult {
  changedEntries: FileEntry[];
  removedSlugs: string[];
}

/**
 * Compare file entries against stored hashes to determine what changed.
 * Pure function — no side effects, no logging. Exported for testing.
 * @param fileEntries Current file entries from readFileEntries().
 * @param storedHashes Map of slug→hash from previous build (from DB).
 * @param update If true, treat all files as changed.
 * @returns Object with changedEntries and removedSlugs arrays.
 */
export function computeChanges(
  fileEntries: FileEntry[],
  storedHashes: Map<string, string>,
  update: boolean,
): ChangeResult {
  const changedEntries: FileEntry[] = [];
  const currentSlugs = new Set(fileEntries.map((e) => e.slug));

  for (const entry of fileEntries) {
    if (update) {
      changedEntries.push(entry);
    } else {
      const stored = storedHashes.get(entry.slug);
      if (stored !== entry.hash) {
        changedEntries.push(entry);
      }
    }
  }

  const removedSlugs: string[] = [];
  for (const [slug] of storedHashes) {
    if (!currentSlugs.has(slug)) {
      removedSlugs.push(slug);
    }
  }

  return { changedEntries, removedSlugs };
}

/**
 * Process one content item through chunk → filter → embed → row-build.
 * Exported for testing. Returns rows for SQLite + keys for USearch.
 * @param file The content item to process.
 * @param chunkOffset The offset to apply to chunk indices for generating unique IDs.
 * @returns An object containing rows for SQLite and keys for USearch.
 */
export async function processFile(file: ContentItem, chunkOffset: number): Promise<ProcessResult> {
  const chunks = await chunkContent(file.body, {
    title: file.title,
    date: file.date,
    tags: file.tags,
  });

  const validChunks = chunks.filter((c) => c.text && c.text.trim());
  if (validChunks.length === 0) return { rows: [], indexKeys: [] };

  const embeddings = await embedTexts(validChunks.map((c) => c.text));

  const rows: ChunkRow[] = [];
  const indexKeys: bigint[] = [];

  for (let i = 0; i < validChunks.length; i++) {
    const chunk = validChunks[i];
    const embedding = embeddings[i];
    rows.push({
      chunkId: generateChunkId(file.slug, i),
      text: chunk.text,
      title: chunk.title || file.title,
      date: chunk.date || file.date,
      tags: chunk.tags?.length ? chunk.tags : file.tags,
      section: chunk.section || '',
      embedding: embedding.data,
      type: file.type,
    });
    indexKeys.push(BigInt(chunkOffset + i + 1));
  }

  return { rows, indexKeys };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function buildIndex(): Promise<void> {
  // Ensure database exists — create schema if missing
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

  const dbPath = 'data/woss.db';
  if (!existsSync(dbPath)) {
    log.info`Database not found. Initializing schema...`;
    const tmp = new Database(dbPath);
    tmp.exec('PRAGMA journal_mode = WAL');
    tmp.exec('PRAGMA foreign_keys = ON');
    initDatabase(tmp);
    tmp.close();
    log.info`Database created successfully.`;
  }

  if (await centroidDataChanged(log)) {
    log.info`Computing and saving centroids... [centroids]`;
    const { toolCentroid, ragCentroid, metaCentroid, queries, vectors } = await embedAndComputeCentroids(log);
    await saveCentroids({ toolCentroid, ragCentroid, metaCentroid, queries, vectors }, log);
    await saveEmbeddingVisualizations(queries, vectors, toolCentroid, ragCentroid, './static/misc', metaCentroid);
    log.info`Done. [centroids]`;
  } else {
    log.info`Centroid data unchanged. Skipping centroid computation. [centroids]`;
  }

  // Free BGE model memory (~1.3GB) before chunk embedding phase
  await releaseExtractor();

  // Retry getDb with backoff — transient IOERR on new DB after reset
  const maxDbInitRetries = 3;
  let db: ReturnType<typeof getDb>;
  for (let dbInitAttempt = 1; ; dbInitAttempt++) {
    try {
      db = getDb();
      break;
    } catch (err) {
      if (dbInitAttempt >= maxDbInitRetries || !(err instanceof Error && err.message.includes('IOERR_SHORT_READ'))) {
        throw err;
      }
      log.debug`getDb attempt ${dbInitAttempt} failed (IOERR_SHORT_READ), retrying...`;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  // 1. Read all content files with per-file SHA-256 hashes
  const fileEntries = readFileEntries();

  if (fileEntries.length === 0) {
    log.info`No content files found in src/content/posts/ or src/content/experience/`;
    closeDb();
    return;
  }

  log.info`Content files: ${fileEntries.length}`;

  // 2. Read stored hashes from previous build
  const storedHashes = new Map<string, string>();
  for (const row of parseSlugHashRows(db.prepare('SELECT slug, hash FROM page_posts').all())) {
    storedHashes.set(row.slug, row.hash);
  }
  for (const row of parseSlugHashRows(db.prepare('SELECT slug, hash FROM page_experience').all())) {
    storedHashes.set(row.slug, row.hash);
  }

  // 3. Compare — only unchanged files can be skipped
  const { changedEntries, removedSlugs } = computeChanges(fileEntries, storedHashes, update);

  // Log hash mismatches for debugging
  for (const entry of changedEntries) {
    if (!update) {
      log.debug`  hash mismatch: slug=${entry.slug} stored=${storedHashes.get(entry.slug) ?? '(not in map)'} current=${entry.hash}`;
    }
  }

  // 4. Early exit if nothing changed and index exists
  if (changedEntries.length === 0 && removedSlugs.length === 0) {
    if (existsSync(INDEX_PATH)) {
      log.info`No content changes detected. Skipping rebuild.`;
      closeDb();
      return;
    }
    log.info`Content unchanged but index file missing. Rebuilding index from database...`;
  } else {
    log.info`Changes: ${changedEntries.length} file(s) ${update ? '(forced update)' : 'modified'}, ${removedSlugs.length} file(s) removed`;
  }

  // 5. Delete obsolete chunks
  const deleteChunks = db.prepare('DELETE FROM chunks WHERE chunk_id LIKE ?');
  const deletePagePost = db.prepare('DELETE FROM page_posts WHERE slug = ?');
  const deletePageExperience = db.prepare('DELETE FROM page_experience WHERE slug = ?');

  for (const entry of changedEntries) {
    deleteChunks.run(`${entry.slug}_chunk_%`);
  }

  for (const slug of removedSlugs) {
    deleteChunks.run(`${slug}_chunk_%`);
    deletePagePost.run(slug);
    deletePageExperience.run(slug);
    log.debug`  removed: ${slug}`;
  }

  // 6. Process changed/new files — chunk, embed, insert, store hash
  const insertChunk = db.prepare(`
    INSERT OR IGNORE INTO chunks (chunk_id, text, title, date, tags, section, embedding, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((rows: ChunkRow[]) => {
    for (const r of rows) {
      insertChunk.run(
        r.chunkId,
        r.text,
        r.title ?? '',
        r.date ?? null,
        JSON.stringify(r.tags ?? []),
        r.section ?? '',
        JSON.stringify(r.embedding),
        r.type,
      );
    }
  });

  let newChunks = 0;
  // Track part_of_series slugs for second-pass resolution (slug → series slug)
  const seriesMap = new Map<string, string | null>();

  for (const entry of changedEntries) {
    log.info`  Processing ${entry.slug}…`;
    try {
      // Re-read file to get parsed content
      let dir: string;
      if (entry.type === 'post') dir = POSTS_DIR;
      else if (entry.type === 'experience') dir = EXPERIENCE_DIR;
      else continue;
      const fp = join(dir, entry.relativePath);
      const raw = readFileSync(fp, 'utf-8');
      const { data, content } = await parseFrontmatter(raw);

      // Allow frontmatter slug to override filename-derived slug
      if (data.slug && typeof data.slug === 'string') entry.slug = data.slug;

      // Parse header_image from markdown link "[alt](url)" into structured object
      if (data.header_image && typeof data.header_image === 'string') {
        const linkMatch = /\[([^\]]*)\]\(([^)]*)\)/.exec(data.header_image);
        data.header_image = linkMatch ? { alt: linkMatch[1], url: linkMatch[2] } : null;
      }

      // Process title, date, tags — handle Date objects from frontmatter
      let title: string;
      let date: string | null;
      let tags: string[];

      if (entry.type === 'post') {
        title = String(data.title ?? '') || entry.slug;
        const rawDate = data.date;
        date = rawDate instanceof Date ? rawDate.toISOString() : rawDate ? String(rawDate) : null;
        tags = [...new Set<string>(Array.isArray(data.tags) ? data.tags.map(String) : [])];
        if (entry.dirTag) tags = [...new Set([...tags, entry.dirTag])];
      } else {
        const company = String(data.company ?? '');
        const role = String(data.role ?? '');
        title = company ? `${company} — ${role}` : entry.slug;
        const rawStartDate = data.startDate;
        date = rawStartDate instanceof Date ? rawStartDate.toISOString() : rawStartDate ? String(rawStartDate) : null;
        tags = [...new Set<string>(Array.isArray(data.skills) ? data.skills.map(String) : [])];
        if (entry.dirTag) tags = [...new Set([...tags, entry.dirTag])];
      }

      // Process date fields that may be Date objects from frontmatter parsing
      let processedStartDate: string | null = null;
      let processedEndDate: string | null = null;
      if (entry.type === 'experience') {
        const rawStart = data.startDate;
        processedStartDate = rawStart instanceof Date ? rawStart.toISOString() : rawStart ? String(rawStart) : null;
        const rawEnd = data.endDate;
        processedEndDate = rawEnd instanceof Date ? rawEnd.toISOString() : rawEnd ? String(rawEnd) : null;
      }

      // Save full content to page_posts or page_experience table
      const toc = JSON.stringify(extractToc(content || raw));
      if (entry.type === 'post') {
        // Read part_of_series slug from frontmatter (resolved to ID in second pass)
        const seriesSlug = data.part_of_series ? String(data.part_of_series) : null;
        db.prepare(
          `INSERT INTO page_posts (slug, hash, content, toc, title, description, date, tags, status, excerpt, header_image, featured, position, part_of_series, workflow_files, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now')) ON CONFLICT(slug) DO UPDATE SET hash = excluded.hash, content = excluded.content, toc = excluded.toc, title = excluded.title, description = excluded.description, date = excluded.date, tags = excluded.tags, status = excluded.status, excerpt = excluded.excerpt, header_image = excluded.header_image, featured = excluded.featured, position = excluded.position, part_of_series = excluded.part_of_series, workflow_files = excluded.workflow_files, updated_at = excluded.updated_at`,
        ).run(
          entry.slug,
          entry.hash,
          content || raw,
          toc,
          title,
          data.description ?? '',
          date,
          JSON.stringify(tags),
          data.status || (data.published !== false ? 'published' : 'draft'),
          data.excerpt ?? '',
          JSON.stringify(data.header_image ?? null),
          data.featured ? 1 : 0,
          data.position ?? null,
          null, // part_of_series — resolved in second pass below
          data.workflow_files ? JSON.stringify(data.workflow_files) : null,
        );
        seriesMap.set(entry.slug, seriesSlug);

        // Determine post status for chunk gating
        const postStatus = data.status || (data.published !== false ? 'published' : 'draft');

        // Skip chunking for non-published posts
        if (postStatus !== 'published') {
          log.debug`    ↳ skipping: status=${postStatus}`;
          continue;
        }
      } else {
        db.prepare(
          `INSERT OR REPLACE INTO page_experience (slug, hash, content, company, role, start_date, end_date, duration, skills, description, published, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
        ).run(
          entry.slug,
          entry.hash,
          content || raw,
          data.company ?? '',
          data.role ?? '',
          processedStartDate,
          processedEndDate,
          data.duration ?? '',
          JSON.stringify(data.skills ?? []),
          data.description ?? '',
          data.published !== false ? 1 : 0,
        );
      }
      const item: ContentItem = {
        slug: entry.slug,
        title,
        date,
        tags,
        body: content || raw,
        type: entry.type,
      };

      const { rows } = await processFile(item, 0);
      if (rows.length === 0) {
        log.debug`    ↳ skipped (no valid chunks)`;
        continue;
      }

      insertMany(rows);
      newChunks += rows.length;
      log.debug`    ↳ ${rows.length} chunks indexed`;
    } catch (err) {
      const processErr = err instanceof Error ? err : new Error(String(err));
      log.error`  ⚠ Failed to process ${entry.slug}: ${processErr.message}`;
    }
  }

  // Second pass: resolve part_of_series slugs to page_posts.id
  const seriesUpdate = db.prepare('UPDATE page_posts SET part_of_series = ? WHERE slug = ?');
  const slugToId = new Map<string, number>();
  const allRows = db.prepare('SELECT id, slug FROM page_posts').all() as { id: number; slug: string }[];
  for (const row of allRows) {
    slugToId.set(row.slug, row.id);
  }
  let seriesCount = 0;
  for (const [childSlug, parentSlug] of seriesMap) {
    if (parentSlug && slugToId.has(parentSlug)) {
      seriesUpdate.run(slugToId.get(parentSlug)!, childSlug);
      seriesCount++;
    }
  }
  if (seriesCount > 0) {
    log.info`Part of series: ${seriesCount} post(s) linked`;
  }

  // Free BGE model memory before USearch index rebuild
  await releaseExtractor();

  // 8. Rebuild USearch index from all SQLite rows (streaming)
  const index: Index = new Index({
    dimensions: 1024,
    metric: MetricKind.Cos,
    quantization: ScalarKind.BF16,
    connectivity: 16,
    expansion_add: 128,
    expansion_search: 200,
    multi: false,
  });
  let rowCount = 0;
  const iter: IterableIterator<unknown> = db.prepare('SELECT id, embedding FROM chunks').iterate();
  for (const rawRow of iter) {
    if (typeof rawRow !== 'object' || rawRow === null) continue;
    const id = Number(Reflect.get(rawRow, 'id') ?? 0);
    const embedding = asNumberArray(JSON.parse(String(Reflect.get(rawRow, 'embedding') ?? '[]')));
    index.add(BigInt(id), new Float32Array(embedding));
    rowCount++;
    // Allow GC to reclaim per-row allocations
    if (rowCount % 100 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (rowCount === 0) {
    log.debug`No chunks in database. Skipping index save.`;
    closeDb();
    return;
  }

  index.save(INDEX_PATH);

  // Index is persisted to disk; native USearch memory will be released when the process exits

  log.info`\nSaved USearch index (${rowCount} vectors) to ${INDEX_PATH}`;
  log.info`${JSON.stringify({
    total: rowCount,
    fileCount: fileEntries.length,
    newChunks,
  })}`;

  closeDb();
}

buildIndex().catch((err) => {
  log.error`Build failed: ${err}`;
  try {
    closeDb();
  } catch {
    /* ignore close errors during crash */
  }
  process.exit(1);
});
