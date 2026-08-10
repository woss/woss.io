/**
 * MCP server for woss.io — exposes blog posts, experience entries,
 * and vector search as tools, resources, and prompts.
 *
 * Import this module to auto-register all handlers at module scope.
 * The singleton `mcpServer` is the entry point for any transport layer
 * (stdio, SSE, etc.).
 */
import { z } from 'zod';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db } from '$lib/server/db';
import { embedText } from '$lib/server/embed';
import { CAT, createLogger } from '$lib/server/logger';

const log = createLogger(CAT.mcp);

// ─── Singleton ────────────────────────────────────────────────────────────────

export const mcpServer = new McpServer({ name: 'woss.io-mcp', version: '1.0.0' });

// ─── Tools ────────────────────────────────────────────────────────────────────

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}/)
  .refine((v) => !Number.isNaN(Date.parse(v)), { message: 'invalid date' });

mcpServer.registerTool(
  'get_posts',
  {
    description: 'Get all blog posts with optional date range filtering and sorting',
    inputSchema: {
      from: isoDate.optional().describe('ISO date lower bound (inclusive), e.g. "2026-01-01"'),
      to: isoDate.optional().describe('ISO date upper bound (inclusive), e.g. "2026-06-30"'),
      sort: z.enum(['date', 'title']).optional().default('date').describe('Sort field'),
      order: z.enum(['asc', 'desc']).optional().default('desc').describe('Sort direction'),
      last: z.number().int().positive().optional().describe('Return only the last N posts (sorted by date DESC)'),
    },
  },
  async ({ from, to, sort, order, last }) => {
    log.info`get_posts called: from=${from ?? '*'} to=${to ?? '*'} sort=${sort} order=${order} last=${last ?? '*'}`;
    // When date filtering is active, don't push limit to DB — fetch all then filter client-side
    const shouldLimitDb = last != null && !from && !to;
    let posts = await db.content.getPosts({ sort, order, limit: shouldLimitDb ? last : undefined });

    // Date range filter — timestamp comparison (robust to any stored date format).
    // Null/NaN dates: excluded when `from` is set, kept when only `to` is set (same as old semantics).
    const fromT = from ? Date.parse(from) : null;
    const toT = to ? Date.parse(to) : null;
    if (fromT != null || toT != null) {
      posts = posts.filter((p) => {
        const d = p.date ? Date.parse(p.date) : null;
        if (fromT != null && (d == null || Number.isNaN(d) || d < fromT)) return false;
        if (toT != null && d != null && !Number.isNaN(d) && d > toT) return false;
        return true;
      });
    }

    const text = posts.map((p) => `# [${p.date ?? 'n/a'}] ${p.title}\n${p.excerpt}`).join('\n\n---\n\n');
    log.debug`get_posts returned ${posts.length} posts`;
    return { content: [{ type: 'text', text }] };
  },
);

mcpServer.registerTool(
  'get_post',
  { description: 'Get a single blog post by slug', inputSchema: { slug: z.string() } },
  async ({ slug }) => {
    log.info`get_post called: ${slug}`;
    const posts = await db.content.getPosts({ slug });
    if (posts.length === 0) {
      log.warn`get_post: no post found for "${slug}"`;
      return {
        content: [{ type: 'text', text: `No post found with slug "${slug}"` }],
        isError: true,
      };
    }
    const post = posts[0];
    log.debug`get_post returned: ${post.title}`;
    return {
      content: [{ type: 'text', text: `# [${post.date ?? 'n/a'}] ${post.title}\n\n${post.content}` }],
    };
  },
);

