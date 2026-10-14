/**
 * Tests for Phase 2 task 2.1: OpenTelemetry SDK import-time startup.
 *
 * Covers:
 *  - logger.ts: initialization reads no transport credentials; LogTape records
 *    are emitted to the shared OTel LoggerProvider and rotating file sink.
 *  - instrumentation.server.ts: the NodeSDK starts at module top level
 *    (import-time side effect), reading OTEL_SDK_DISABLED, OTEL endpoint,
 *    and service identity variables at runtime;
 *    FR-002 silent no-op when OTEL_SDK_DISABLED=1 (no SDK/exporter
 *    constructed), the idempotent init() double-init guard, shutdown()
 *    flushing, and FR-005 (no debug console.log at module load or during
 *    init/shutdown).
 *
 * $env/dynamic/private is mocked with an access-recording Proxy so the tests
 * can prove that logger.ts reads no env property while it is imported.
 * instrumentation.server.ts reads runtime identity and OTLP endpoints via
 * $env/dynamic/private with process.env fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_LOG_MESSAGE_BYTES } from './log-truncate';

/** Keys touched by the modules under test, for process.env hygiene. */
const PROCESS_ENV_KEYS = [
  'OTEL_SDK_DISABLED',
  'OTEL_SERVICE_NAME',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_LOGS_ENDPOINT',
  'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
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

const otelLogState = vi.hoisted(() => {
  const activeContext = { marker: 'active-context' };
  const activeSpan: { current: { traceId: string; spanId: string } | null } = { current: null };
  const getSpan = vi.fn(() => (activeSpan.current ? { spanContext: () => activeSpan.current! } : undefined));
  const emit = vi.fn();
  const logger = { emit, enabled: vi.fn(() => true) };
  const getLogger = vi.fn(() => logger);
  return { activeContext, activeSpan, getSpan, emit, getLogger };
});

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

vi.mock('@opentelemetry/api-logs', () => ({
  logs: { getLogger: otelLogState.getLogger },
  SeverityNumber: {
    UNSPECIFIED: 0,
    TRACE: 1,
    DEBUG: 5,
    INFO: 9,
    WARN: 13,
    ERROR: 17,
    FATAL: 21,
  },
}));

vi.mock('@opentelemetry/api', () => ({
  context: { active: () => otelLogState.activeContext },
  trace: { getSpan: otelLogState.getSpan },
  diag: { setLogger: vi.fn() },
  DiagConsoleLogger: class MockDiagConsoleLogger {},
  DiagLogLevel: { DEBUG: 1 },
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

beforeEach(() => {
  envState.accesses.length = 0;
  for (const key of Object.keys(envState.target)) delete envState.target[key];
  clearProcessEnv();
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://datadog-agent.datadog.svc.cluster.local:4318';
  logtapeState.captured.sinks = null;
  logtapeState.captured.loggers = null;
  otelLogState.emit.mockClear();
  otelLogState.getLogger.mockClear();
  otelLogState.activeSpan.current = null;
  otelState.nodeSDKInstances.length = 0;
  delete (globalThis as Record<string, unknown>)['__woss_log_initialized'];
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('initLogger env access (logger.ts)', () => {
  it('imports and initializes without reading credentials or logging', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await importLogger();

    expect(logSpy).not.toHaveBeenCalled();
    expect(envState.accesses).toEqual([]);

    await mod.initLogger();

    expect(logSpy).not.toHaveBeenCalled();
    expect(envState.accesses).toEqual([]);
    expect(Object.keys(capturedSinks())).not.toContain('zinalog');
    expect(Object.keys(capturedSinks())).toContain('otel');
  });

  it('ignores legacy ZINALOG settings and creates no Zinalog sink', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    setMockEnv({ ZINALOG_URL: 'https://zina.example', ZINALOG_API_KEY: 'legacy-key' });
    const mod = await importLogger();

    await mod.initLogger();

    expect(Object.keys(capturedSinks())).not.toContain('zinalog');
    expect(Object.keys(capturedSinks())).toContain('otel');
    expect(envState.accesses).not.toContain('ZINALOG_URL');
    expect(envState.accesses).not.toContain('ZINALOG_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('emits structured LogTape records through the OTel provider with active context and fallback trace IDs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const mod = await importLogger();

    await mod.initLogger();

    const traceId = '00000000000000010000000000000001';
    const spanId = '0000000000000002';
    invokeSink(
      'otel',
      fakeRecord({
        level: 'warning',
        properties: { traceId, spanId, msgId: 'message-1', userId: 'user-1' },
      }),
    );

    expect(otelLogState.getLogger).toHaveBeenCalledWith('woss.app');
    expect(otelLogState.emit).toHaveBeenCalledTimes(1);
    expect(otelLogState.emit).toHaveBeenCalledWith({
      body: 'hello world',
      severityNumber: 13,
      severityText: 'WARNING',
      attributes: {
        'logtape.category': 'woss.app',
        traceId,
        spanId,
        msgId: 'message-1',
        userId: 'user-1',
        'dd.trace_id': '1',
        'dd.span_id': '2',
      },
      context: otelLogState.activeContext,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('prefers native OTel span correlation over custom fallback trace IDs', async () => {
    otelLogState.activeSpan.current = {
      traceId: '11111111111111111111111111111111',
      spanId: '2222222222222222',
    };
    const mod = await importLogger();
    await mod.initLogger();

    invokeSink(
      'otel',
      fakeRecord({ properties: { traceId: '00000000000000010000000000000001', spanId: '0000000000000002' } }),
    );

    const emitted = otelLogState.emit.mock.calls[0][0] as { attributes: Record<string, unknown> };
    expect(emitted.attributes).not.toHaveProperty('dd.trace_id');
    expect(emitted.attributes).not.toHaveProperty('dd.span_id');
  });

  it('truncates OTel log bodies at the UTF-8 limit', async () => {
    const mod = await importLogger();
    await mod.initLogger();

    const oversized = 'x'.repeat(MAX_LOG_MESSAGE_BYTES + 10);
    invokeSink('otel', fakeRecord({ message: [oversized] }));

    const emitted = otelLogState.emit.mock.calls[0][0] as { body: string };
    expect(Buffer.byteLength(emitted.body, 'utf8')).toBeLessThanOrEqual(MAX_LOG_MESSAGE_BYTES);
  });

  it('routes the woss logger to console/file plus configured sinks', async () => {
    const mod = await importLogger();

    await mod.initLogger();

    const loggers = logtapeState.captured.loggers as Array<{
      category: string[];
      lowestLevel: string;
      sinks: string[];
    }>;
    expect(Object.keys(capturedSinks())).toEqual(['console', 'file', 'otel']);
    expect(loggers[0].category).toEqual(['woss']);
    expect(loggers[0].lowestLevel).toBe('info');
    expect(loggers[0].sinks).toEqual(['console', 'file', 'otel']);
    expect(loggers[1].category).toEqual(['logtape', 'meta']);
    expect(loggers[1].lowestLevel).toBe('warning');
    expect(loggers[1].sinks).toEqual(['console', 'file', 'otel']);
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

  it('uses runtime pod identity and routes OTel exporters to the Agent', async () => {
    setProcessEnv({ DD_SERVICE: 'woss', DD_ENV: 'prod', DD_VERSION: '12-10-2026-main' });
    await importInstrumentation(); // import-time side effect constructs the SDK

    expect(otelState.nodeSDKSpy).toHaveBeenCalledTimes(1);
    const sdkConfig = otelState.nodeSDKSpy.mock.calls[0][0] as { resource: { attributes: Record<string, string> } };
    expect(sdkConfig.resource.attributes).toEqual({
      'service.name': 'woss',
      'deployment.environment': 'prod',
      'service.version': '12-10-2026-main',
    });

    expect(otelState.traceExporterSpy).toHaveBeenCalledTimes(1);
    const traceCfg = otelState.traceExporterSpy.mock.calls[0][0] as {
      url: string;
      compression: string;
      headers: Record<string, string>;
    };
    expect(traceCfg.url).toBe('http://datadog-agent.datadog.svc.cluster.local:4318/v1/traces');
    expect(traceCfg.compression).toBe('gzip');
    expect(traceCfg.headers).toBeUndefined();

    expect(otelState.logExporterSpy).toHaveBeenCalledTimes(1);
    const logCfg = otelState.logExporterSpy.mock.calls[0][0] as { url: string; headers: Record<string, string> };
    expect(logCfg.url).toBe('http://datadog-agent.datadog.svc.cluster.local:4318/v1/logs');
    expect(logCfg.headers).toBeUndefined();

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

  it('defaults service.name to woss and omits unset environment/version', async () => {
    await importInstrumentation(); // empty process.env → SDK starts with defaults at import

    const sdkConfig = otelState.nodeSDKSpy.mock.calls[0][0] as { resource: { attributes: Record<string, string> } };
    expect(sdkConfig.resource.attributes).toEqual({
      'service.name': 'woss',
    });

    const traceCfg = otelState.traceExporterSpy.mock.calls[0][0] as { headers?: Record<string, string> };
    expect(traceCfg.headers).toBeUndefined();
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
