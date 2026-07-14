import { describe, it, expect } from 'vitest';
import { checkRateLimit } from './rate-limiter';

describe('rate-limiter', () => {
  it('returns blocked when ip is empty', () => {
    const result = checkRateLimit('');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('returns blocked when ip is not a string', () => {
    const result = checkRateLimit(null as any);
    expect(result.allowed).toBe(false);
  });

  it('allows first request and decrements remaining', () => {
    const result = checkRateLimit('test-ipv4');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });

  it('blocks after MAX_REQUESTS', () => {
    const ip = 'test-limit-' + Date.now();
    for (let i = 0; i < 100; i++) {
      checkRateLimit(ip);
    }
    const result = checkRateLimit(ip);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('function is synchronous (not async)', () => {
    const result = checkRateLimit('test-sync');
    // Should NOT return a Promise
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof result.allowed).toBe('boolean');
  });
});
