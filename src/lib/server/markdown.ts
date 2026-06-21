import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkRehype from 'remark-rehype';
import rehypeHighlight from 'rehype-highlight';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import { rehypeMermaidTabs } from './rehype-mermaid-tabs.ts';
import { rehypeAdmonitions } from './rehype-admonitions.ts';
import { walkElement } from './rehype-utils.ts';
import { load } from 'js-yaml';
import type { Root } from 'hast';

function rehypeLazyLoad() {
  return (tree: Root) => {
    walkElement(tree, (node) => {
      if (node.tagName === 'img') {
        node.properties.loading = 'lazy';
      }
    });
  };
}

function createProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkFrontmatter, ['yaml', 'toml'])
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeAdmonitions)
    .use(rehypeHighlight)
    .use(rehypeMermaidTabs)
    .use(rehypeLazyLoad)
    .use(rehypeSlug)
    .use(rehypeStringify);
}

let processor: ReturnType<typeof createProcessor> | null = null;

function getProcessor() {
  if (!processor) {
    processor = createProcessor();
  }
  return processor;
}

/**
 * Render markdown content to HTML using unified/remark pipeline.
 * Automatically strips frontmatter. Handles code highlighting.
 */
export async function renderMarkdown(content: string): Promise<string> {
  const result = await getProcessor().process(content);
  return String(result);
}

/**
 * Parse frontmatter from markdown content using js-yaml.
 * Returns { data, content } where content has frontmatter stripped.
 */
export async function parseMarkdownFrontmatter(
  content: string,
): Promise<{ data: Record<string, unknown>; content: string }> {
  const YAML_FM_RE = /^---\n([\s\S]*?)\n---\n?/;
  const match = content.match(YAML_FM_RE);
  if (match) {
    const data = (load(match[1]) as Record<string, unknown>) ?? {};
    const body = content.slice(match[0].length);
    return { data, content: body };
  }
  return { data: {}, content };
}
