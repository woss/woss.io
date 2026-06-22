import MarkdownIt from 'markdown-it';
import type { LanguageFn } from 'highlight.js';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import yaml from 'highlight.js/lib/languages/yaml';
import rust from 'highlight.js/lib/languages/rust';
import DOMPurify from 'isomorphic-dompurify';
import { addMaculaRef } from './macula-utils';

// Module-level: register highlight.js languages once when this chunk loads
const langMap: Record<string, LanguageFn> = {
  typescript,
  ts: typescript,
  javascript,
  js: javascript,
  json,
  bash,
  sh: bash,
  shell: bash,
  python,
  sql,
  html: xml,
  css,
  diff,
  yaml,
  yml: yaml,
  rust,
};
for (const [name, lang] of Object.entries(langMap)) {
  hljs.registerLanguage(name, lang);
}

/**
 * Creates a configured MarkdownIt instance with consistent styling and Macula integration.
 * Call this fresh when rendering — construction overhead is negligible vs render time.
 */
export function createMarkdownRenderer(context: {
  chatId: string;
  messageId: string;
  queryParams: string | null;
}): MarkdownIt {
  const { chatId, messageId, queryParams } = context;
  const md = new MarkdownIt({ html: true, linkify: true });

  // Blockquote
  md.renderer.rules.blockquote_open = () => {
    return '<blockquote class="border-l-4 border-primary/30 pl-4 text-on-surface-variant italic my-2">';
  };

  // Table
  md.renderer.rules.table_open = () => {
    return '<div class="overflow-x-auto my-2"><table class="w-full table-auto border-collapse border border-[rgba(255,255,255,0.08)]">';
  };
  md.renderer.rules.table_close = () => {
    return '</table></div>';
  };

  // Ordered list
  md.renderer.rules.ordered_list_open = () => {
    return '<ol class="list-decimal p-0 ml-5 space-y-0.5 my-1">';
  };

  // Bullet list
  md.renderer.rules.bullet_list_open = () => {
    return '<ul class="list-disc p-0 ml-5 space-y-0.5 my-1">';
  };

  // List items
  md.renderer.rules.list_item_open = () => {
    return '<li class="leading-normal">';
  };

  // Heading styles
  const headingSizes: Record<string, string> = {
    '1': 'text-xl font-heading font-semibold text-on-surface mt-6 mb-3',
    '2': 'text-lg font-heading font-semibold text-on-surface mt-5 mb-2',
    '3': 'text-base font-heading font-semibold text-on-surface mt-4 mb-2',
    '4': 'text-sm font-heading font-semibold text-on-surface mt-3 mb-1',
    '5': 'text-xs font-heading font-semibold text-on-surface-variant mt-3 mb-1',
    '6': 'text-xs font-heading text-on-surface-variant mt-2 mb-1 uppercase tracking-wider',
  };
  md.renderer.rules.heading_open = (tokens, idx) => {
    const token = tokens[idx];
    const level = token.tag.slice(1);
    return `<${token.tag} class="${headingSizes[level] || 'text-base font-semibold mt-4 mb-2'}">`;
  };

  // Horizontal rule
  md.renderer.rules.hr = () => {
    return '<hr class="border-t border-[rgba(255,255,255,0.08)] my-4">';
  };

  // Paragraph spacing
  md.renderer.rules.paragraph_open = () => {
    return '<p class="my-2">';
  };

  // Emphasis
  md.renderer.rules.em_open = () => {
    return '<em class="italic text-on-surface-variant/90">';
  };
  md.renderer.rules.em_close = () => {
    return '</em>';
  };

  // Strong
  md.renderer.rules.strong_open = () => {
    return '<strong class="font-semibold">';
  };
  md.renderer.rules.strong_close = () => {
    return '</strong>';
  };

  // Links — uses context for Macula tracking
  md.renderer.rules.link_open = (tokens, idx) => {
    const token = tokens[idx];
    const href = token.attrGet('href');
    if (href && !href.startsWith('#')) {
      if (href.includes('u.macula.link')) {
        const refHref = addMaculaRef(href, chatId, messageId, queryParams ?? undefined);
        token.attrSet('href', refHref);
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noopener');
      } else {
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noopener noreferrer');
      }
    }
    const attrs = token.attrs?.map(([k, v]) => `${k}="${v.replace(/"/g, '&quot;')}"`).join(' ') || '';
    return `<a${attrs ? ' ' + attrs : ''}>`;
  };

  // Custom image renderer — wrap Macula images in a link to macula.link + tracking ref
  const defaultImageRenderer = md.renderer.rules.image!;
  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet('src') || '';
    token.attrSet('class', 'max-w-full h-auto rounded-lg my-2 shadow-lg');
    token.attrSet('loading', 'lazy');

    let modifiedSrc = src;
    if (queryParams) {
      const separator = src.includes('?') ? '&' : '?';
      modifiedSrc = `${src}${separator}${queryParams}`;
      token.attrSet('src', modifiedSrc);
    }

    const maculaMatch = modifiedSrc.match(/https?:\/\/u\.macula\.link\/([a-zA-Z0-9@_-]+)/);
    if (maculaMatch && !maculaMatch[1].startsWith('@')) {
      const unifiedId = maculaMatch[1];
      const presetSep = modifiedSrc.includes('?') ? '&' : '?';
      token.attrSet('src', `${modifiedSrc}${presetSep}preset=sys_md`);
      const imgHtml = defaultImageRenderer(tokens, idx, options, env, self);
      const href = addMaculaRef(`https://u.macula.link/${unifiedId}`, chatId, messageId, queryParams ?? undefined);
      return `<a href="${href}" target="_blank" rel="noopener" class="inline-block hover:opacity-90 transition-opacity duration-150">${imgHtml}</a>`;
    }

    return defaultImageRenderer(tokens, idx, options, env, self);
  };

  md.options.highlight = (str: string, lang?: string) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch {
        // hljs.highlight failed — fall through to plain escaped-HTML rendering
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  };
  return md;
}

