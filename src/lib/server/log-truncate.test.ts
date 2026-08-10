import { describe, it, expect } from 'vitest';
import { truncateLogMessage, MAX_LOG_MESSAGE_BYTES } from './log-truncate';

/**
 * True when `s` contains a lone (unpaired) UTF-16 surrogate. Truncation must
 * never split a surrogate pair, so no truncated result may contain one.
 */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      // High surrogate: valid only when immediately followed by a low one.
      const next = s.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      i++; // Skip the paired low surrogate.
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true; // Low surrogate without a preceding high one.
    }
  }
  return false;
}

describe('truncateLogMessage', () => {
  it('passes through when the message fits exactly at the cap', () => {
    const message = 'a'.repeat(MAX_LOG_MESSAGE_BYTES); // exactly 1 MiB of ASCII
    expect(Buffer.byteLength(message, 'utf8')).toBe(MAX_LOG_MESSAGE_BYTES);
    expect(truncateLogMessage(message)).toBe(message);
  });

  it('passes through when the message is under the cap', () => {
    const message = 'short message';
    expect(truncateLogMessage(message)).toBe(message);
    expect(truncateLogMessage(message, 1024)).toBe(message);
  });

  it('truncates on an ASCII boundary', () => {
    const result = truncateLogMessage('hello world', 5);
    expect(result).toBe('hello');
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(5);
    expect(hasLoneSurrogate(result)).toBe(false);
  });

  it('backs off to the previous code point when the cut lands inside a multi-byte char', () => {
    // 'a' + U+1F600 (4 UTF-8 bytes) = 5 bytes; the 4-byte cut lands between
    // the surrogate pair, so the trailing high surrogate must be dropped.
    const withPrefix = truncateLogMessage('a\u{1F600}', 4);
    expect(withPrefix).toBe('a');
    expect(Buffer.byteLength(withPrefix, 'utf8')).toBeLessThanOrEqual(4);
    expect(hasLoneSurrogate(withPrefix)).toBe(false);

    // A lone high surrogate alone would fit in 3 bytes; it must be dropped
    // entirely rather than returned as an unpaired surrogate.
    const emojiOnly = truncateLogMessage('\u{1F600}', 3);
    expect(emojiOnly).toBe('');
    expect(Buffer.byteLength(emojiOnly, 'utf8')).toBeLessThanOrEqual(3);
    expect(hasLoneSurrogate(emojiOnly)).toBe(false);
  });

  it('keeps a multi-byte char when the cut falls exactly after it', () => {
    const message = '\u{1F600}\u{1F600}'; // 2 × 4 bytes = 8 bytes
    const result = truncateLogMessage(message, 4);
    expect(result).toBe('\u{1F600}');
    expect(Buffer.byteLength(result, 'utf8')).toBe(4);
    expect(hasLoneSurrogate(result)).toBe(false);
  });

  it('never leaves lone surrogates in an emoji-heavy message near the cap', () => {
    const emoji = '\u{1F600}'; // 4 UTF-8 bytes per emoji
    const message = emoji.repeat(300000); // 1.2 MiB > cap
    expect(Buffer.byteLength(message, 'utf8')).toBeGreaterThan(MAX_LOG_MESSAGE_BYTES);

    const result = truncateLogMessage(message);
    expect(Buffer.byteLength(result, 'utf8')).toBeLessThanOrEqual(MAX_LOG_MESSAGE_BYTES);
    expect(hasLoneSurrogate(result)).toBe(false);
    // The cap is a multiple of 4, so exactly 262144 emojis fit.
    expect(result).toBe(emoji.repeat(MAX_LOG_MESSAGE_BYTES / 4));
  });

  it('handles the empty string', () => {
    expect(truncateLogMessage('')).toBe('');
    expect(truncateLogMessage('', 4)).toBe('');
  });
});
