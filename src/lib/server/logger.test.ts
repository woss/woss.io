/**
 * Tests for Phase 2 task 2.1: OpenTelemetry SDK import-time startup.
 *
 * Covers:
 *  - logger.ts: all 4 env reads (ZINALOG_URL, ZINALOG_API_KEY, DD_SITE,
 *    DD_API_KEY) happen inside initLogger() at call time, never at module
 *    scope; value-level fallback `env.X ?? process.env.X`; DD_SITE default
 *    `datadoghq.eu`; the Datadog sink is not created (and no POST is ever
 *    attempted) when DD_API_KEY is unset (FR-004); oversized messages are
 *    truncated on the live sink path (FR-003).
 *  - instrumentation.server.ts: the NodeSDK starts at module top level
 *    (import-time side effect), reading OTEL_SDK_DISABLED / DD_SERVICE /
 *    DD_ENV / DD_VERSION / DD_API_KEY from process.env at import time;
 *    FR-002 silent no-op when OTEL_SDK_DISABLED=1 (no SDK/exporter
 *    constructed), the idempotent init() double-init guard, shutdown()
 *    flushing, and FR-005 (no debug console.log at module load or during
 *    init/shutdown).
 *
 * $env/dynamic/private is mocked with an access-recording Proxy so the tests
 * can prove that logger.ts reads no env property while it is imported.
 * instrumentation.server.ts reads process.env at import time and never
 * touches $env/dynamic/private.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_LOG_MESSAGE_BYTES } from './log-truncate';

/** Keys touched by the modules under test, for process.env hygiene. */
const PROCESS_ENV_KEYS = [
  'ZINALOG_URL',
  'ZINALOG_API_KEY',
  'DD_SITE',
  'DD_API_KEY',
  'OTEL_SDK_DISABLED',
  'DD_SERVICE',
  'DD_ENV',
  'DD_VERSION',
] as const;

/** Mutable mock for `$env/dynamic/private`; records every property access. */
const envState = vi.hoisted(() => {
  const accesses: string[] = [];
  const target: Record<string, string | undefined> = {};
  const env = new Proxy(target, {
    get(t, prop) {
      if (typeof prop === 'string') accesses.push(prop);
      return Reflect.get(t, prop);
    },
  });
  return { accesses, target, env };
});

/** Capture point for the mocked @logtape/logtape `configure()` call. */
const logtapeState = vi.hoisted(() => ({
  captured: { sinks: null as Record<string, unknown> | null, loggers: null as unknown[] | null },
}));

/** Constructor spies for the mocked OpenTelemetry classes. */
const otelState = vi.hoisted(() => {
  const nodeSDKSpy = vi.fn();
  const traceExporterSpy = vi.fn();
  const logExporterSpy = vi.fn();
  const httpInstrumentationSpy = vi.fn();
  const logRecordProcessorSpy = vi.fn();
  const nodeSDKInstances: { start: ReturnType<typeof vi.fn>; shutdown: ReturnType<typeof vi.fn> }[] = [];

  class MockNodeSDK {
    start = vi.fn();
    shutdown = vi.fn(async () => undefined);
    constructor(...args: unknown[]) {
      nodeSDKSpy(...args);
      nodeSDKInstances.push(this);
    }
  }
  class MockTraceExporter {
    constructor(...args: unknown[]) {
      traceExporterSpy(...args);
    }
  }
  class MockLogExporter {
    export = vi.fn((_records: unknown, resultCallback: (r: unknown) => void) => resultCallback({ code: 0 }));
    shutdown = vi.fn(async () => undefined);
    forceFlush = vi.fn(async () => undefined);
    constructor(...args: unknown[]) {
      logExporterSpy(...args);
    }
  }
  class MockHttpInstrumentation {
    constructor(...args: unknown[]) {
      httpInstrumentationSpy(...args);
    }
  }
  class MockBatchSpanProcessor {
    constructor() {}
  }
  class MockBatchLogRecordProcessor {
    constructor(...args: unknown[]) {
      logRecordProcessorSpy(...args);
    }
  }
  class MockParentBasedSampler {
    constructor() {}
  }
  class MockTraceIdRatioBasedSampler {
    constructor() {}
  }

  return {
    nodeSDKSpy,
    traceExporterSpy,
    logExporterSpy,
    httpInstrumentationSpy,
    logRecordProcessorSpy,
    nodeSDKInstances,
    MockNodeSDK,
    MockTraceExporter,
    MockLogExporter,
    MockHttpInstrumentation,
    MockBatchSpanProcessor,
    MockBatchLogRecordProcessor,
    MockParentBasedSampler,
    MockTraceIdRatioBasedSampler,
  };
});

