/**
 * Tests for Phase 1 task 1.1 (extended in Phase 2 task 2.1): Datadog RUM
 * client instrumentation.
 *
 * Covers SC-001..SC-005 against src/lib/client/datadog-rum.ts:
 *  - SC-001: single init — init() called exactly once, repeated init no-ops,
 *    no 'already initialized' error path.
 *  - SC-002: skip when env unset — no SDK call, no console error/warn; the
 *    module emits one informational console.log (implementation contract).
 *  - SC-003: exact init config shape — sessionSampleRate 100,
 *    sessionReplaySampleRate 20, trackResources/trackLongTasks/
 *    trackUserInteractions true, traceContextInjection 'all',
 *    allowedTracingUrls same-origin predicate, defaultPrivacyLevel
 *    'mask-user-input', NO trackFrustrations key.
 *  - SC-003 (Phase 2 task 2.1): allowedTracingUrls predicate behavior —
 *    true for same-origin absolute URLs, false for cross-origin URLs,
 *    false without throwing for relative or unparseable URLs.
 *  - SC-004: SSR safety — module import never touches window/document at
 *    module scope (enforced with @vitest-environment node, where any
 *    module-scope window access would throw ReferenceError on import).
 *  - SC-005: identity — init options carry service 'woss-io' and env 'dev'.
 *
 * @datadog/browser-rum and $env/dynamic/public are mocked (vi.mock) so no
 * SDK/DOM is touched and env reads are fully controlled. The mock mirrors the
 * real SDK surface (init/getInitConfiguration/onReady) so initDatadogRum()
 * completes without throwing. The allowedTracingUrls predicate reads the
 * global `location` at call time, so the SC-003 predicate tests stub
 * `location` via vi.stubGlobal() inside the node environment (per-file
 * docblock kept intact; module-scope SSR-safety still enforced).
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDatadogRum } from './datadog-rum';

/** Mutable mock backing for `$env/dynamic/public` env reads. */
const envState = vi.hoisted(() => {
  const target: Record<string, string | undefined> = {};
  return { env: target };
});

/**
 * Mock backing for `@datadog/browser-rum`'s datadogRum singleton.
 * init() records its options and marks the SDK initialized; the guard read
 * getInitConfiguration() returns null until init() runs, mirroring the real
 * SDK's "already initialized" semantics so a second call is a true no-op.
 * onReady() mirrors the SDK's ready-callback surface used by the module.
 */
const rumState = vi.hoisted(() => {
  let config: Record<string, unknown> | null = null;
  const init = vi.fn((opts: Record<string, unknown>) => {
    config = opts;
  });
  const getInitConfiguration = vi.fn(() => config);
  const onReady = vi.fn();
  const reset = () => {
    config = null;
    init.mockClear();
    getInitConfiguration.mockClear();
    onReady.mockClear();
  };
  return { init, getInitConfiguration, onReady, reset };
});

vi.mock('$env/dynamic/public', () => ({ env: envState.env }));

vi.mock('@datadog/browser-rum', () => ({
  datadogRum: {
    init: rumState.init,
    getInitConfiguration: rumState.getInitConfiguration,
    onReady: rumState.onReady,
  },
}));

const APP_ID = 'test-app-id';
const CLIENT_TOKEN = 'test-client-token';

