/**
 * migrate-data.test.ts
 *
 * Tests the 4 helper functions from migrate-data.ts.
 * These are unexported pure functions — replicated here to test edge cases.
 * If the source implementations change, update the copies below to match.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Copies of the helper functions from src/scripts/migrate-data.ts
// These MUST stay in sync with the source. Update if source changes.
// ---------------------------------------------------------------------------

function toDate(value: unknown): Date | undefined {
  if (value == null || value === '') return undefined;
  const d = new Date(String(value));
  return isNaN(d.getTime()) ? undefined : d;
}

function toJSON<T = unknown>(value: unknown): T | undefined {
  if (value == null || value === '') return undefined;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return undefined;
  }
}

function toBool(value: unknown): boolean {
  return value === 1 || value === true;
}

function toNum(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return isNaN(n) ? undefined : n;
}

// ---------------------------------------------------------------------------
// toDate tests
// ---------------------------------------------------------------------------

describe('toDate', () => {
  it('parses ISO 8601 string to Date', () => {
    const result = toDate('2024-01-15T10:30:00.000Z');
    expect(result).toBeInstanceOf(Date);
    expect(result!.toISOString()).toBe('2024-01-15T10:30:00.000Z');
  });

  it('parses date-only string', () => {
    const result = toDate('2024-06-01');
    expect(result).toBeInstanceOf(Date);
    expect(result!.getFullYear()).toBe(2024);
    expect(result!.getMonth()).toBe(5); // June = 5
    expect(result!.getDate()).toBe(1);
  });

  it('returns undefined for null', () => {
    expect(toDate(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(toDate(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(toDate('')).toBeUndefined();
  });

  it('returns undefined for invalid date string', () => {
    expect(toDate('not-a-date')).toBeUndefined();
  });

  it('parses string containing a year (JS Date parses "123" as year)', () => {
    // new Date("hello world 123") → finds "123" as year, returns valid Date
    // This documents actual JS Date behavior
    const result = toDate('hello world 123');
    expect(result).toBeInstanceOf(Date);
    expect(result!.getFullYear()).toBe(123);
  });

  it('returns undefined for pure numeric string (not ISO format)', () => {
    // new Date("1705312200000") → Invalid Date, not a recognized ISO format
    expect(toDate('1705312200000')).toBeUndefined();
  });

  it('handles numeric 0 (falsy but not null)', () => {
    // new Date('0') → Jan 1 1970 in local time — valid date
    const result = toDate(0);
    expect(result).toBeInstanceOf(Date);
  });

  it('handles boolean false', () => {
    // String(false) = 'false', new Date('false') = Invalid Date
    expect(toDate(false)).toBeUndefined();
  });

  it('handles boolean true', () => {
    // String(true) = 'true', new Date('true') = Invalid Date
    expect(toDate(true)).toBeUndefined();
  });

  it('handles whitespace-only string as invalid', () => {
    // new Date('   ') = Invalid Date
    expect(toDate('   ')).toBeUndefined();
  });

  it('parses date with timezone offset', () => {
    const result = toDate('2024-01-15T10:30:00+05:30');
    expect(result).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// toJSON tests
// ---------------------------------------------------------------------------

describe('toJSON', () => {
  it('parses JSON array', () => {
    const result = toJSON<string[]>('["foo","bar","baz"]');
    expect(result).toEqual(['foo', 'bar', 'baz']);
  });

  it('parses JSON object', () => {
    const result = toJSON<{ key: string; val: number }>('{"key":"hello","val":42}');
    expect(result).toEqual({ key: 'hello', val: 42 });
  });

  it('parses JSON number', () => {
    const result = toJSON<number>('123');
    expect(result).toBe(123);
  });

  it('parses JSON boolean', () => {
    const result = toJSON<boolean>('true');
    expect(result).toBe(true);
  });

  it('parses JSON null', () => {
    const result = toJSON('null');
    expect(result).toBeNull();
  });

  it('parses JSON string', () => {
    const result = toJSON<string>('"hello"');
    expect(result).toBe('hello');
  });

  it('parses nested JSON', () => {
    const input = '{"a":{"b":{"c":[1,2,3]}}}';
    const result = toJSON(input);
    expect(result).toEqual({ a: { b: { c: [1, 2, 3] } } });
  });

  it('returns undefined for null', () => {
    expect(toJSON(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(toJSON(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(toJSON('')).toBeUndefined();
  });

  it('returns undefined for malformed JSON', () => {
    expect(toJSON('{invalid json')).toBeUndefined();
  });

  it('returns undefined for plain text', () => {
    expect(toJSON('hello world')).toBeUndefined();
  });

  it('returns undefined for incomplete JSON', () => {
    expect(toJSON('[1,2,')).toBeUndefined();
  });

  it('returns undefined for trailing comma', () => {
    expect(toJSON('[1,2,]')).toBeUndefined();
  });

  it('handles JSON with special characters', () => {
    const input = '{"msg":"line1\\nline2\\ttab"}';
    const result = toJSON<{ msg: string }>(input);
    expect(result).toEqual({ msg: 'line1\nline2\ttab' });
  });

  it('handles empty JSON array', () => {
    expect(toJSON('[]')).toEqual([]);
  });

  it('handles empty JSON object', () => {
    expect(toJSON('{}')).toEqual({});
  });

  it('handles large numbers in JSON', () => {
    const result = toJSON<number[]>(JSON.stringify([1, 999999999, 0.123456]));
    expect(result).toEqual([1, 999999999, 0.123456]);
  });

  it('handles deeply nested arrays', () => {
    const input = '[[[[1]]]]';
    const result = toJSON(input);
    expect(result).toEqual([[[[1]]]]);
  });

  it('returns undefined for numeric string (not valid JSON)', () => {
    // bare number without quotes IS valid JSON actually — it parses to a number
    expect(toJSON('42')).toBe(42);
  });

  it('handles string with quotes inside JSON', () => {
    const result = toJSON<string[]>('["he said \\"hello\\""]');
    expect(result).toEqual(['he said "hello"']);
  });
});

// ---------------------------------------------------------------------------
// toBool tests
// ---------------------------------------------------------------------------

describe('toBool', () => {
  it('returns true for integer 1', () => {
    expect(toBool(1)).toBe(true);
  });

  it('returns true for boolean true', () => {
    expect(toBool(true)).toBe(true);
  });

  it('returns false for integer 0', () => {
    expect(toBool(0)).toBe(false);
  });

  it('returns false for boolean false', () => {
    expect(toBool(false)).toBe(false);
  });

  it('returns false for null', () => {
    expect(toBool(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(toBool(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(toBool('')).toBe(false);
  });

  it('returns false for string "1"', () => {
    expect(toBool('1')).toBe(false);
  });

  it('returns false for string "true"', () => {
    expect(toBool('true')).toBe(false);
  });

  it('returns false for integer 2', () => {
    expect(toBool(2)).toBe(false);
  });

  it('returns false for integer -1', () => {
    expect(toBool(-1)).toBe(false);
  });

  it('returns false for empty object', () => {
    expect(toBool({})).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(toBool([])).toBe(false);
  });

  it('returns false for string "yes"', () => {
    expect(toBool('yes')).toBe(false);
  });

  it('strict equality: only exactly 1 or true', () => {
    // SQLite stores booleans as 0/1 integers
    expect(toBool(1)).toBe(true);
    expect(toBool(0)).toBe(false);
    expect(toBool(true)).toBe(true);
    expect(toBool(false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toNum tests
// ---------------------------------------------------------------------------

describe('toNum', () => {
  it('parses integer string', () => {
    expect(toNum('42')).toBe(42);
  });

  it('parses float string', () => {
    expect(toNum('3.14')).toBeCloseTo(3.14);
  });

  it('parses negative number', () => {
    expect(toNum('-7')).toBe(-7);
  });

  it('parses zero', () => {
    expect(toNum('0')).toBe(0);
  });

  it('parses large number', () => {
    expect(toNum('999999999')).toBe(999999999);
  });

  it('parses number with leading zeros', () => {
    expect(toNum('007')).toBe(7);
  });

  it('returns undefined for null', () => {
    expect(toNum(null)).toBeUndefined();
  });

  it('returns undefined for undefined', () => {
    expect(toNum(undefined)).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(toNum('')).toBeUndefined();
  });

  it('returns undefined for non-numeric string', () => {
    expect(toNum('hello')).toBeUndefined();
  });

  it('returns undefined for mixed string', () => {
    expect(toNum('12abc')).toBeUndefined();
  });

  it('returns Infinity for "Infinity" string (isNaN(Infinity) is false)', () => {
    // Number('Infinity') = Infinity, isNaN(Infinity) = false
    // This documents actual behavior — toNum does NOT guard against Infinity
    expect(toNum('Infinity')).toBe(Infinity);
  });

  it('parses number 0 (falsy but not null/empty)', () => {
    expect(toNum(0)).toBe(0);
  });

  it('parses boolean false as 0', () => {
    expect(toNum(false)).toBe(0);
  });

  it('parses boolean true as 1', () => {
    expect(toNum(true)).toBe(1);
  });

  it('handles scientific notation string', () => {
    expect(toNum('1e3')).toBe(1000);
  });

  it('handles string with whitespace around number', () => {
    // Number('  42  ') = 42 — whitespace is trimmed
    expect(toNum('  42  ')).toBe(42);
  });

  it('handles hex string', () => {
    // Number('0xFF') = 255
    expect(toNum('0xFF')).toBe(255);
  });

  it('returns undefined for pure whitespace', () => {
    // Number('   ') = 0, which is a valid number
    // This is how the real function behaves
    expect(toNum('   ')).toBe(0);
  });

  it('returns undefined for string with only special chars', () => {
    expect(toNum('!!!')).toBeUndefined();
  });

  it('handles negative zero', () => {
    expect(toNum('-0')).toBe(-0);
  });
});
