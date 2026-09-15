/**
 * Log message truncation for OTLP export.
 *
 * Kept free of OpenTelemetry imports so it can be unit-tested and reused
 * without pulling the SDK into the test graph.
 */

/** Upper bound for a single exported log message (1 MiB). */
export const MAX_LOG_MESSAGE_BYTES = 1024 * 1024;

/**
 * Truncate a log message to at most `maxBytes` UTF-8 bytes.
 *
 * Cuts on character boundaries only — a multi-byte character is never
 * split. Returns the message unchanged when it already fits.
 */
export function truncateLogMessage(message: string, maxBytes: number = MAX_LOG_MESSAGE_BYTES): string {
  if (Buffer.byteLength(message, 'utf8') <= maxBytes) {
    return message;
  }

  // Binary search the longest character prefix whose UTF-8 encoding fits.
  let low = 0;
  let high = message.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(message.slice(0, mid), 'utf8') <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  // Back off if the cut landed between a surrogate pair: a trailing high
  // surrogate (0xD800–0xDBFF) means the low surrogate that follows it was
  // dropped, leaving a lone surrogate. Decrementing makes the slice end on
  // a complete code point. charCodeAt(-1) is NaN, so this is a no-op when
  // the entire message was cut away.
  const last = message.charCodeAt(low - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    low -= 1;
  }

  return message.slice(0, low);
}
