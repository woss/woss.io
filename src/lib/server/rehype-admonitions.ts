import type { Root, Element } from 'hast';
import { walkElement, isText, isElement } from './rehype-utils.ts';

type AdmonitionType = 'info' | 'warning' | 'error' | 'success';

const ADMONITION_PATTERN = /^\[!(INFO|WARNING|ERROR|SUCCESS)\]\s*/i;

export function rehypeAdmonitions() {
  return (tree: Root) => {
    walkElement(tree, (node, index, parent) => {
      if (node.tagName !== 'blockquote') return;
      if (!node.children || node.children.length === 0) return;

      const firstChild = node.children[0];
      if (!isElement(firstChild) || firstChild.tagName !== 'p') return;
      if (!firstChild.children || firstChild.children.length === 0) return;

      const textNode = firstChild.children[0];
      if (!isText(textNode)) return;

      const match = textNode.value.match(ADMONITION_PATTERN);
      if (!match) return;

      const type = match[1].toLowerCase() as AdmonitionType;

      // Strip the [!TYPE] label from the text node
      textNode.value = textNode.value.replace(ADMONITION_PATTERN, '');

      // Replace the blockquote element with a div.admonition
      parent.children[index] = {
        type: 'element',
        tagName: 'div',
        properties: { className: [`admonition`, `admonition-${type}`] },
        children: node.children,
      } as Element;
    });
  };
}