beforeEach(() => {
  rumState.reset();
  delete envState.env.PUBLIC_DD_RUM_APP_ID;
  delete envState.env.PUBLIC_DD_RUM_CLIENT_TOKEN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('initDatadogRum (SC-001..SC-005)', () => {
  it('SC-001 initializes exactly once; repeated calls are guarded no-ops with no console error', () => {
    envState.env.PUBLIC_DD_RUM_APP_ID = APP_ID;
    envState.env.PUBLIC_DD_RUM_CLIENT_TOKEN = CLIENT_TOKEN;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    initDatadogRum();
    initDatadogRum();
    initDatadogRum();

    expect(rumState.init).toHaveBeenCalledTimes(1);
    expect(rumState.getInitConfiguration).toHaveBeenCalledTimes(3);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('SC-001 repeated init stays a no-op even when env values change afterwards', () => {
    envState.env.PUBLIC_DD_RUM_APP_ID = APP_ID;
    envState.env.PUBLIC_DD_RUM_CLIENT_TOKEN = CLIENT_TOKEN;
    initDatadogRum();

    envState.env.PUBLIC_DD_RUM_APP_ID = 'second-app-id';
    initDatadogRum();

    expect(rumState.init).toHaveBeenCalledTimes(1);
    expect(rumState.getInitConfiguration).toHaveBeenCalledTimes(2);
  });

  it('SC-002 skips when both env vars are unset: no SDK call, no error/warn, one info log', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    initDatadogRum();

    expect(rumState.getInitConfiguration).toHaveBeenCalledTimes(1);
    expect(rumState.init).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      'Datadog RUM not initialized: PUBLIC_DD_RUM_APP_ID or PUBLIC_DD_RUM_CLIENT_TOKEN is unset',
    );
  });

  it('SC-002 silently returns when only one env var is set', () => {
    envState.env.PUBLIC_DD_RUM_APP_ID = APP_ID;

    initDatadogRum();

    expect(rumState.init).not.toHaveBeenCalled();
  });

  it('SC-003 passes the exact config shape with no trackFrustrations key', () => {
    envState.env.PUBLIC_DD_RUM_APP_ID = APP_ID;
    envState.env.PUBLIC_DD_RUM_CLIENT_TOKEN = CLIENT_TOKEN;

    initDatadogRum();

    expect(rumState.init).toHaveBeenCalledTimes(1);
    const options = rumState.init.mock.calls[0][0] as Record<string, unknown> | undefined;
    expect(options).toEqual({
      applicationId: APP_ID,
      clientToken: CLIENT_TOKEN,
      site: 'datadoghq.eu',
      sessionSampleRate: 100,
      sessionReplaySampleRate: 20,
      trackResources: true,
      trackLongTasks: true,
      trackUserInteractions: true,
      traceContextInjection: 'all',
      allowedTracingUrls: [expect.any(Function)],
      defaultPrivacyLevel: 'mask-user-input',
      service: 'woss-io',
      env: 'dev',
      version: '1.0.1-dev',
    });
    expect(options).not.toHaveProperty('trackFrustrations');
  });

  it('SC-004 module import is SSR-safe: no window/document access at module scope', async () => {
    // Node environment (per-file @vitest-environment node docblock): a
    // module-scope window/document access would throw ReferenceError at import.
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');

    const mod = await import('./datadog-rum');
    expect(typeof mod.initDatadogRum).toBe('function');
  });

  it('SC-005 init options include service woss-io and env dev', () => {
    envState.env.PUBLIC_DD_RUM_APP_ID = APP_ID;
    envState.env.PUBLIC_DD_RUM_CLIENT_TOKEN = CLIENT_TOKEN;

    initDatadogRum();

    const options = rumState.init.mock.calls[0][0] as Record<string, unknown> | undefined;
    expect(options?.service).toBe('woss-io');
    expect(options?.env).toBe('dev');
  });
});

describe('initDatadogRum allowedTracingUrls predicate (SC-003, Phase 2 task 2.1)', () => {
  // The predicate reads the global `location` at call time. The node
  // environment has none, so stub it per-test and let the top-level
  // afterEach (vi.unstubAllGlobals) remove it afterwards.
  const LOCATION_HREF = 'https://example.com/some/page';
  const LOCATION_ORIGIN = 'https://example.com';

  let predicate: ((url: string, init?: RequestInit) => boolean) | null = null;

  beforeEach(() => {
    envState.env.PUBLIC_DD_RUM_APP_ID = APP_ID;
    envState.env.PUBLIC_DD_RUM_CLIENT_TOKEN = CLIENT_TOKEN;
    vi.stubGlobal('location', { href: LOCATION_HREF, origin: LOCATION_ORIGIN });

    initDatadogRum();

    const options = rumState.init.mock.calls[0][0] as Record<string, unknown> | undefined;
    const allowed = options?.allowedTracingUrls;
    if (!Array.isArray(allowed) || typeof allowed[0] !== 'function') {
      throw new Error('init options.allowedTracingUrls[0] must be the same-origin predicate function');
    }
    predicate = allowed[0] as (url: string, init?: RequestInit) => boolean;
  });

  /** Fails the test loudly if the captured predicate is unavailable. */
  function getPredicate(): (url: string, init?: RequestInit) => boolean {
    if (!predicate) throw new Error('allowedTracingUrls[0] predicate missing from captured init options');
    return predicate;
  }

  it('SC-003 init options include traceContextInjection: all', () => {
    const options = rumState.init.mock.calls[0][0] as Record<string, unknown> | undefined;
    expect(options?.traceContextInjection).toBe('all');
  });

  it('SC-003 predicate returns true for a same-origin absolute URL (optional init arg accepted)', () => {
    const pred = getPredicate();
    expect(pred('https://example.com/api/collect')).toBe(true);
    expect(pred('https://example.com/api/collect', { headers: {} })).toBe(true);
  });

  it('SC-003 predicate returns false for a cross-origin URL', () => {
    const pred = getPredicate();
    expect(pred('https://other.example.com/api/collect')).toBe(false);
    // Suffix-attack host must not match the same-origin check.
    expect(pred('https://example.com.evil.test/api/collect')).toBe(false);
  });

  it('SC-003 predicate returns false without throwing for a relative URL', () => {
    const pred = getPredicate();
    expect(() => pred('/api/collect')).not.toThrow();
    expect(pred('/api/collect')).toBe(false);
  });

  it('SC-003 predicate returns false without throwing for an unparseable URL', () => {
    const pred = getPredicate();
    expect(() => pred('http://')).not.toThrow();
    expect(pred('http://')).toBe(false);
  });
});
