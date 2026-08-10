/**
 * Tests for Phase 2 task 2.1: the OpenTelemetry NodeSDK starts at module top
 * level in src/instrumentation.server.ts.
 *
 * Covers:
 *  - Importing the module starts the SDK at import time (module-level side
 *    effect), before any exported function is called.
 *  - Exported init() is idempotent: repeated calls never construct or start
 *    a second SDK, and return undefined.
 *  - OTEL_SDK_DISABLED=1 (read from $env/dynamic/private) keeps the module a
 *    silent no-op: no SDK, no exporters, no instrumentations.
 *  - try/catch safety: when SDK construction or start() throws, module import
 *    still succeeds and init()/shutdown() never throw to the caller.
 *  - Env comes from $env/dynamic/private: DD_SERVICE / DD_ENV / DD_VERSION /
 *    DD_API_KEY are read from the SvelteKit env system.
 *  - shutdown() flushes the SDK started at import time and swallows errors.
 *  - MAX_LOG_MESSAGE_BYTES / truncateLogMessage re-exported unchanged from
 *    ./lib/server/log-truncate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** Mutable env mock for $env/dynamic/private — set per test before importInstrumentation(). */
const mockEnv = vi.hoisted(() => ({
  OTEL_SDK_DISABLED: undefined as string | undefined,
  DD_SERVICE: undefined as string | undefined,
  DD_ENV: undefined as string | undefined,
  DD_VERSION: undefined as string | undefined,
  DD_API_KEY: undefined as string | undefined,
}));

vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

/** Env keys the module reads; cleared between tests for hygiene. */
const ENV_KEYS = ['OTEL_SDK_DISABLED', 'DD_SERVICE', 'DD_ENV', 'DD_VERSION', 'DD_API_KEY'] as const;

/** Constructor/instance spies for the mocked OpenTelemetry classes. */
const otelState = vi.hoisted(() => {
  const nodeSDKSpy = vi.fn();
  const traceExporterSpy = vi.fn();
  const logExporterSpy = vi.fn();
  const httpInstrumentationSpy = vi.fn();
  const logRecordProcessorSpy = vi.fn();
  const traceIdRatioSamplerSpy = vi.fn();
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
    constructor(...args: unknown[]) {
      traceIdRatioSamplerSpy(...args);
    }
  }

  return {
    nodeSDKSpy,
    traceExporterSpy,
    logExporterSpy,
    httpInstrumentationSpy,
    logRecordProcessorSpy,
    traceIdRatioSamplerSpy,
    nodeSDKInstances,
    flags,
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
  for (const key of Object.keys(entries)) {
    (mockEnv as Record<string, string | undefined>)[key] = entries[key];
  }
}

function clearMockEnv(): void {
  for (const key of ENV_KEYS) (mockEnv as Record<string, string | undefined>)[key] = undefined;
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
  clearMockEnv();
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
    expect(otelState.logRecordProcessorSpy).toHaveBeenCalledTimes(1);

    const traceCfg = traceExporterConfig();
    expect(traceCfg.url).toBe('https://http-intake.datadoghq.eu/api/v0.2/otlp/v1/traces');
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

    expect(mod.init()).toBeUndefined(); // no-op after import-time start
  });

  it('reads DD_SERVICE/DD_ENV/DD_VERSION/DD_API_KEY from $env/dynamic/private', async () => {
    setMockEnv({ DD_SERVICE: 'woss-svc', DD_ENV: 'prod', DD_VERSION: '9.9.9', DD_API_KEY: 'ddkey' });
    await importInstrumentation();

    expect(sdkResourceAttributes()).toEqual({
      'service.name': 'woss-svc',
      'deployment.environment': 'prod',
      'service.version': '9.9.9',
    });

    const traceCfg = traceExporterConfig();
    expect(traceCfg.headers).toEqual({
      'dd-api-key': 'ddkey',
      'dd-otel-span-mapping': '{"span_name_as_resource_name": true}',
    });

    const logCfg = otelState.logExporterSpy.mock.calls[0][0] as { url: string; headers: Record<string, string> };
    expect(logCfg.url).toBe('https://http-intake.datadoghq.eu/api/v0.2/otlp/v1/logs');
    expect(logCfg.headers).toEqual({ 'dd-api-key': 'ddkey' });
  });

  it('defaults: service.name=woss.io, optional attrs omitted, empty dd-api-key', async () => {
    await importInstrumentation(); // env cleared

    expect(sdkResourceAttributes()).toEqual({ 'service.name': 'woss.io' });
    expect(traceExporterConfig().headers['dd-api-key']).toBe('');
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

describe('OTEL_SDK_DISABLED gate ($env/dynamic/private)', () => {
  it('module import does not start the SDK when OTEL_SDK_DISABLED=1', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setMockEnv({ OTEL_SDK_DISABLED: '1' });
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

  it('is re-evaluated on each startSdk() call via $env/dynamic/private', async () => {
    setMockEnv({ OTEL_SDK_DISABLED: '1' });
    const mod = await importInstrumentation();
    expect(otelState.nodeSDKSpy).not.toHaveBeenCalled();

    // $env/dynamic/private is dynamic — changing it before init() re-evaluates the gate.
    setMockEnv({ OTEL_SDK_DISABLED: undefined });
    expect(mod.init()).toBeUndefined();
    expect(otelState.nodeSDKSpy).toHaveBeenCalledTimes(1);
  });

  it('is re-evaluated per fresh import from $env/dynamic/private', async () => {
    setMockEnv({ OTEL_SDK_DISABLED: '1' });
    await importInstrumentation();
    expect(otelState.nodeSDKSpy).not.toHaveBeenCalled();

    setMockEnv({ OTEL_SDK_DISABLED: undefined });
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