vi.mock('$env/dynamic/private', () => ({ env: envState.env }));

vi.mock('@logtape/logtape', () => ({
  configure: async (opts: { sinks: Record<string, unknown>; loggers: unknown[] }) => {
    logtapeState.captured.sinks = opts.sinks;
    logtapeState.captured.loggers = opts.loggers;
  },
  getConsoleSink: (opts: unknown) => ({ type: 'console', opts }),
  getLogger: () => ({ trace() {}, debug() {}, info() {}, warning() {}, error() {}, fatal() {} }),
  getJsonLinesFormatter: (opts: unknown) => ({ type: 'json-lines', opts }),
}));

vi.mock('@logtape/file', () => ({
  getRotatingFileSink: (path: unknown, opts: unknown) => ({ type: 'file', path, opts }),
}));

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: otelState.MockNodeSDK,
  logs: { BatchLogRecordProcessor: otelState.MockBatchLogRecordProcessor },
  tracing: {
    BatchSpanProcessor: otelState.MockBatchSpanProcessor,
    ParentBasedSampler: otelState.MockParentBasedSampler,
    TraceIdRatioBasedSampler: otelState.MockTraceIdRatioBasedSampler,
  },
  resources: { resourceFromAttributes: (attributes: unknown) => ({ attributes }) },
}));

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: otelState.MockTraceExporter,
}));

vi.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
  OTLPLogExporter: otelState.MockLogExporter,
}));

vi.mock('@opentelemetry/instrumentation-http', () => ({
  HttpInstrumentation: otelState.MockHttpInstrumentation,
}));

function setMockEnv(entries: Record<string, string | undefined>): void {
  for (const key of Object.keys(envState.target)) delete envState.target[key];
  Object.assign(envState.target, entries);
}

