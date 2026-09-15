/**
 * Tests for Phase 1 task 1.1: runtime CSP policy for Datadog EU telemetry delivery.
 *
 * Covers FR-001..FR-004 / AC-5 / SC-003 against src/hooks.server.ts:
 *  - buildCspPolicy() returns the runtime CSP policy string; the Phase 1 change
 *    appended the Datadog EU RUM intake hosts to connect-src.
 *  - a behavioral test drives handle() to prove the policy reaches the response
 *    Content-Security-Policy header (the runtime delivery path), not just that
 *    the config string contains the hosts.
 *
 * Tests parse the policy string (split on ';', then values on whitespace)
 * rather than reimplementing policy generation, so they stay coupled to the
 * emitted policy. Node environment, plain expect assertions — mirrors the
 * sibling test src/hooks.client.test.ts.
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock every server-side dependency handle() pulls in so the behavioral test
// stays hermetic: no real logger, no real config/env access, no uuid churn.
vi.mock('$lib/server/config', () => ({
  config: () => ({ app: { origin: 'http://localhost:5173' } }),
}));
vi.mock('$lib/server/logger', () => ({
  initLogger: vi.fn(async () => undefined),
  CAT: { hooks: 'hooks' },
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('$lib/server/trace-context', () => ({
  generateTraceId: () => 'test-trace-id',
  generateSpanId: () => 'test-span-id',
  withTrace: (_traceId: string, _spanId: string, fn: () => unknown) => fn(),
}));
vi.mock('$env/dynamic/private', () => ({ env: { LOG_LEVEL: 'info' } }));
vi.mock('$app/environment', () => ({ dev: false }));

import { buildCspPolicy, handle } from './hooks.server';
import type { Handle } from '@sveltejs/kit';

afterEach(() => {
  vi.clearAllMocks();
});

/** Split a CSP policy string into directive name -> list of source values. */
function parseCsp(policy: string): Map<string, string[]> {
  const directives = new Map<string, string[]>();
  for (const part of policy.split(';')) {
    const trimmed = part.trim();
    if (trimmed === '') continue;
    const [name, ...values] = trimmed.split(/\s+/);
    directives.set(name, values);
  }
  return directives;
}

describe('buildCspPolicy (FR-001..FR-004 / AC-5 / SC-003)', () => {
  let policy: string;
  let directives: Map<string, string[]>;

  beforeEach(() => {
    policy = buildCspPolicy();
    directives = parseCsp(policy);
  });

  it('permits connections to the Datadog EU RUM intake apex host (FR-001)', () => {
    expect(directives.get('connect-src')).toContain('https://browser-intake-datadoghq.eu');
  });

  it('permits Datadog EU RUM intake subdomain variants via wildcard (FR-001)', () => {
    expect(directives.get('connect-src')).toContain('https://*.browser-intake-datadoghq.eu');
  });

  it('never targets the US intake host family browser-intake-datadoghq.com (FR-004)', () => {
    const connectSrc = directives.get('connect-src') ?? [];
    // Catches the .com apex and any .com subdomain/family variant.
    expect(connectSrc.some((value) => value.includes('browser-intake-datadoghq.com'))).toBe(false);
    expect(connectSrc).not.toContain('https://browser-intake-datadoghq.com');
  });

  it('preserves all prior connect-src permissions (FR-003/SC-003)', () => {
    const connectSrc = directives.get('connect-src') ?? [];
    expect(connectSrc).toContain("'self'");
    expect(connectSrc).toContain('https://api.iconify.design');
    expect(connectSrc).toContain('https://api.simplesvg.com');
    expect(connectSrc).toContain('https://api.unisvg.com');
  });

  it('still permits the blob: worker created by the telemetry SDK (FR-002)', () => {
    const workerSrc = directives.get('worker-src') ?? [];
    expect(workerSrc).toContain("'self'");
    expect(workerSrc).toContain('blob:');
  });

  it('does not introduce unsafe-inline into the directive the change touched (FR-003)', () => {
    // The Phase 1 delta is limited to connect-src. FR-003 forbids relaxing that
    // directive with 'unsafe-inline'. (script-src/style-src already carried
    // 'unsafe-inline' before this change; those directives are untouched by the
    // delta, so a policy-wide assertion would be wrong.)
    const connectSrc = directives.get('connect-src') ?? [];
    expect(connectSrc).not.toContain("'unsafe-inline'");
  });

  it('emits a deterministic policy that parses into every directive (AC-5 structural)', () => {
    // Determinism invariant: repeated calls produce identical output.
    expect(buildCspPolicy()).toBe(policy);
    for (const name of [
      'default-src',
      'script-src',
      'style-src',
      'img-src',
      'font-src',
      'connect-src',
      'worker-src',
      'frame-ancestors',
      'base-uri',
      'form-action',
    ]) {
      expect(directives.has(name)).toBe(true);
    }
  });
});

describe('handle applies the policy at runtime (FR-001..FR-003 behavioral)', () => {
  async function runHandle(
    resolve: () => Promise<Response> | Response = async () => new Response('ok', { status: 200 }),
    url = 'http://localhost:5173/',
  ): Promise<Response> {
    const request = new Request(url, { method: 'GET' });
    const event = {
      url: new URL(url),
      request,
    } as unknown as Parameters<Handle>[0]['event'];
    return handle({ event, resolve } as Parameters<Handle>[0]);
  }

  it('attaches the EU-permitting CSP policy to the response header (FR-001/FR-002 runtime path)', async () => {
    const response = await runHandle();

    const csp = response.headers.get('Content-Security-Policy');
    expect(csp).not.toBeNull();
    const directives = parseCsp(csp as string);
    expect(directives.get('connect-src')).toContain('https://browser-intake-datadoghq.eu');
    expect(directives.get('connect-src')).toContain('https://*.browser-intake-datadoghq.eu');
    expect(directives.get('worker-src')).toContain('blob:');
  });

  it('does not overwrite a Content-Security-Policy already set by the app (FR-003 additive)', async () => {
    const existingCsp = "default-src 'none'";
    const response = await runHandle(
      async () => new Response('ok', { status: 200, headers: { 'Content-Security-Policy': existingCsp } }),
    );

    expect(response.headers.get('Content-Security-Policy')).toBe(existingCsp);
  });
});
