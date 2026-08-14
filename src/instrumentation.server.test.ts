/**
 * Tests for Phase 2 task 2.1: the OpenTelemetry NodeSDK starts at module top
 * level in src/instrumentation.server.ts.
 *
 * Covers:
 *  - Importing the module starts the SDK at import time (module-level side
 *    effect), before any exported function is called.
 *  - Exported init() is idempotent: repeated calls never construct or start
 *    a second SDK, and return undefined.
 *  - OTEL_SDK_DISABLED=1 (read from process.env) keeps the module a
 *    silent no-op: no SDK, no exporters, no instrumentations.
 *  - try/catch safety: when SDK construction or start() throws, module import
 *    still succeeds and init()/shutdown() never throw to the caller.
 *  - Service identity (DD_SERVICE/DD_ENV/DD_VERSION) is read via
 *    $env/static/private, baked into the bundle from .env at build time —
 *    runtime process.env overrides do NOT affect the resource attributes.
 *  - Everything else (DD_API_KEY, OTEL_SDK_DISABLED, OTEL_DIAG_DEBUG) is read
 *    via readEnv(): $env/dynamic/private first, then process.env. The test
 *    mocks $env/dynamic/private to forward to process.env so those assertions
 *    drive the real process.env value (the built adapter-node equivalent).
 *  - shutdown() flushes the SDK started at import time and swallows errors.
 *  - MAX_LOG_MESSAGE_BYTES / truncateLogMessage re-exported unchanged from
 *    ./lib/server/log-truncate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Env keys the module reads; cleared between tests for hygiene. */
const ENV_KEYS = ['OTEL_SDK_DISABLED', 'OTEL_DIAG_DEBUG', 'DD_SERVICE', 'DD_ENV', 'DD_VERSION', 'DD_API_KEY'] as const;

