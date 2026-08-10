import { describe, expect, it } from 'vitest';
import { hexIdToLow64Decimal, isZeroLow64Decimal } from './datadog-ids';

const MAX_LOW64 = 18446744073709551615n; // 2^64 - 1

describe('hexIdToLow64Decimal', () => {
  it('converts a 32-hex OTel id with only the low bit set to its low-64 decimal', () => {
    expect(hexIdToLow64Decimal('00000000000000000000000000000001')).toBe('1');
  });

  it('converts an all-ones 32-hex id to 2^64-1', () => {
    expect(hexIdToLow64Decimal('ffffffffffffffffffffffffffffffff')).toBe('18446744073709551615');
  });

  it('ignores the high 64 bits when they are zero (low 16 hex chars only)', () => {
    expect(hexIdToLow64Decimal('0000000000000000ffffffffffffffff')).toBe('18446744073709551615');
  });

  it('ignores the high 64 bits even when they are non-zero', () => {
    expect(hexIdToLow64Decimal('1234567890abcdef0000000000000001')).toBe('1');
  });

  it('converts a 36-char dashed UUID by stripping dashes then applying the same low-64 path', () => {
    expect(hexIdToLow64Decimal('00000000-0000-0000-0000-000000000001')).toBe('1');
  });

  it('converts a dashed UUID whose last 16 hex chars are all ones to 2^64-1', () => {
    expect(hexIdToLow64Decimal('00000000-0000-0000-ffff-ffffffffffff')).toBe('18446744073709551615');
  });

  it('treats the low 16 hex chars of the stripped UUID as the low 64 bits (12-char UUID tail leaves 4 zero high nibbles)', () => {
    expect(hexIdToLow64Decimal('00000000-0000-0000-0000-ffffffffffff')).toBe('281474976710655');
  });

  it('strips dashes and ignores the high half of a dashed UUID with non-zero high bits', () => {
    expect(hexIdToLow64Decimal('12345678-90ab-cdef-0000-00000000000f')).toBe('15');
  });

  it('converts an all-zero id to "0" (the zero-trace-id edge case)', () => {
    expect(hexIdToLow64Decimal('00000000000000000000000000000000')).toBe('0');
  });

  it('returns "0" for empty string without throwing', () => {
    expect(hexIdToLow64Decimal('')).toBe('0');
  });

  it('returns "0" for dash-only input without throwing', () => {
    expect(hexIdToLow64Decimal('----')).toBe('0');
  });

  it('returns "0" for a 36-char all-dash UUID without throwing', () => {
    expect(hexIdToLow64Decimal('------------------------------------')).toBe('0');
  });

  it('preserves the value of the low 16 hex chars including leading zeros', () => {
    expect(hexIdToLow64Decimal('0000000000000000000000000000000f')).toBe('15');
  });

  it('property: result is a non-negative decimal string strictly below 2^64', () => {
    // Deterministic pseudo-random 32-hex ids — no flaky randomness.
    let seed = 42;
    for (let i = 0; i < 250; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const id = seed.toString(16).padStart(32, '0');
      const result = hexIdToLow64Decimal(id);
      expect(result).toMatch(/^\d+$/);
      const value = BigInt(result);
      expect(value >= 0n).toBe(true);
      expect(value < 1n << 64n).toBe(true);
      expect(result.length).toBeLessThanOrEqual(20);
    }
  });

  it('property: only the low 16 hex chars affect the result (low-64 projection invariant)', () => {
    let seed = 7;
    for (let i = 0; i < 250; i++) {
      seed = (seed * 48271) % 2147483647;
      const high = seed.toString(16).padStart(16, '0');
      const low = (seed * 7919).toString(16).padStart(16, '0').slice(-16);
      const full = high + low;
      expect(hexIdToLow64Decimal(full)).toBe(hexIdToLow64Decimal(low));
    }
  });
});

describe('isZeroLow64Decimal', () => {
  it('returns true for "0"', () => {
    expect(isZeroLow64Decimal('0')).toBe(true);
  });

  it('returns false for "1"', () => {
    expect(isZeroLow64Decimal('1')).toBe(false);
  });

  it('returns false for "00" (string equality, not numeric coercion)', () => {
    expect(isZeroLow64Decimal('00')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isZeroLow64Decimal('')).toBe(false);
  });

  it('returns false for 2^64-1', () => {
    expect(isZeroLow64Decimal('18446744073709551615')).toBe(false);
  });
});

describe('zero-trace-id emission guard (SC-002)', () => {
  it('conversion of an all-zero OTel trace id yields "0" and the guard flags it so dd.trace_id: 0 is never emitted', () => {
    const converted = hexIdToLow64Decimal('00000000000000000000000000000000');
    expect(converted).toBe('0');
    expect(isZeroLow64Decimal(converted)).toBe(true);
  });
});