/**
 * Fix link formatting: [[text](url)](url) → [text](url) and [[text](url)] → [text](url)
 */
export function preprocessMarkdown(text: string): string {
  let result = text.replace(/\[\[([^\]]+)\]\(([^)]+)\)\]\(([^)]+)\)/g, '[$1]($2)');
  result = result.replace(/\[\[([^\]]+)\]\(([^)]+)\)\]/g, '[$1]($2)');
  return result;
}

/**
 * Post-process rendered HTML to restructure Macula image cards from flat
 * <p> layout into structured card <div> layout.
 */
export function postprocessHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return html;

  const wrapperId = 'pp-root';
  const doc = new DOMParser().parseFromString(`<div id="${wrapperId}">${html}</div>`, 'text/html');
  const root = doc.getElementById(wrapperId);
  if (!root) return html;

  const paragraphs = Array.from(root.querySelectorAll('p'));
  for (const p of paragraphs) {
    const imgLink = p.querySelector<HTMLAnchorElement>('a[href*="u.macula.link"] > img');
    if (!imgLink) continue;

    const link = imgLink.parentElement as HTMLAnchorElement;
    const titleEl = p.querySelector('strong');
    const captionEl = p.querySelector('em');

    const card = doc.createElement('div');
    card.className = 'not-prose bg-surface-container-high/30 rounded-xl border border-white/5 overflow-hidden my-3';

    const clonedLink = link.cloneNode(true) as HTMLAnchorElement;
    clonedLink.className = 'block';
    const clonedImg = clonedLink.querySelector('img');
    if (clonedImg) {
      clonedImg.className = 'w-full max-h-[50vh] object-cover block';
    }
    card.appendChild(clonedLink);

    if (titleEl || captionEl) {
      const body = doc.createElement('div');
      body.className = 'p-3 space-y-1';

      if (titleEl) {
        const titleDiv = doc.createElement('div');
        titleDiv.className = 'font-semibold';
        titleDiv.appendChild(titleEl.cloneNode(true));
        body.appendChild(titleDiv);
      }

      if (captionEl) {
        const captionDiv = doc.createElement('div');
        captionDiv.className = 'text-sm text-on-surface-variant/80';
        captionDiv.appendChild(captionEl.cloneNode(true));
        body.appendChild(captionDiv);
      }

      card.appendChild(body);
    }

    p.replaceWith(card);
  }

  return root.innerHTML;
}

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target'] });
}
