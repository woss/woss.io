/**
 * Tests for Phase 1 task 1.1: Datadog RUM client instrumentation.
 *
 * Covers SC-001..SC-005 against src/lib/client/datadog-rum.ts:
 *  - SC-001: single init — init() called exactly once, repeated init no-ops,
 *    no 'already initialized' error path.
 *  - SC-002: silent skip when env unset — no SDK call, no console output.
 *  - SC-003: exact init config shape — sessionSampleRate 100,
 *    sessionReplaySampleRate 20, trackResources/trackLongTasks/
 *    trackUserInteractions true, defaultPrivacyLevel 'mask-user-input',
 *    NO trackFrustrations key.
 *  - SC-004: SSR safety — module import never touches window/document at
 *    module scope (enforced with @vitest-environment node, where any
 *    module-scope window access would throw ReferenceError on import).
 *  - SC-005: identity — init options carry service 'woss-io' and env 'dev'.
 *
 * @datadog/browser-rum and $env/dynamic/public are mocked (vi.mock) so no
 * SDK/DOM is touched and env reads are fully controlled.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
 */
const rumState = vi.hoisted(() => {
  let config: Record<string, unknown> | null = null;
  const init = vi.fn((opts: Record<string, unknown>) => {
    config = opts;
  });
  const getInitConfiguration = vi.fn(() => config);
  const reset = () => {
    config = null;
    init.mockClear();
    getInitConfiguration.mockClear();
  };
  return { init, getInitConfiguration, reset };
});

vi.mock('$env/dynamic/public', () => ({ env: envState.env }));

vi.mock('@datadog/browser-rum', () => ({
  datadogRum: {
    init: rumState.init,
    getInitConfiguration: rumState.getInitConfiguration,
  },
}));

const APP_ID = 'test-app-id';
const CLIENT_TOKEN = 'test-client-token';

beforeEach(() => {
  rumState.reset();
  delete envState.env.PUBLIC_DD_RUM_APP_ID;
  delete envState.env.PUBLIC_DD_RUM_CLIENT_TOKEN;
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

  it('SC-002 silently returns when both env vars are unset: no SDK call, no console output', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    initDatadogRum();

    expect(rumState.getInitConfiguration).toHaveBeenCalledTimes(1);
    expect(rumState.init).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
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
      defaultPrivacyLevel: 'mask-user-input',
      service: 'woss-io',
      env: 'dev',
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
