import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { checkRateLimit } from './rate-limiter';

const WINDOW_MS = 60_000;

describe('checkRateLimit (in-memory)', () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllTimers();
  });

  describe('first request', () => {
    it('allows and returns remaining=9', async () => {
      const result = await checkRateLimit('192.168.1.1');

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      expect(result.resetAt).toBeGreaterThan(Date.now());
    });
  });

  describe('within window', () => {
    it('allows up to 10 requests', async () => {
      const ip = '10.0.0.1';
      for (let i = 0; i < 10; i++) {
        const result = await checkRateLimit(ip);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(9 - i);
      }
    });

    it('blocks the 11th request', async () => {
      const ip = '10.0.0.2';
      for (let i = 0; i < 10; i++) {
        await checkRateLimit(ip);
      }
      const result = await checkRateLimit(ip);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe('window expiry', () => {
    it('allows again after WINDOW_MS passes', async () => {
      const ip = '10.0.0.3';
      for (let i = 0; i < 10; i++) {
        await checkRateLimit(ip);
      }
      expect((await checkRateLimit(ip)).allowed).toBe(false);

      // Advance past the window
      vi.advanceTimersByTime(WINDOW_MS + 1);

      const result = await checkRateLimit(ip);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
    });
  });

  describe('per-IP isolation', () => {
    it('tracks different IPs independently', async () => {
      const ipA = '10.0.0.10';
      const ipB = '10.0.0.20';

      // Exhaust ipA
      for (let i = 0; i < 10; i++) {
        await checkRateLimit(ipA);
      }
      expect((await checkRateLimit(ipA)).allowed).toBe(false);

      // ipB is unaffected
      const result = await checkRateLimit(ipB);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
    });
  });

  describe('invalid IP', () => {
    it('blocks empty string', async () => {
      const result = await checkRateLimit('');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('blocks null IP', async () => {
      const result = await checkRateLimit(null as unknown as string);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('blocks undefined IP', async () => {
      const result = await checkRateLimit(undefined as unknown as string);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });
});