mcpServer.registerTool(
  'get_experience',
  {
    description: 'Get all experience entries with optional date range filtering, keyword search, and sorting',
    inputSchema: {
      from: z.string().optional().describe('ISO date lower bound on startDate (inclusive)'),
      to: z.string().optional().describe('ISO date upper bound on startDate (inclusive)'),
      sort: z.enum(['startDate', 'company', 'role']).optional().default('startDate').describe('Sort field'),
      order: z.enum(['asc', 'desc']).optional().default('desc').describe('Sort direction'),
      keywords: z
        .string()
        .optional()
        .describe(
          'Comma-separated or space-separated keywords to filter entries. Matches against skills, company, role, jobRole, and description (case-insensitive).',
        ),
    },
  },
  async ({ from, to, sort, order, keywords }) => {
    log.info`get_experience called: from=${from ?? '*'} to=${to ?? '*'} sort=${sort} order=${order} keywords=${keywords ?? '*'}`;
    let entries = await db.content.getExperience();

    // Date range filter on startDate
    if (from) entries = entries.filter((e) => (e.startDate ?? '') >= from);
    if (to) entries = entries.filter((e) => (e.startDate ?? '') <= to);

    // Keyword filter — case-insensitive match against skills, company, role, jobRole, description
    if (keywords) {
      const terms = keywords
        .split(/[,\s]+/)
        .map((k) => k.trim().toLowerCase())
        .filter(Boolean);
      if (terms.length > 0) {
        entries = entries.filter((e) => {
          const haystack = [
            ...e.skills.map((s) => s.toLowerCase()),
            e.company.toLowerCase(),
            e.role.toLowerCase(),
            e.jobRole.toLowerCase(),
            e.description.toLowerCase(),
          ];
          return terms.some((t) => haystack.some((h) => h.includes(t)));
        });
      }
    }

    // Sort
    entries.sort((a, b) => {
      const av = (a[sort] as string) ?? '';
      const bv = (b[sort] as string) ?? '';
      return order === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });

    const text = entries
      .map((e) => `## ${e.role} @ ${e.company}\n${e.description}\nSkills: ${e.skills.join(', ')}`)
      .join('\n\n---\n\n');
    log.debug`get_experience returned ${entries.length} entries`;
    return { content: [{ type: 'text', text }] };
  },
);

mcpServer.registerTool(
  'search_content',
  {
    description: 'Search blog posts and experience entries by semantic similarity',
    inputSchema: {
      query: z.string(),
      type: z.enum(['post', 'experience']).optional(),
    },
  },
  async ({ query, type }) => {
    log.info`search_content called: query="${query}" type=${type ?? 'all'}`;
    const embedding = await embedText(query);
    const results = await db.vector.searchChunks(embedding.data, 216, type);

    if (results.length === 0) {
      log.debug`search_content: no results for "${query}"`;
      return {
        content: [{ type: 'text', text: 'No matching content found.' }],
      };
    }

    const text = results
      .map((r) => `### [${r.chunk.title}] (${r.chunk.type}, score: ${r.score.toFixed(3)})\n${r.chunk.text}`)
      .join('\n\n---\n\n');
    log.debug`search_content returned ${results.length} results`;
    return { content: [{ type: 'text', text }] };
  },
);

// ─── Resources ────────────────────────────────────────────────────────────────

mcpServer.registerResource(
  'posts',
  new ResourceTemplate('woss://posts/{slug}', {
    list: async () => {
      const posts = await db.content.getPosts();
      return {
        resources: posts.map((p) => ({
          uri: `woss://posts/${p.slug}`,
          name: p.title,
          mimeType: 'text/markdown',
        })),
      };
    },
  }),
  { mimeType: 'text/markdown' },
  async (uri, variables) => {
    const slug = variables.slug as string;
    const posts = await db.content.getPosts({ slug });
    if (posts.length === 0) throw new Error(`Post not found: ${slug}`);
    return {
      contents: [{ uri: uri.href, text: posts[0].content, mimeType: 'text/markdown' }],
    };
  },
);

mcpServer.registerResource('experience', 'woss://experience', { mimeType: 'text/markdown' }, async () => {
  const entries = await db.content.getExperience();
  const text = entries
    .map((e) => `## ${e.role} @ ${e.company}\n${e.description}\nSkills: ${e.skills.join(', ')}`)
    .join('\n\n---\n\n');
  return {
    contents: [{ uri: 'woss://experience', text, mimeType: 'text/markdown' }],
  };
});

// ─── Prompts ──────────────────────────────────────────────────────────────────

mcpServer.registerPrompt(
  'analyze_portfolio',
  {
    description: 'Analyze the woss.io portfolio — posts, experience, and skills',
    argsSchema: { focus: z.string().optional() },
  },
  async (args) => {
    const posts = await db.content.getPosts();
    const entries = await db.content.getExperience();

    const postSummaries = posts.map((p) => `- ${p.title}: ${p.excerpt}`).join('\n');
    const experienceSummaries = entries
      .map((e) => `- ${e.role} @ ${e.company} (${e.duration}) — ${e.skills.join(', ')}`)
      .join('\n');

    const focusInstruction = args.focus ? `\n\nFocus your analysis on: ${args.focus}` : '';

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Analyze the woss.io portfolio below. Identify strengths, skill patterns, career trajectory, and areas for growth.${focusInstruction}\n\n## Blog Posts\n${postSummaries}\n\n## Experience\n${experienceSummaries}`,
          },
        },
      ],
    };
  },
);
