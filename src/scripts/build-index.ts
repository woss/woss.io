import 'dotenv/config';

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import GithubSlugger from 'github-slugger';
import { parseFrontmatter } from '../content/index.js';
import { load as parseYaml } from 'js-yaml';
import { SurrealDatabaseService } from '../lib/server/db/surreal-service';
import type { IDatabaseService } from '../lib/server/db/interfaces';
import { downloadEmbedder, embedTexts, releaseExtractor } from '../lib/server/embed.js';
// Future: cross-encoder re-ranker (src/lib/server/reranker.ts)
// import { downloadReranker } from '../lib/server/reranker.js';
import { chunkContent } from './chunk-content.js';
import { initLogger, CAT, createLogger } from '../lib/server/logger.js';
import { dispose } from '@logtape/logtape';
import type { Logger } from '@logtape/logtape';
import { saveEmbeddingVisualizations } from './visualize-embedding-space.js';
import { SEED_QUERIES, type QueryClass } from '../lib/chat/suggested-questions.ts';
import { EMBEDDING_DIM, EMBEDDING_MODEL } from '../lib/search-config.ts';

// Create standalone SurrealDB service instance (no SvelteKit $lib dependency)
const db: IDatabaseService = new SurrealDatabaseService();

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
  date: string;
  tags: string[];
  body: string;
  type: 'post' | 'experience';
}

export interface ChunkRow {
  chunkId: string;
  text: string;
  title: string;
  date: string;
  tags: string[];
  section: string;
  embedding: number[];
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
/**
 * Extract the text under the `## Job role` heading from markdown content.
 * Returns everything between that heading and the next `##` heading (or end of string), trimmed.
 */
export function extractJobRole(content: string): string {
  const match = content.match(/^##\s+Job\s*role\s*\n([\s\S]*?)(?=\n##|\n*$)/im);
  return match ? match[1].trim() : '';
}

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
 * Exported for testing. Returns rows + index keys.
 * @param file The content item to process.
 * @param chunkOffset The offset to apply to chunk indices for generating unique IDs.
 * @returns An object containing rows and index keys.
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
    });
    indexKeys.push(BigInt(chunkOffset + i + 1));
  }

  return { rows, indexKeys };
}

// ---------------------------------------------------------------------------
// Centroid helpers — embedded here so all SurrealDB access shares one singleton
// ---------------------------------------------------------------------------

/** Result of embedding seed queries and computing centroids */
interface EmbedResult {
  queries: typeof SEED_QUERIES;
  vectors: number[][];
  toolCentroid: number[];
  ragCentroid: number[];
  metaCentroid: number[];
}

const CENTROID_CLASSES: QueryClass[] = ['tool', 'rag', 'meta'];

/** Compute element-wise average of a set of vectors of equal length */
function averageVector(vecs: number[][]): number[] {
  const dim = vecs[0].length;
  const avg = new Array(dim).fill(0);
  for (const v of vecs) for (let i = 0; i < dim; i++) avg[i] += v[i] / vecs.length;
  return avg;
}

/** Compute a hash for a centroid class from its seed queries + model + dims */
function centroidHashForClass(qclass: QueryClass): string {
  const qs = SEED_QUERIES.filter((q) => q.class === qclass);
  const data = JSON.stringify({ queries: qs, model: EMBEDDING_MODEL, dims: EMBEDDING_DIM });
  return createHash('sha256').update(data).digest('hex');
}

/** Map of centroid class → current hash */
function computeAllCentroidHashes(): Record<string, string> {
  const h: Record<string, string> = {};
  for (const c of CENTROID_CLASSES) h[c] = centroidHashForClass(c);
  return h;
}

/**
 * Embed all seed queries and compute tool/rag/meta centroids.
 * Uses BGE large en v1.5 via existing embedText pipeline.
 */
async function embedAndComputeCentroids(log: Logger): Promise<EmbedResult> {
  log.debug`Embedding ${SEED_QUERIES.length} seed queries (${SEED_QUERIES.filter((q) => q.class === 'tool').length} tool, ${SEED_QUERIES.filter((q) => q.class === 'rag').length} rag, ${SEED_QUERIES.filter((q) => q.class === 'hybrid').length} hybrid, ${SEED_QUERIES.filter((q) => q.class === 'meta').length} meta)...`;
  const vectors = (await embedTexts(SEED_QUERIES.map((q) => q.text))).map((r) => r.data);

  const toolVecs = vectors.filter((_, i) => SEED_QUERIES[i].class === 'tool');
  const ragVecs = vectors.filter((_, i) => SEED_QUERIES[i].class === 'rag');
  const metaVecs = vectors.filter((_, i) => SEED_QUERIES[i].class === 'meta');

  log.debug`Embedded ${SEED_QUERIES.length} seed queries...`;
  const toolCentroid = averageVector(toolVecs);
  const ragCentroid = averageVector(ragVecs);
  const metaCentroid = averageVector(metaVecs);

  return { queries: SEED_QUERIES, vectors, toolCentroid, ragCentroid, metaCentroid };
}

