import type { Root, Element, Text } from 'hast';
import { walkElement } from './rehype-utils.ts';

/**
 * Extract plain text from an element tree, stripping any HTML markup.
 * Handles nested span elements produced by syntax highlighting.
 */
function extractText(el: Element): string {
  let result = '';
  for (const child of el.children) {
    if (child.type === 'text') {
      result += (child as Text).value;
    } else if (child.type === 'element') {
      result += extractText(child as Element);
    }
  }
  return result;
}

/**
 * Rehype plugin: replaces mermaid code blocks (highlighted <pre><code> elements)
 * with a tabbed UI container. Source tab shows the code. Diagram tab lazily
 * loads the rendered SVG via a POST to /api/render-mermaid.
 *
 * The mermaid source code is base64-encoded into a data-code attribute on the
 * diagram-tab div for client-side retrieval.
 */
export function rehypeMermaidTabs() {
  return (tree: Root) => {
    walkElement(tree, (node, index, parent) => {
      if (node.tagName !== 'pre' || !node.children || node.children.length === 0) {
        return;
      }

      const firstChild = node.children[0];
      if (!firstChild || firstChild.type !== 'element' || firstChild.tagName !== 'code') {
        return;
      }

      const codeEl = firstChild as Element;
      const classes = codeEl.properties?.className;
      const isMermaid = Array.isArray(classes) && classes.includes('language-mermaid');

      if (!isMermaid) return;

      const rawText = extractText(codeEl);
      const encoded = Buffer.from(rawText).toString('base64');

      // Build tabbed UI using HAST nodes
      parent.children[index] = {
        type: 'element',
        tagName: 'div',
        properties: {
          className: ['mermaid-tabs', 'my-6', 'rounded-lg', 'border', 'border-slate-700', 'overflow-hidden'],
        },
        children: [
          // Tab bar
          {
            type: 'element',
            tagName: 'div',
            properties: {
              className: ['flex', 'border-b', 'border-slate-700'],
              role: 'tablist',
            },
            children: [
              {
                type: 'element',
                tagName: 'button',
                properties: {
                  className: [
                    'px-4',
                    'py-2',
                    'text-sm',
                    'font-medium',
                    'text-green-400',
                    'border-b-2',
                    'border-green-400',
                  ],
                  'data-tab': 'source',
                  role: 'tab',
                  'aria-selected': 'true',
                },
                children: [{ type: 'text', value: 'Source' }],
              },
              {
                type: 'element',
                tagName: 'button',
                properties: {
                  className: [
                    'px-4',
                    'py-2',
                    'text-sm',
                    'font-medium',
                    'text-slate-400',
                    'border-b-2',
                    'border-transparent',
                  ],
                  'data-tab': 'diagram',
                  role: 'tab',
                  'aria-selected': 'false',
                },
                children: [{ type: 'text', value: 'Diagram' }],
              },
            ],
          },
          // Source tab content (visible by default)
          {
            type: 'element',
            tagName: 'div',
            properties: { className: ['source-tab'] },
            children: [node],
          },
          // Diagram tab content (hidden, lazy-loaded on first click)
          {
            type: 'element',
            tagName: 'div',
            properties: {
              className: ['diagram-tab', 'hidden'],
              'data-code': encoded,
            },
            children: [
              {
                type: 'element',
                tagName: 'div',
                properties: {
                  className: ['flex', 'items-center', 'justify-center', 'py-8', 'text-slate-400', 'gap-2'],
                },
                children: [
                  // Spinning circle SVG
                  {
                    type: 'element',
                    tagName: 'svg',
                    properties: {
                      className: ['animate-spin', 'h-5', 'w-5'],
                      viewBox: '0 0 24 24',
                      fill: 'none',
                    },
                    children: [
                      {
                        type: 'element',
                        tagName: 'circle',
                        properties: {
                          cx: '12',
                          cy: '12',
                          r: '10',
                          stroke: 'currentColor',
                          'stroke-width': '4',
                          class: 'opacity-25',
                        },
                        children: [],
                      },
                      {
                        type: 'element',
                        tagName: 'path',
                        properties: {
                          d: 'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z',
                          fill: 'currentColor',
                          class: 'opacity-75',
                        },
                        children: [],
                      },
                    ],
                  },
                  { type: 'text', value: 'Loading diagram...' },
                ],
              },
            ],
          },
        ],
      } as Element;
    });
  };
}
