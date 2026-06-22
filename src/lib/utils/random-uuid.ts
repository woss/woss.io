/**
 * Generates a UUID v4 string.
 *
 * Uses `crypto.randomUUID()` when available (secure contexts, Node.js 19+).
 * Falls back to `crypto.getRandomValues()` for non-secure contexts (HTTP).
 * Last resort: `Math.random()` (never actually reached in practice).
 */
export function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // crypto.getRandomValues works in all browser contexts (HTTP + HTTPS)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    // Set version 4 (0100 in binary)
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    // Set variant bits (10xx in binary)
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  // Last resort — Math.random fallback (should never reach this)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