/** Constructor/instance spies for the mocked OpenTelemetry classes. */
const otelState = vi.hoisted(() => {
  const nodeSDKSpy = vi.fn();
  const traceExporterSpy = vi.fn();
  const logExporterSpy = vi.fn();
  const metricExporterSpy = vi.fn();
  const metricReaderSpy = vi.fn();
  const httpInstrumentationSpy = vi.fn();
  const undiciInstrumentationSpy = vi.fn();
  const logRecordProcessorSpy = vi.fn();
  const traceIdRatioSamplerSpy = vi.fn();
  const diagSetLoggerSpy = vi.fn();
  const nodeSDKInstances: { start: ReturnType<typeof vi.fn>; shutdown: ReturnType<typeof vi.fn> }[] = [];
  /** When true, MockNodeSDK#start() throws (exercises the try/catch path). */
  const flags = { throwOnStart: false };

  class MockNodeSDK {
    start = vi.fn(() => {
      if (flags.throwOnStart) throw new Error('boom-start');
    });
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
    constructor(...args: unknown[]) {
      logExporterSpy(...args);
    }
  }
  class MockMetricExporter {
    constructor(...args: unknown[]) {
      metricExporterSpy(...args);
    }
  }
  class MockPeriodicMetricReader {
    constructor(...args: unknown[]) {
      metricReaderSpy(...args);
    }
  }
  class MockHttpInstrumentation {
    constructor(...args: unknown[]) {
      httpInstrumentationSpy(...args);
    }
  }
  class MockUndiciInstrumentation {
    constructor(...args: unknown[]) {
      undiciInstrumentationSpy(...args);
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
    constructor(...args: unknown[]) {
      traceIdRatioSamplerSpy(...args);
    }
  }

  return {
    nodeSDKSpy,
    traceExporterSpy,
    logExporterSpy,
    metricExporterSpy,
    metricReaderSpy,
    httpInstrumentationSpy,
    undiciInstrumentationSpy,
    logRecordProcessorSpy,
    traceIdRatioSamplerSpy,
    diagSetLoggerSpy,
    nodeSDKInstances,
    flags,
    MockNodeSDK,
    MockTraceExporter,
    MockLogExporter,
    MockMetricExporter,
    MockPeriodicMetricReader,
    MockHttpInstrumentation,
    MockUndiciInstrumentation,
    MockBatchSpanProcessor,
    MockBatchLogRecordProcessor,
    MockParentBasedSampler,
    MockTraceIdRatioBasedSampler,
  };
});

// Forward $env/dynamic/private to process.env so readEnv() resolves the
// process.env value the tests drive (the built adapter-node equivalent).
vi.mock('$env/dynamic/private', () => ({
  env: new Proxy(
    {},
    {
      get: (_target, prop) => (typeof prop === 'string' ? process.env[prop] : undefined),
    },
  ),
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

vi.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({
  OTLPMetricExporter: otelState.MockMetricExporter,
}));

vi.mock('@opentelemetry/sdk-metrics', () => ({
  PeriodicExportingMetricReader: otelState.MockPeriodicMetricReader,
}));

vi.mock('@opentelemetry/instrumentation-http', () => ({
  HttpInstrumentation: otelState.MockHttpInstrumentation,
}));

vi.mock('@opentelemetry/instrumentation-undici', () => ({
  UndiciInstrumentation: otelState.MockUndiciInstrumentation,
}));

vi.mock('@opentelemetry/api', () => ({
  diag: { setLogger: otelState.diagSetLoggerSpy },
  DiagConsoleLogger: class MockDiagConsoleLogger {},
  DiagLogLevel: { DEBUG: 1 },
}));

function setProcessEnv(entries: Record<string, string | undefined>): void {
  for (const key of Object.keys(entries)) {
    const value = entries[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearProcessEnv(): void {
  for (const key of ENV_KEYS) delete process.env[key];
}

/** Fresh module instance so the module-scope `isSdkDisabled` and `sdk` never leak. */
async function importInstrumentation(): Promise<typeof import('./instrumentation.server')> {
  vi.resetModules();
  return await import('./instrumentation.server');
}

function sdkResourceAttributes(): Record<string, string> {
  const sdkConfig = otelState.nodeSDKSpy.mock.calls[0][0] as { resource: { attributes: Record<string, string> } };
  return sdkConfig.resource.attributes;
}

function traceExporterConfig(): { url: string; compression: string; headers: Record<string, string> } {
  return otelState.traceExporterSpy.mock.calls[0][0] as {
    url: string;
    compression: string;
    headers: Record<string, string>;
  };
}

beforeEach(() => {
  clearProcessEnv();
  otelState.nodeSDKInstances.length = 0;
  otelState.flags.throwOnStart = false;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('module-level SDK startup (task 2.1)', () => {
  it('starts the NodeSDK at import time, before any exported call', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mod = await importInstrumentation(); // no init() call yet

    expect(logSpy).not.toHaveBeenCalled();
    expect(otelState.nodeSDKSpy).toHaveBeenCalledTimes(1);
    expect(otelState.nodeSDKInstances).toHaveLength(1);
    expect(otelState.nodeSDKInstances[0].start).toHaveBeenCalledTimes(1);
    expect(otelState.traceExporterSpy).toHaveBeenCalledTimes(1);
    expect(otelState.logExporterSpy).toHaveBeenCalledTimes(1);
    expect(otelState.httpInstrumentationSpy).toHaveBeenCalledTimes(1);
    expect(otelState.undiciInstrumentationSpy).toHaveBeenCalledTimes(1);
    expect(otelState.metricExporterSpy).toHaveBeenCalledTimes(1);
    expect(otelState.metricReaderSpy).toHaveBeenCalledTimes(1);
    expect(otelState.logRecordProcessorSpy).toHaveBeenCalledTimes(1);
    expect(otelState.diagSetLoggerSpy).not.toHaveBeenCalled(); // OTEL_DIAG_DEBUG unset

    const traceCfg = traceExporterConfig();
    expect(traceCfg.url).toBe('https://http-intake.logs.datadoghq.eu/v1/traces');
    expect(traceCfg.compression).toBe('gzip');
    expect(traceCfg.headers['dd-otel-span-mapping']).toBe('{"span_name_as_resource_name": true}');
    // dd-otlp-source must stay absent — it triggers a 403 from the intake.
    expect(traceCfg.headers['dd-otlp-source']).toBeUndefined();

    // TruncatingLogRecordExporter wrapper must satisfy the full exporter
    // contract (export/shutdown/forceFlush) for BatchLogRecordProcessor.
    const processorCfg = otelState.logRecordProcessorSpy.mock.calls[0][0] as {
      exporter: { export: unknown; shutdown: unknown; forceFlush: unknown };
    };
    expect(typeof processorCfg.exporter.export).toBe('function');
    expect(typeof processorCfg.exporter.shutdown).toBe('function');
    expect(typeof processorCfg.exporter.forceFlush).toBe('function');

    // Sampling: ParentBasedSampler over TraceIdRatioBasedSampler(1.0).
    expect(otelState.traceIdRatioSamplerSpy).toHaveBeenCalledWith(1.0);

    // Metrics: OTLPMetricExporter → /v1/metrics, gzip, dd-api-key; wired via
    // PeriodicExportingMetricReader into the SDK's metricReaders.
    const metricExporterCfg = otelState.metricExporterSpy.mock.calls[0][0] as {
      url: string;
      compression: string;
      headers: Record<string, string>;
    };
    expect(metricExporterCfg.url).toBe('https://http-intake.logs.datadoghq.eu/v1/metrics');
    expect(metricExporterCfg.compression).toBe('gzip');
    expect(metricExporterCfg.headers).toEqual({ 'dd-api-key': '' });
    const metricReaderCfg = otelState.metricReaderSpy.mock.calls[0][0] as {
      exporter: unknown;
      exportIntervalMillis: number;
      exportTimeoutMillis: number;
    };
    expect(metricReaderCfg.exportIntervalMillis).toBe(30000);
    expect(metricReaderCfg.exportTimeoutMillis).toBe(30000);
    const sdkConfig = otelState.nodeSDKSpy.mock.calls[0][0] as { metricReaders: unknown[] };
    expect(sdkConfig.metricReaders).toHaveLength(1);

    // Log batch processor mirrors the span processor's timeouts/queue.
    const processorOpts = otelState.logRecordProcessorSpy.mock.calls[0][0] as {
      exportTimeoutMillis: number;
      maxQueueSize: number;
    };
    expect(processorOpts.exportTimeoutMillis).toBe(30000);
    expect(processorOpts.maxQueueSize).toBe(2048);

    // undici instrumentation ignores Datadog intake hosts (self-telemetry).
    const undiciCfg = otelState.undiciInstrumentationSpy.mock.calls[0][0] as {
      ignoreRequestHook: (request: { origin?: string }) => boolean;
    };
    expect(undiciCfg.ignoreRequestHook({ origin: 'https://http-intake.logs.datadoghq.eu' })).toBe(true);
    expect(undiciCfg.ignoreRequestHook({ origin: 'https://api.example.com' })).toBe(false);

    expect(mod.init()).toBeUndefined(); // no-op after import-time start
  });

  it('bakes DD_SERVICE/DD_ENV/DD_VERSION from $env/static/private, reads DD_API_KEY from process.env', async () => {
    // Resource identity is baked from .env at build time — process.env
    // overrides must NOT leak into the resource attributes.
    setProcessEnv({ DD_SERVICE: 'woss-svc', DD_ENV: 'prod', DD_VERSION: '9.9.9', DD_API_KEY: 'ddkey' });
    await importInstrumentation();

    expect(sdkResourceAttributes()).toEqual({
      'service.name': 'woss-io',
      'deployment.environment': 'dev',
      'service.version': 'dev',
    });

    // DD_API_KEY stays dynamic (readEnv): process.env drives it.
    const traceCfg = traceExporterConfig();
    expect(traceCfg.headers).toEqual({
      'dd-api-key': 'ddkey',
      'dd-otel-span-mapping': '{"span_name_as_resource_name": true}',
    });

    const logCfg = otelState.logExporterSpy.mock.calls[0][0] as { url: string; headers: Record<string, string> };
    expect(logCfg.url).toBe('https://http-intake.logs.datadoghq.eu/v1/logs');
    expect(logCfg.headers).toEqual({ 'dd-api-key': 'ddkey' });
  });

  it('defaults: service.name=woss-io with baked dev env/version, empty dd-api-key', async () => {
    await importInstrumentation(); // env cleared

    expect(sdkResourceAttributes()).toEqual({
      'service.name': 'woss-io',
      'deployment.environment': 'dev',
      'service.version': 'dev',
    });
    expect(traceExporterConfig().headers['dd-api-key']).toBe('');
  });

  it('enables diag logger only when OTEL_DIAG_DEBUG=1', async () => {
    await importInstrumentation(); // env cleared
    expect(otelState.diagSetLoggerSpy).not.toHaveBeenCalled();

    setProcessEnv({ OTEL_DIAG_DEBUG: '1' });
    await importInstrumentation();
    expect(otelState.diagSetLoggerSpy).toHaveBeenCalledTimes(1);
    expect(otelState.diagSetLoggerSpy.mock.calls[0].length).toBe(2); // (logger, logLevel)
  });

  it('each fresh module import starts exactly one SDK', async () => {
    await importInstrumentation();
    expect(otelState.nodeSDKSpy).toHaveBeenCalledTimes(1);

    await importInstrumentation();
    expect(otelState.nodeSDKSpy).toHaveBeenCalledTimes(2);
  });
});

describe('exported init() idempotency', () => {
  it('init() after import-time startup is a no-op and returns undefined', async () => {
    const mod = await importInstrumentation(); // SDK already started

    expect(mod.init()).toBeUndefined();
    expect(mod.init()).toBeUndefined();

    expect(otelState.nodeSDKSpy).toHaveBeenCalledTimes(1);
    expect(otelState.nodeSDKInstances).toHaveLength(1);
    expect(otelState.nodeSDKInstances[0].start).toHaveBeenCalledTimes(1);
    expect(otelState.traceExporterSpy).toHaveBeenCalledTimes(1);
    expect(otelState.logExporterSpy).toHaveBeenCalledTimes(1);
  });
});

describe('OTEL_SDK_DISABLED gate (process.env)', () => {
  it('module import does not start the SDK when OTEL_SDK_DISABLED=1', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setProcessEnv({ OTEL_SDK_DISABLED: '1' });
    const mod = await importInstrumentation();

    expect(otelState.nodeSDKSpy).not.toHaveBeenCalled();
    expect(otelState.traceExporterSpy).not.toHaveBeenCalled();
    expect(otelState.logExporterSpy).not.toHaveBeenCalled();
    expect(otelState.httpInstrumentationSpy).not.toHaveBeenCalled();
    expect(otelState.logRecordProcessorSpy).not.toHaveBeenCalled();

    expect(mod.init()).toBeUndefined();
    await expect(mod.shutdown()).resolves.toBeUndefined();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('is re-evaluated on each startSdk() call via process.env', async () => {
    setProcessEnv({ OTEL_SDK_DISABLED: '1' });
    const mod = await importInstrumentation();
    expect(otelState.nodeSDKSpy).not.toHaveBeenCalled();

    // process.env is read inside startSdk() — changing it before init() re-evaluates the gate.
    setProcessEnv({ OTEL_SDK_DISABLED: undefined });
    expect(mod.init()).toBeUndefined();
    expect(otelState.nodeSDKSpy).toHaveBeenCalledTimes(1);
  });

  it('is re-evaluated per fresh import from process.env', async () => {
    setProcessEnv({ OTEL_SDK_DISABLED: '1' });
    await importInstrumentation();
    expect(otelState.nodeSDKSpy).not.toHaveBeenCalled();

    setProcessEnv({ OTEL_SDK_DISABLED: undefined });
    await importInstrumentation();
    expect(otelState.nodeSDKSpy).toHaveBeenCalledTimes(1);
  });
});

describe('try/catch safety (telemetry never crashes the server)', () => {
  it('module import succeeds when NodeSDK.start() throws; init() stays a no-op', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    otelState.flags.throwOnStart = true;

    const mod = await importInstrumentation(); // must not throw

    expect(otelState.nodeSDKSpy).toHaveBeenCalledTimes(1);
    expect(otelState.nodeSDKInstances[0].start).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toBe('[instrumentation] OpenTelemetry SDK initialization failed:');
    expect(errSpy.mock.calls[0][1]).toBeInstanceOf(Error);

    // sdk is assigned before start(), so init() must not retry.
    expect(mod.init()).toBeUndefined();
    expect(otelState.nodeSDKSpy).toHaveBeenCalledTimes(1);
  });

  it('module import succeeds when SDK construction throws; later init() retries safely', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    otelState.nodeSDKSpy.mockImplementationOnce(() => {
      throw new Error('boom-ctor');
    });

    const mod = await importInstrumentation(); // must not throw
    expect(errSpy).toHaveBeenCalledTimes(1);

    expect(mod.init()).toBeUndefined(); // retry constructs + starts, never throws
    expect(otelState.nodeSDKSpy).toHaveBeenCalledTimes(2);
    expect(otelState.nodeSDKInstances).toHaveLength(1);
    expect(otelState.nodeSDKInstances[0].start).toHaveBeenCalledTimes(1);
    expect(errSpy).toHaveBeenCalledTimes(1); // retry succeeded → no second error
  });
});

describe('shutdown()', () => {
  it('flushes the SDK started at import time', async () => {
    const mod = await importInstrumentation();

    await expect(mod.shutdown()).resolves.toBeUndefined();
    expect(otelState.nodeSDKInstances).toHaveLength(1);
    expect(otelState.nodeSDKInstances[0].start).toHaveBeenCalledTimes(1);
    expect(otelState.nodeSDKInstances[0].shutdown).toHaveBeenCalledTimes(1);
  });

  it('flushes the SDK when adapter-node emits sveltekit:shutdown', async () => {
    await importInstrumentation();

    process.emit('sveltekit:shutdown' as never, 'SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 0)); // flush microtasks

    expect(otelState.nodeSDKInstances).toHaveLength(1);
    expect(otelState.nodeSDKInstances[0].shutdown).toHaveBeenCalledTimes(1);
  });

  it('swallows SDK shutdown errors', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await importInstrumentation();
    otelState.nodeSDKInstances[0].shutdown.mockRejectedValueOnce(new Error('flush-fail'));

    await expect(mod.shutdown()).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(errSpy.mock.calls[0][0]).toBe('[instrumentation] OpenTelemetry SDK shutdown failed:');
  });
});

describe('re-exports from ./lib/server/log-truncate', () => {
  it('re-exports MAX_LOG_MESSAGE_BYTES and truncateLogMessage unchanged', async () => {
    const mod = await importInstrumentation();

    expect(mod.MAX_LOG_MESSAGE_BYTES).toBe(1024 * 1024);
    expect(typeof mod.truncateLogMessage).toBe('function');
    expect(mod.truncateLogMessage('hello world', 5)).toBe('hello');
    expect(Buffer.byteLength(mod.truncateLogMessage('a'.repeat(10), 4), 'utf8')).toBeLessThanOrEqual(4);
  });
});
