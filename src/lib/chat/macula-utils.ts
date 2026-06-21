/**
 * Appends tracking ref parameter to Macula URLs.
 * Only modifies URLs pointing to u.macula.link. Returns the URL unchanged for non-Macula URLs.
 */
export function addMaculaRef(url: string, chatId: string, messageId: string, queryParams?: string): string {
  const maculaMatch = url.match(/https?:\/\/u\.macula\.link\/([a-zA-Z0-9@_-]+)/);
  if (!maculaMatch || maculaMatch[1].startsWith('@')) return url;

  const ref = `ref=urn:woss.io:chatId:${chatId}:msgId:${messageId}`;
  const hasQuery = url.includes('?');
  const cleanUrl = url.replace(/\/$/, '');
  const result = hasQuery ? `${cleanUrl}&${ref}` : `${cleanUrl}/?${ref}`;

  if (queryParams) return `${result}&${queryParams}`;
  return result;
}