function setProcessEnv(entries: Record<string, string | undefined>): void {
  for (const key of Object.keys(entries)) {
    const value = entries[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearProcessEnv(): void {
  for (const key of PROCESS_ENV_KEYS) delete process.env[key];
}

/** Fresh module instance so the INIT_KEY guard and `let sdk` never leak state. */
async function importLogger(): Promise<typeof import('./logger')> {
  vi.resetModules();
  return await import('./logger');
}

async function importInstrumentation(): Promise<typeof import('../../instrumentation.server')> {
  vi.resetModules();
  return await import('../../instrumentation.server');
}

function capturedSinks(): Record<string, unknown> {
  expect(logtapeState.captured.sinks).not.toBeNull();
  return logtapeState.captured.sinks as Record<string, unknown>;
}

function invokeSink(name: string, record: Record<string, unknown>): void {
  const sink = capturedSinks()[name];
  expect(typeof sink).toBe('function');
  (sink as (r: Record<string, unknown>) => void)(record);
}

function fakeRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    level: 'info',
    message: ['hello ', 'world'],
    category: ['woss', 'app'],
    properties: {},
    ...overrides,
  };
}

/** True when `s` contains a lone (unpaired) UTF-16 surrogate. */
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

beforeEach(() => {
  envState.accesses.length = 0;
  for (const key of Object.keys(envState.target)) delete envState.target[key];
  clearProcessEnv();
  logtapeState.captured.sinks = null;
  logtapeState.captured.loggers = null;
  otelState.nodeSDKInstances.length = 0;
  delete (globalThis as Record<string, unknown>)['__woss_log_initialized'];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('initLogger env access (logger.ts)', () => {
  it('imports without reading env or logging; reads ZINALOG/DD vars at call time', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await importLogger();

    expect(logSpy).not.toHaveBeenCalled();
    expect(envState.accesses).toEqual([]);

    // Set env AFTER import: a module-scope read would have seen the empty env.
    setMockEnv({ ZINALOG_URL: 'https://zina.example', ZINALOG_API_KEY: 'sekret' });
    await mod.initLogger();

    expect(logSpy).not.toHaveBeenCalled();
    expect(envState.accesses).toEqual(
      expect.arrayContaining(['ZINALOG_URL', 'ZINALOG_API_KEY', 'DD_SITE', 'DD_API_KEY']),
    );
    expect(Object.keys(capturedSinks())).toContain('zinalog');
  });

  it('adds no zinalog sink and POSTs nothing when ZINALOG_* are unset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const mod = await importLogger();

    await mod.initLogger();

    expect(Object.keys(capturedSinks())).not.toContain('zinalog');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to process.env for ZINALOG_URL/ZINALOG_API_KEY when $env is unset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    setProcessEnv({ ZINALOG_URL: 'https://proc-zina.example/', ZINALOG_API_KEY: 'proc-key' });
    const mod = await importLogger();

    await mod.initLogger();
    expect(Object.keys(capturedSinks())).toContain('zinalog');

    invokeSink('zinalog', fakeRecord());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    // Trailing slash is stripped before /api/logs is appended.
    expect(url).toBe('https://proc-zina.example/api/logs');
    expect(init.method).toBe('POST');
    const procAuth = 'Bearer ' + 'proc-key';
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', Authorization: procAuth });
    expect(JSON.parse(init.body)).toEqual({ level: 'info', message: 'hello world', service: 'woss.app' });
  });

  it('prefers $env over process.env for ZINALOG_URL/ZINALOG_API_KEY', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    setMockEnv({ ZINALOG_URL: 'https://env-zina.example', ZINALOG_API_KEY: 'env-key' });
    setProcessEnv({ ZINALOG_URL: 'https://proc-zina.example', ZINALOG_API_KEY: 'proc-key' });
    const mod = await importLogger();

    await mod.initLogger();
    invokeSink('zinalog', fakeRecord());

    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe('https://env-zina.example/api/logs');
    const envAuth = 'Bearer ' + 'env-key';
    expect(init.headers['Authorization']).toBe(envAuth);
  });

  it('FR-004: skips the Datadog sink entirely (no POST, never throws) when DD_API_KEY is unset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await importLogger();

    await expect(mod.initLogger()).resolves.toBeUndefined();

    expect(Object.keys(capturedSinks())).not.toContain('datadog');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('defaults DD_SITE to datadoghq.eu when unset (code path, not constant-only)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    setMockEnv({ DD_API_KEY: 'dd-key' });
    const mod = await importLogger();

    await mod.initLogger();
    invokeSink('datadog', fakeRecord());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string>; body: string }];
    expect(url).toBe('https://http-intake.datadoghq.eu/api/v2/logs');
    expect(init.headers['DD-API-KEY']).toBe('dd-key');
    expect(JSON.parse(init.body)).toEqual({ level: 'info', message: 'hello world', service: 'woss.app' });
  });

  it('uses process.env.DD_SITE when $env.DD_SITE is unset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    setProcessEnv({ DD_SITE: 'datadoghq.com' });
    setMockEnv({ DD_API_KEY: 'dd-key' });
    const mod = await importLogger();

    await mod.initLogger();
    invokeSink('datadog', fakeRecord());

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://http-intake.datadoghq.com/api/v2/logs');
  });

  it('prefers $env.DD_SITE over process.env.DD_SITE', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    setMockEnv({ DD_SITE: 'datadoghq.com', DD_API_KEY: 'dd-key' });
    setProcessEnv({ DD_SITE: 'datadoghq.eu' });
    const mod = await importLogger();

    await mod.initLogger();
    invokeSink('datadog', fakeRecord());

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe('https://http-intake.datadoghq.com/api/v2/logs');
  });

  it('prefers $env.DD_API_KEY over process.env.DD_API_KEY', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    setMockEnv({ DD_API_KEY: 'env-dd-key' });
    setProcessEnv({ DD_API_KEY: 'proc-dd-key' });
    const mod = await importLogger();

    await mod.initLogger();
    invokeSink('datadog', fakeRecord());

    const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers['DD-API-KEY']).toBe('env-dd-key');
  });

  it('FR-003: truncates an oversized message on the live Datadog sink path', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    setMockEnv({ DD_API_KEY: 'dd-key' });
    const mod = await importLogger();

    await mod.initLogger();

    const oversized = 'x'.repeat(MAX_LOG_MESSAGE_BYTES + 10);
    invokeSink('datadog', fakeRecord({ message: [oversized], properties: { traceId: 'trace-1', spanId: 'span-1' } }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as {
      level: string;
      message: string;
      service: string;
      metadata: Record<string, string>;
    };
    expect(body.message.length).toBe(MAX_LOG_MESSAGE_BYTES);
    expect(Buffer.byteLength(body.message, 'utf8')).toBeLessThanOrEqual(MAX_LOG_MESSAGE_BYTES);
    expect(hasLoneSurrogate(body.message)).toBe(false);
    expect(body.metadata).toEqual({ traceId: 'trace-1', spanId: 'span-1' });
  });

  it('never leaves lone surrogates in the truncated sink body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    setMockEnv({ DD_API_KEY: 'dd-key' });
    const mod = await importLogger();

    await mod.initLogger();

    const emoji = '\u{1F600}';
    const message = `${emoji.repeat(MAX_LOG_MESSAGE_BYTES / 4)}a`; // 1 MiB + 1 byte
    invokeSink('datadog', fakeRecord({ message: [message] }));

    const [, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(init.body) as { message: string };
    expect(Buffer.byteLength(body.message, 'utf8')).toBeLessThanOrEqual(MAX_LOG_MESSAGE_BYTES);
    expect(hasLoneSurrogate(body.message)).toBe(false);
  });

  it('routes the woss logger to console/file plus configured sinks', async () => {
    setMockEnv({ ZINALOG_URL: 'https://zina.example', ZINALOG_API_KEY: 'key', DD_API_KEY: 'dd-key' });
    const mod = await importLogger();

    await mod.initLogger();

    const loggers = logtapeState.captured.loggers as Array<{
      category: string[];
      lowestLevel: string;
      sinks: string[];
    }>;
    expect(Object.keys(capturedSinks())).toEqual(['console', 'file', 'zinalog', 'datadog']);
    expect(loggers[0].category).toEqual(['woss']);
    expect(loggers[0].lowestLevel).toBe('info');
    expect(loggers[0].sinks).toEqual(['console', 'file', 'zinalog', 'datadog']);
    expect(loggers[1].category).toEqual(['logtape', 'meta']);
    expect(loggers[1].lowestLevel).toBe('warning');
  });
});