/**
 * Save centroid data to SurrealDB centroids table.
 * Each centroid stores its own hash for change detection.
 */
async function saveCentroids(result: EmbedResult, db: IDatabaseService, log: Logger): Promise<void> {
  log.debug`Saving centroids to SurrealDB...`;

  const hashes = computeAllCentroidHashes();

  await db.centroids.upsertCentroid('tool', result.toolCentroid, hashes.tool);
  await db.centroids.upsertCentroid('rag', result.ragCentroid, hashes.rag);
  await db.centroids.upsertCentroid('meta', result.metaCentroid, hashes.meta);
}

/**
 * Check if any centroid needs recomputing by comparing current hashes
 * against stored hashes in SurrealDB. Returns true if any changed.
 */
async function centroidDataChanged(db: IDatabaseService, log: Logger): Promise<boolean> {
  const existing = await db.centroids.getAllCentroids();

  const current = computeAllCentroidHashes();
  for (const c of CENTROID_CLASSES) {
    const stored = existing.find((r) => r.class === c)?.hash;
    if (!stored || stored !== current[c]) {
      log.debug`centroidDataChanged: ${c} changed (stored=${stored?.slice(0, 12) ?? 'none'}, current=${current[c].slice(0, 12)})`;
      return true;
    }
  }

  log.debug`centroidDataChanged: all centroids unchanged`;
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function buildIndex(): Promise<void> {
  // 1. Preload ML models before any work — fail fast on download issues
  process.stdout.write('  Downloading embedding model...\n');
  let lastPct = -1;
  const embedStart = Date.now();
  await downloadEmbedder((pct, loaded) => {
    if (pct > lastPct) {
      lastPct = pct;
      const bars = Math.floor(pct / 10);
      const elapsed = (Date.now() - embedStart) / 1000;
      const speed = elapsed > 0.1 && loaded > 0 ? loaded / 1024 / 1024 / elapsed : 0;
      process.stdout.write(`\r  ${'█'.repeat(bars)}${'░'.repeat(10 - bars)} ${pct}% @ ${speed.toFixed(1)} MB/s`);
    }
  });
  process.stdout.write('\r  ✓ Embedding model cached\n');

  // Future: cross-encoder model download (bge-reranker-base, +1.1GB)
  // Uncomment when a domain-effective reranker model is found.
  // See src/lib/server/reranker.ts for the implementation.
  //
  // process.stdout.write('  Downloading cross-encoder model...\n');
  // lastPct = -1;
  // const rankStart = Date.now();
  // await downloadReranker((pct, loaded) => {
  //   if (pct > lastPct) {
  //     lastPct = pct;
  //     const bars = Math.floor(pct / 10);
  //     const elapsed = (Date.now() - rankStart) / 1000;
  //     const speed = elapsed > 0.1 && loaded > 0 ? loaded / 1024 / 1024 / elapsed : 0;
  //     process.stdout.write(`\r  ${'█'.repeat(bars)}${'░'.repeat(10 - bars)} ${pct}% @ ${speed.toFixed(1)} MB/s`);
  //   }
  // });
  // process.stdout.write('\r  ✓ Cross-encoder model cached\n');

  // 2. Connect to SurrealDB
  await db.init();

  if (await centroidDataChanged(db, log)) {
    log.info`Computing and saving centroids... [centroids]`;
    const { toolCentroid, ragCentroid, metaCentroid, queries, vectors } = await embedAndComputeCentroids(log);
    await saveCentroids({ toolCentroid, ragCentroid, metaCentroid, queries, vectors }, db, log);
    await saveEmbeddingVisualizations(queries, vectors, toolCentroid, ragCentroid, './static/misc', metaCentroid);
    log.info`Done. [centroids]`;
  } else {
    log.info`Centroid data unchanged. Skipping centroid computation. [centroids]`;
  }

  // Free BGE model memory (~1.3GB) before chunk embedding phase
  await releaseExtractor();

  // 3. Read all content files with per-file SHA-256 hashes
  const fileEntries = readFileEntries();

  if (fileEntries.length === 0) {
    log.info`No content files found in src/content/posts/ or src/content/experience/`;
    await db.close();
    return;
  }

  log.info`Content files: ${fileEntries.length}`;

  // 4. Read stored hashes from previous build
  const storedHashes = new Map<string, string>();
  for (const row of await db.content.getStoredHashes()) {
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

  // 5. Early exit if nothing changed
  if (changedEntries.length === 0 && removedSlugs.length === 0) {
    log.info`No content changes detected. Skipping rebuild.`;
    await db.close();
    return;
  }
  log.info`Changes: ${changedEntries.length} file(s) ${update ? '(forced update)' : 'modified'}, ${removedSlugs.length} file(s) removed`;

  // 6. Delete obsolete chunks and removed entries
  for (const entry of changedEntries) {
    await db.vector.deleteChunksBySlug(entry.slug);
  }

  for (const slug of removedSlugs) {
    await db.vector.deleteChunksBySlug(slug);
    await db.content.deletePost(slug);
    await db.content.deleteExperience(slug);
    log.debug`  removed: ${slug}`;
  }

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

      // header_image is a plain URL string
      if (data.header_image && (typeof data.header_image !== 'string' || data.header_image === 'null')) {
        data.header_image = null;
      }

      // Process title, date, tags — handle Date objects from frontmatter
      let title: string;
      let date: string;
      let tags: string[];

      if (entry.type === 'post') {
        title = String(data.title ?? '') || entry.slug;
        const rawDate = data.date;
        date = rawDate instanceof Date ? rawDate.toISOString() : rawDate ? String(rawDate) : '';
        tags = [...new Set<string>(Array.isArray(data.tags) ? data.tags.map(String) : [])];
        if (entry.dirTag) tags = [...new Set([...tags, entry.dirTag])];
      } else {
        const company = String(data.company ?? '');
        const role = String(data.role ?? '');
        title = company ? `${company} — ${role}` : entry.slug;
        const rawStartDate = data.startDate;
        date = rawStartDate instanceof Date ? rawStartDate.toISOString() : rawStartDate ? String(rawStartDate) : '';
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
        await db.content.upsertPost({
          slug: entry.slug,
          hash: entry.hash,
          content: content || raw,
          toc,
          title,
          description: String(data.description ?? ''),
          date,
          tags,
          status: String(data.status || (data.published !== false ? 'published' : 'draft')),
          excerpt: String(data.excerpt ?? ''),
          headerImage: data.header_image ? String(data.header_image) : null,
          featured: Boolean(data.featured),
          position: data.position ? Number(data.position) : null,
          workflowFiles: data.workflow_files ? JSON.stringify(data.workflow_files) : null,
        });
        seriesMap.set(entry.slug, seriesSlug);

        // Determine post status for chunk gating
        const postStatus = String(data.status || (data.published !== false ? 'published' : 'draft'));

        // Skip chunking for non-published posts
        if (postStatus !== 'published') {
          log.debug`    ↳ skipping: status=${postStatus}`;
          continue;
        }
      } else {
        const rawSkills = data.skills;
        const skills: string[] = Array.isArray(rawSkills) ? rawSkills.map(String) : [];
        const jobRole = content ? extractJobRole(content) : '';
        await db.content.upsertExperience({
          slug: entry.slug,
          hash: entry.hash,
          content: content || raw,
          company: String(data.company ?? ''),
          role: String(data.role ?? ''),
          startDate: processedStartDate,
          endDate: processedEndDate,
          duration: String(data.duration ?? ''),
          skills,
          description: String(data.description ?? ''),
          published: data.published !== false,
          jobRole: jobRole || null,
        });
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

      const chunkIds = await db.vector.upsertChunks(rows);
      newChunks += rows.length;
      log.debug`    ↳ ${rows.length} chunks indexed`;

      // Create has_chunks edges connecting parent record to chunks
      const parentTable = entry.type === 'post' ? 'page_posts' : 'page_experience';
      await db.vector.createEdges(parentTable, entry.slug, chunkIds);
    } catch (err) {
      const processErr = err instanceof Error ? err : new Error(String(err));
      log.error`  ⚠ Failed to process ${entry.slug}: ${processErr.message}`;
    }
  }

  // Second pass: resolve part_of_series slugs to parent record IDs
  let seriesCount = 0;
  if (seriesMap.size > 0) {
    const slugRows = await db.content.getSlugToIdMap();
    const slugToId = new Map(slugRows.map((r) => [r.slug, r.id]));
    for (const [childSlug, parentSlug] of seriesMap) {
      if (parentSlug && slugToId.has(parentSlug)) {
        await db.content.updatePartOfSeries(childSlug, parentSlug);
        seriesCount++;
      }
    }
    if (seriesCount > 0) {
      log.info`Part of series: ${seriesCount} post(s) linked`;
    }
  }

  // Free BGE model memory
  await releaseExtractor();

  // 8. Index rebuilt inline during chunk processing (SurrealDB manages ANN)
  const totalChunks = newChunks;
  log.info`${JSON.stringify({
    total: totalChunks,
    fileCount: fileEntries.length,
    newChunks,
  })}`;

  await db.close();
}

// Only run when executed directly (not when imported by tests)
const isMainScript = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainScript) {
  buildIndex()
    .then(async () => {
      await dispose();
      process.exit(0);
    })
    .catch(async (err) => {
      log.error`Build failed: ${err}`;
      try {
        await db.close();
      } catch {
        /* ignore close errors during crash */
      }
      await dispose();
      process.exit(1);
    });
}
