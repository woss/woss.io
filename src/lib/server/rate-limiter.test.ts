import { describe, it, expect, vi, beforeEach } from 'vitest';

// Re-import fresh module for each test
const START_TIME = 1_000_000_000_000;

describe('rate-limiter (token bucket)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('creates bucket on first call for unknown IP', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');
    const result = checkRateLimit('192.168.1.1');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });

  it('allows first call with 99 remaining', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');
    const r1 = checkRateLimit('10.0.0.1');
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(99);
  });

  it('blocks 101st call from same IP', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');
    for (let i = 0; i < 100; i++) {
      checkRateLimit('10.0.0.2');
    }
    const result = checkRateLimit('10.0.0.2');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('refills tokens over time', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');

    // Exhaust the bucket
    for (let i = 0; i < 100; i++) {
      checkRateLimit('10.0.0.3');
    }

    let result = checkRateLimit('10.0.0.3');
    expect(result.allowed).toBe(false);

    // Advance 30s — should have 50 tokens refilled
    vi.setSystemTime(START_TIME + 30_000);
    result = checkRateLimit('10.0.0.3');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThanOrEqual(48);
    expect(result.remaining).toBeLessThanOrEqual(50);
  });

  it('rejects invalid IP', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');
    const result = checkRateLimit('');
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('returns resetAt in the future', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');
    const result = checkRateLimit('10.0.0.4');
    expect(result.resetAt).toBeGreaterThan(START_TIME);
  });

  // ── Adversarial / edge-case tests ──

  it('rejects null IP', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');
    const result = checkRateLimit(null as unknown as string);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetAt).toBeGreaterThan(START_TIME);
  });

  it('rejects undefined IP', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');
    const result = checkRateLimit(undefined as unknown as string);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.resetAt).toBeGreaterThan(START_TIME);
  });

  it('rejects number as IP (type confusion)', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');
    const result = checkRateLimit(123 as unknown as string);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('rejects object as IP (type confusion)', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');
    const result = checkRateLimit({} as unknown as string);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('rejects boolean as IP (type confusion)', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');
    const result = checkRateLimit(true as unknown as string);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it('treats very long IP string (10KB) as valid key', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');
    const longIp = 'x'.repeat(10_000);
    const result = checkRateLimit(longIp);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });

  it('handles IP with unicode emoji and zero-width spaces', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');
    const result = checkRateLimit('🔥\u200B\u200B10.0.0.5');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });

  it('handles SQL injection pattern as IP', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');
    const result = checkRateLimit("'; DROP TABLE users; --");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });

  it('handles HTML injection pattern as IP', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');
    const result = checkRateLimit('<script>alert(1)</script>');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });

  it('handles template literal injection pattern as IP', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');
    const result = checkRateLimit('${process.env.SECRET}');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });

  it('refills to full capacity after exact window period', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');

    // Exhaust all 100 tokens
    for (let i = 0; i < 100; i++) {
      checkRateLimit('10.0.0.6');
    }
    expect(checkRateLimit('10.0.0.6').allowed).toBe(false);

    // Advance exact WINDOW_MS — full refill back to CAPACITY
    vi.setSystemTime(START_TIME + 60_000);
    const result = checkRateLimit('10.0.0.6');
    expect(result.allowed).toBe(true);
    // After consuming 1 from full bucket = 99 remaining
    expect(result.remaining).toBe(99);
  });

  it('maintains isolation between different IPs', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');

    // Exhaust IP-A
    for (let i = 0; i < 100; i++) {
      checkRateLimit('ip-a');
    }
    expect(checkRateLimit('ip-a').allowed).toBe(false);

    // IP-B should be fresh — full capacity
    const result = checkRateLimit('ip-b');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);

    // IP-A still blocked
    expect(checkRateLimit('ip-a').allowed).toBe(false);
  });

  it('remaining never exceeds capacity - 1', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');

    // Make many calls to different IPs — each should return <= 99
    for (let i = 0; i < 20; i++) {
      const result = checkRateLimit(`10.0.0.1${i}`);
      expect(result.remaining).toBeLessThanOrEqual(99);
    }
  });

  it('tokens never drop below zero after exhaustion', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');

    // Exhaust
    for (let i = 0; i < 100; i++) {
      checkRateLimit('10.0.0.7');
    }
    // Exhausted
    const r1 = checkRateLimit('10.0.0.7');
    expect(r1.allowed).toBe(false);
    expect(r1.remaining).toBe(0);

    // Even more calls while exhausted
    const r2 = checkRateLimit('10.0.0.7');
    expect(r2.allowed).toBe(false);
    expect(r2.remaining).toBe(0);
  });

  it('resets tokens after full window for a new IP', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');

    // First call creates bucket at START_TIME
    let result = checkRateLimit('10.0.0.8');
    expect(result.allowed).toBe(true);

    // Advance past full window and make another call
    vi.setSystemTime(START_TIME + 120_000);
    result = checkRateLimit('10.0.0.8');
    // Should have refilled to full then consumed 1 → 99 remaining
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
  });

  it('produces monotonically increasing resetAt across successive blocked calls', async () => {
    vi.setSystemTime(START_TIME);
    const { checkRateLimit } = await import('./rate-limiter.ts');

    for (let i = 0; i < 100; i++) {
      checkRateLimit('10.0.0.9');
    }
    const r1 = checkRateLimit('10.0.0.9');
    const r2 = checkRateLimit('10.0.0.9');
    expect(r1.allowed).toBe(false);
    expect(r2.allowed).toBe(false);
    // Each blocked call pushes resetAt further
    expect(r2.resetAt).toBeGreaterThanOrEqual(r1.resetAt);
  });
});