describe('instrumentation.server.ts import-time env + FR-002', () => {
  it('FR-005: with OTEL_SDK_DISABLED=1, module load and init()/shutdown() emit no console output and construct no SDK', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setProcessEnv({ OTEL_SDK_DISABLED: '1' });
    const mod = await importInstrumentation(); // gate read at module scope → import side effect is a no-op

    expect(otelState.nodeSDKSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();

    expect(mod.init()).toBeUndefined();
    await expect(mod.shutdown()).resolves.toBeUndefined();

    expect(otelState.nodeSDKSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('FR-002: with OTEL_SDK_DISABLED=1, import constructs no SDK or exporter and init() never throws', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setProcessEnv({ OTEL_SDK_DISABLED: '1' });
    const mod = await importInstrumentation();

    expect(mod.init()).toBeUndefined();

    expect(otelState.nodeSDKSpy).not.toHaveBeenCalled();
    expect(otelState.traceExporterSpy).not.toHaveBeenCalled();
    expect(otelState.logExporterSpy).not.toHaveBeenCalled();
    expect(otelState.httpInstrumentationSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('FR-002: with OTEL_SDK_DISABLED=1, shutdown() resolves silently', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setProcessEnv({ OTEL_SDK_DISABLED: '1' });
    const mod = await importInstrumentation();

    await expect(mod.shutdown()).resolves.toBeUndefined();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('reads DD_SERVICE/DD_ENV/DD_VERSION/DD_API_KEY from process.env at import time when enabled', async () => {
    setProcessEnv({ DD_SERVICE: 'woss-svc', DD_ENV: 'prod', DD_VERSION: '9.9.9', DD_API_KEY: 'ddkey' });
    const mod = await importInstrumentation(); // import-time side effect constructs the SDK, reading process.env

    expect(otelState.nodeSDKSpy).toHaveBeenCalledTimes(1);
    const sdkConfig = otelState.nodeSDKSpy.mock.calls[0][0] as { resource: { attributes: Record<string, string> } };
    expect(sdkConfig.resource.attributes).toEqual({
      'service.name': 'woss-svc',
      'deployment.environment': 'prod',
      'service.version': '9.9.9',
    });

    expect(otelState.traceExporterSpy).toHaveBeenCalledTimes(1);
    const traceCfg = otelState.traceExporterSpy.mock.calls[0][0] as {
      url: string;
      compression: string;
      headers: Record<string, string>;
    };
    expect(traceCfg.url).toBe('https://http-intake.datadoghq.eu/api/v0.2/otlp/v1/traces');
    expect(traceCfg.compression).toBe('gzip');
    expect(traceCfg.headers).toEqual({
      'dd-api-key': 'ddkey',
      'dd-otel-span-mapping': '{"span_name_as_resource_name": true}',
    });

    expect(otelState.logExporterSpy).toHaveBeenCalledTimes(1);
    const logCfg = otelState.logExporterSpy.mock.calls[0][0] as { url: string; headers: Record<string, string> };
    expect(logCfg.url).toBe('https://http-intake.datadoghq.eu/api/v0.2/otlp/v1/logs');
    expect(logCfg.headers).toEqual({ 'dd-api-key': 'ddkey' });

    // The processor receives the TruncatingLogRecordExporter wrapper, which
    // must implement the full LogRecordExporter contract (export/shutdown/forceFlush).
    const processorCfg = otelState.logRecordProcessorSpy.mock.calls[0][0] as {
      exporter: { export: unknown; shutdown: unknown; forceFlush: unknown };
    };
    expect(typeof processorCfg.exporter.export).toBe('function');
    expect(typeof processorCfg.exporter.shutdown).toBe('function');
    expect(typeof processorCfg.exporter.forceFlush).toBe('function');

    expect(otelState.httpInstrumentationSpy).toHaveBeenCalledTimes(1);
  });

  it('defaults: DD_SERVICE falls back to woss-io; DD_ENV/DD_VERSION omitted; dd-api-key empty', async () => {
    const mod = await importInstrumentation(); // empty process.env → SDK starts with defaults at import

    const sdkConfig = otelState.nodeSDKSpy.mock.calls[0][0] as { resource: { attributes: Record<string, string> } };
    expect(sdkConfig.resource.attributes).toEqual({ 'service.name': 'woss-io' });

    const traceCfg = otelState.traceExporterSpy.mock.calls[0][0] as { headers: Record<string, string> };
    expect(traceCfg.headers['dd-api-key']).toBe('');
  });

  it('init() is idempotent — the SDK starts exactly once at import (double-init guard)', async () => {
    const mod = await importInstrumentation(); // SDK constructed and started once at import

    mod.init();
    mod.init();

    expect(otelState.nodeSDKSpy).toHaveBeenCalledTimes(1);
    expect(otelState.traceExporterSpy).toHaveBeenCalledTimes(1);
    expect(otelState.logExporterSpy).toHaveBeenCalledTimes(1);
    expect(otelState.nodeSDKInstances).toHaveLength(1);
    expect(otelState.nodeSDKInstances[0].start).toHaveBeenCalledTimes(1);
  });

  it('shutdown() flushes the constructed SDK when enabled', async () => {
    const mod = await importInstrumentation(); // SDK constructed & started at import

    await expect(mod.shutdown()).resolves.toBeUndefined();

    expect(otelState.nodeSDKInstances).toHaveLength(1);
    expect(otelState.nodeSDKInstances[0].start).toHaveBeenCalledTimes(1);
    expect(otelState.nodeSDKInstances[0].shutdown).toHaveBeenCalledTimes(1);
  });
});
