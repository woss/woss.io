/**
 * Append query params string to a URL.
 * If URL already has query params, uses &. If not, uses ?.
 * Returns original URL if paramsStr is empty.
 */
export function appendQueryParams(url: string, paramsStr: string): string {
  if (!paramsStr) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}${paramsStr}`;
}
