/**
 * Tests for Phase 1 task 1.2: client hooks entrypoint wiring.
 *
 * Covers FR-001 against src/hooks.client.ts:
 *  - the client hooks entrypoint exports init() that invokes the Datadog RUM
 *    client initialization (initDatadogRum) from the shared client
 *    instrumentation module, booting the browser-side RUM SDK on page load.
 *
 * The shared instrumentation module (./lib/client/datadog-rum) is mocked
 * (vi.mock) so this stays a pure wiring test: no @datadog/browser-rum SDK,
 * no $env/dynamic/public reads, no DOM, no console output. Idempotency is a
 * downstream concern of initDatadogRum (guarded on getInitConfiguration,
 * covered by SC-001 in datadog-rum.test.ts) — the wrapper itself is a
 * one-call pass-through.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { init } from './hooks.client';

/** Mock backing for the shared client instrumentation module. */
const rumMock = vi.hoisted(() => ({
  initDatadogRum: vi.fn(),
}));

vi.mock('./lib/client/datadog-rum', () => rumMock);

beforeEach(() => {
  rumMock.initDatadogRum.mockClear();
});

describe('init (FR-001 client hooks wiring)', () => {
  it('calls initDatadogRum exactly once with no arguments and returns void', () => {
    expect(rumMock.initDatadogRum).not.toHaveBeenCalled();

    const result = init();

    expect(rumMock.initDatadogRum).toHaveBeenCalledTimes(1);
    expect(rumMock.initDatadogRum).toHaveBeenCalledWith();
    expect(result).toBe(undefined);
  });

  it('forwards every invocation: N init() calls produce exactly N initDatadogRum calls', () => {
    init();
    init();
    init();

    expect(rumMock.initDatadogRum).toHaveBeenCalledTimes(3);
  });

  it('imports without module-scope window/document access (SSR-safe) and defers the SDK call until init()', async () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');

    const mod = await import('./hooks.client');
    expect(typeof mod.init).toBe('function');
    // Import alone must not boot the SDK; only an explicit init() call does.
    expect(rumMock.initDatadogRum).not.toHaveBeenCalled();
  });
});
