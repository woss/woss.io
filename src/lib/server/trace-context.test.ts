import { describe, expect, it } from 'vitest';
import { traceStorage, generateTraceId, generateSpanId, getCurrentTraceContext, withTrace } from './trace-context';

describe('generateTraceId', () => {
  it('returns a UUIDv7 string (time-ordered)', () => {
    const id = generateTraceId();
    // UUIDv7 format: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('returns unique values on each call', () => {
    const a = generateTraceId();
    const b = generateTraceId();
    expect(a).not.toBe(b);
  });
});

describe('generateSpanId', () => {
  it('returns a UUIDv4 string', () => {
    const id = generateSpanId();
    // UUIDv4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('returns unique values on each call', () => {
    const a = generateSpanId();
    const b = generateSpanId();
    expect(a).not.toBe(b);
  });
});

describe('getCurrentTraceContext', () => {
  it('returns undefined when no context is active', () => {
    expect(getCurrentTraceContext()).toBeUndefined();
  });

  it('returns the active trace context', () => {
    const traceId = generateTraceId();
    const spanId = generateSpanId();
    withTrace(traceId, spanId, () => {
      const ctx = getCurrentTraceContext();
      expect(ctx).toBeDefined();
      expect(ctx!.traceId).toBe(traceId);
      expect(ctx!.spanId).toBe(spanId);
    });
  });

  it('returns undefined after leaving the context', () => {
    const traceId = generateTraceId();
    const spanId = generateSpanId();
    withTrace(traceId, spanId, () => {
      // inside — context is set
    });
    // outside — context is gone
    expect(getCurrentTraceContext()).toBeUndefined();
  });
});

describe('withTrace', () => {
  it('stores traceId and spanId in traceStorage', () => {
    const traceId = generateTraceId();
    const spanId = generateSpanId();
    let stored: unknown;
    withTrace(traceId, spanId, () => {
      stored = traceStorage.getStore();
    });
    expect(stored).toEqual({ traceId, spanId });
  });

  it('returns the callback result', () => {
    const result = withTrace('t1', 's1', () => 42);
    expect(result).toBe(42);
  });

  it('handles nested withTrace calls (inner overrides)', () => {
    const outerTraceId = generateTraceId();
    const outerSpanId = generateSpanId();
    const innerTraceId = generateTraceId();
    const innerSpanId = generateSpanId();
    let innerCtx: unknown;
    let outerCtx: unknown;
    withTrace(outerTraceId, outerSpanId, () => {
      outerCtx = traceStorage.getStore();
      withTrace(innerTraceId, innerSpanId, () => {
        innerCtx = traceStorage.getStore();
      });
    });
    expect(outerCtx).toEqual({ traceId: outerTraceId, spanId: outerSpanId });
    expect(innerCtx).toEqual({ traceId: innerTraceId, spanId: innerSpanId });
  });
});
