import type { Root, Element, Text } from 'hast';

export function walkElement(
  node: Element | Root,
  callback: (node: Element, index: number, parent: Element) => void,
  parent?: Element,
  index?: number,
): void {
  if (node.type === 'element' && parent) {
    callback(node as Element, index!, parent);
  }
  if ('children' in node && Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child && typeof child === 'object' && 'type' in child && child.type === 'element') {
        walkElement(child as Element, callback, node as Element, i);
      }
    }
  }
}

export function isText(node: unknown): node is Text {
  return typeof node === 'object' && node !== null && (node as { type: string }).type === 'text';
}

export function isElement(node: unknown): node is Element {
  return typeof node === 'object' && node !== null && (node as { type: string }).type === 'element';
}

export function findFirstChild(node: Element, tagName: string): Element | undefined {
  for (const child of node.children) {
    if (isElement(child) && child.tagName === tagName) return child;
  }
  return undefined;
}
