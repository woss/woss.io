/**
 * Server-side OpenTelemetry bootstrap for Datadog EU (agentless).
 *
 * Auto-loaded by SvelteKit via `kit.experimental.instrumentation.server: true`
 * (see svelte.config.js). Exports traces and logs over OTLP HTTP/protobuf
 * directly to the Datadog EU intake — no Datadog Agent, no dd-trace transport.
 *
 * The SDK starts at module load (import-time side effect) so the global
 * provider is registered before any application code runs, and stays a no-op
 * whenever `OTEL_SDK_DISABLED=1` (development, CI, tests).
 *
 * Env is read two ways:
 *  - Service identity (`DD_SERVICE`, `DD_ENV`, `DD_VERSION`) comes from
 *    `$env/static/private`, baked into the bundle at build time from `.env`,
 *    so every built run tags spans regardless of the runtime environment.
 *  - Everything else (API keys, SDK toggles) uses `readEnv()` —
 *    `$env/dynamic/private` first, then `process.env`. In dev, `.env` is only
 *    surfaced through `$env/dynamic/private` (SvelteKit's Vite `loadEnv`), so
 *    raw `process.env` misses it. In built adapter-node mode,
 *    `$env/dynamic/private` resolves to `process.env`, so the fallback covers
 *    both. See `readEnv()` below.
 */

import { env as dynamicEnv } from '$env/dynamic/private';
import { DD_ENV, DD_SERVICE, DD_VERSION } from '$env/static/private';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { logs, NodeSDK, resources, tracing } from '@opentelemetry/sdk-node';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { SERVICE_NAME_FALLBACK } from './dd-config';
import { MAX_LOG_MESSAGE_BYTES, truncateLogMessage } from './lib/server/log-truncate';

export { MAX_LOG_MESSAGE_BYTES, truncateLogMessage };

/**
 * Read a server env var from `$env/dynamic/private` first, then `process.env`.
 *
 * In `vite dev`, `process.env` is not populated from `.env` — SvelteKit loads
 * `.env` into the `$env/dynamic/private` module via Vite's `loadEnv`. In built
 * adapter-node mode, `$env/dynamic/private` resolves to `process.env` (a lazy
 * getter), so the fallback covers both. This mirrors `logger.ts`.
 */
function readEnv(name: string): string | undefined {
  const fromDynamic = dynamicEnv[name as keyof typeof dynamicEnv];
  return fromDynamic ?? process.env[name];
}

/** Datadog EU agentless OTLP intake endpoints (HTTP, protobuf payloads). */
const DATADOG_TRACES_ENDPOINT = 'https://http-intake.logs.datadoghq.eu/v1/traces';
const DATADOG_LOGS_ENDPOINT = 'https://http-intake.logs.datadoghq.eu/v1/logs';
const DATADOG_METRICS_ENDPOINT = 'https://http-intake.logs.datadoghq.eu/v1/metrics';

/** `dd-otel-span-mapping` header value: use the span name as the resource name. */
const SPAN_NAME_AS_RESOURCE_NAME = '{"span_name_as_resource_name": true}';

/** Lazily created SDK; guards against double initialization. */
let sdk: NodeSDK | undefined;

/**
 * True when the OpenTelemetry SDK must stay disabled (dev, CI, tests).
 *
 * Read from `process.env` inside startSdk(), which runs at module scope —
 * see the module docstring for why `$env/dynamic/private` is not used.
 */
let isSdkDisabled = false;

/** Config type accepted by OTLPTraceExporter's constructor (OTel 0.221). */
type TraceExporterNodeConfig = NonNullable<ConstructorParameters<typeof OTLPTraceExporter>[0]>;

/** Structural log-record exporter contract derived from the OTel SDK's batch processor. */
type OTelLogRecordExporter = NonNullable<ConstructorParameters<typeof logs.BatchLogRecordProcessor>[0]>['exporter'];

/** Single OTel log record as handed to an exporter's `export()` call. */
type OTelLogRecord = Parameters<OTelLogRecordExporter['export']>[0][number];

/** Completion callback an exporter must invoke after processing a batch. */
type OTelExportResultCallback = Parameters<OTelLogRecordExporter['export']>[1];

/**
 * Exporter decorator that truncates oversized log record bodies to at most
 * 1 MiB of UTF-8 on character boundaries before delegating to the wrapped
 * exporter. Records that already fit pass through unchanged.
 */
class TruncatingLogRecordExporter implements OTelLogRecordExporter {
  constructor(private wrapped: OTelLogRecordExporter) {}

  export(records: OTelLogRecord[], resultCallback: OTelExportResultCallback): void {
    const truncated = records.map((record) => {
      if (typeof record.body !== 'string' || Buffer.byteLength(record.body, 'utf8') <= MAX_LOG_MESSAGE_BYTES) {
        return record;
      }
      // A spread would flatten onto a plain Object.prototype object, losing the
      // accessor getters (hrTime, spanContext, ...) that otlp-transformer reads.
      // Clone with the prototype preserved, copy the own `_`-prefixed fields,
      // then shadow the readonly `body` accessor with a truncated data property.
      const clone = Object.create(Object.getPrototypeOf(record)) as OTelLogRecord;
      Object.assign(clone, record);
      Object.defineProperty(clone, 'body', {
        value: truncateLogMessage(record.body, MAX_LOG_MESSAGE_BYTES),
        writable: true,
        enumerable: true,
        configurable: true,
      });
      return clone;
    });
    this.wrapped.export(truncated, resultCallback);
  }

  shutdown(): Promise<void> {
    return this.wrapped.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.wrapped.forceFlush();
  }
}

/**
 * Build the SDK Resource carrying Datadog service identity.
 *
 * `DD_SERVICE`, `DD_ENV`, and `DD_VERSION` are read from `$env/static/private`,
 * so they bake into the bundle at build time from `.env` — every built run
 * carries `service.name`, `deployment.environment`, and `service.version`
 * regardless of the runtime environment (unlike `readEnv()`, which is
 * `$env/dynamic/private` → `process.env`). `service.name` falls back to
 * `woss-io` (SERVICE_NAME_FALLBACK) when `DD_SERVICE` is unset;
 * `deployment.environment` and `service.version` are only included when
 * their variables are defined.
 */
function createResource(): ReturnType<typeof resources.resourceFromAttributes> {
  const attributes: Record<string, string> = {
    'service.name': DD_SERVICE || SERVICE_NAME_FALLBACK,
  };
  if (DD_ENV) {
    attributes['deployment.environment'] = DD_ENV;
  }
  if (DD_VERSION) {
    attributes['service.version'] = DD_VERSION;
  }
  return resources.resourceFromAttributes(attributes);
}

/**
 * Construct and start the OpenTelemetry SDK.
 *
 * Shared by the import-time side effect and the exported init(). Guards
 * against double initialization: `sdk` is set before start() so a concurrent
 * or repeated call is a no-op. Never awaits export — the batch processors own
 * asynchronous export, so telemetry work stays out of the request lifecycle.
 * Errors are logged and swallowed so telemetry never crashes the server.
 */
function startSdk(): void {
  // readEnv(): $env/dynamic/private first (carries .env in dev), then process.env.
  isSdkDisabled = readEnv('OTEL_SDK_DISABLED') === '1';
  if (isSdkDisabled || sdk) {
    return;
  }

  try {
    // Surface OTel internal diagnostics (exporter failures, init, networking)
    // on stderr only when OTEL_DIAG_DEBUG=1 — avoids log spam in normal runs.
    if (readEnv('OTEL_DIAG_DEBUG') === '1') {
      diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
    }

    const traceExporter = new OTLPTraceExporter({
      url: DATADOG_TRACES_ENDPOINT,
      // gzip is a CompressionAlgorithm member; the enum type lives in otlp-exporter-base (not root-importable).
      compression: 'gzip' as TraceExporterNodeConfig['compression'],
      headers: {
        'dd-api-key': readEnv('DD_API_KEY') ?? '',
        'dd-otel-span-mapping': SPAN_NAME_AS_RESOURCE_NAME,
        // `dd-otlp-source` is deliberately absent — it triggers a 403 from
        // the agentless OTLP intake.
      },
    });

    const logExporter = new TruncatingLogRecordExporter(
      new OTLPLogExporter({
        url: DATADOG_LOGS_ENDPOINT,
        // gzip is a CompressionAlgorithm member; the enum type lives in otlp-exporter-base (not root-importable).
        compression: 'gzip' as TraceExporterNodeConfig['compression'],
        headers: {
          'dd-api-key': readEnv('DD_API_KEY') ?? '',
          // `dd-otlp-source` is deliberately absent — see the trace exporter.
        },
      }),
    );

    const spanProcessor = new tracing.BatchSpanProcessor(traceExporter, {
      maxExportBatchSize: 128,
      scheduledDelayMillis: 1000,
      exportTimeoutMillis: 30000,
      maxQueueSize: 2048,
    });

    const logRecordProcessor = new logs.BatchLogRecordProcessor({
      exporter: logExporter,
      maxExportBatchSize: 100,
      scheduledDelayMillis: 1000,
      exportTimeoutMillis: 30000,
      maxQueueSize: 2048,
    });

    const metricExporter = new OTLPMetricExporter({
      url: DATADOG_METRICS_ENDPOINT,
      compression: 'gzip' as TraceExporterNodeConfig['compression'],
      headers: {
        'dd-api-key': readEnv('DD_API_KEY') ?? '',
        // `dd-otlp-source` is deliberately absent — see the trace exporter.
      },
    });

    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 30000,
      exportTimeoutMillis: 30000,
    });

    sdk = new NodeSDK({
      resource: createResource(),
      spanProcessors: [spanProcessor],
      logRecordProcessors: [logRecordProcessor],
      metricReaders: [metricReader],
      sampler: new tracing.ParentBasedSampler({
        root: new tracing.TraceIdRatioBasedSampler(1.0),
      }),
      // http + https via HttpInstrumentation; global fetch (undici) via
      // UndiciInstrumentation so SvelteKit SSR outbound calls are traced.
      // fs and dns instrumentations are intentionally excluded.
      instrumentations: [
        new HttpInstrumentation({
          ignoreOutgoingRequestHook: (request) => {
            const host = request.hostname || '';
            return host.includes('datadoghq.eu') || host.includes('datadoghq.com');
          },
        }),
        new UndiciInstrumentation({
          ignoreRequestHook: (request) => {
            const origin = request.origin || '';
            return origin.includes('datadoghq.eu') || origin.includes('datadoghq.com');
          },
        }),
      ],
    });

    sdk.start();
  } catch (error) {
    // Telemetry must never crash startup: log loudly, swallow, keep serving.
    console.error('[instrumentation] OpenTelemetry SDK initialization failed:', error);
  }
}

/**
 * Start the OpenTelemetry SDK at module load.
 *
 * Import-time side effect: SvelteKit auto-loads this module via
 * `kit.experimental.instrumentation.server` and never calls the exported
 * init(), so the SDK (and the global trace provider) must be registered
 * before any application code runs. Guarded by OTEL_SDK_DISABLED and
 * try/catch inside startSdk().
 */
startSdk();

/**
 * Initialize the OpenTelemetry SDK.
 *
 * Kept for backwards compatibility. Idempotent: when the import-time side
 * effect already started the SDK — or the SDK is disabled — this is a no-op.
 */
export function init(): void {
  startSdk();
}

/**
 * Gracefully shut down the OpenTelemetry SDK, flushing pending exports.
 *
 * Wired to the adapter-node `sveltekit:shutdown` event (emitted on SIGTERM/
 * SIGINT by the built server) at module load. No-op when the SDK is disabled
 * or was never initialized. Errors are logged and swallowed so shutdown never
 * throws.
 */
export async function shutdown(): Promise<void> {
  if (isSdkDisabled || !sdk) {
    return;
  }
  try {
    await sdk.shutdown();
  } catch (error) {
    console.error('[instrumentation] OpenTelemetry SDK shutdown failed:', error);
  }
}

// adapter-node emits `sveltekit:shutdown` when gracefully stopping on
// SIGTERM/SIGINT — flush telemetry before the process exits.
process.once('sveltekit:shutdown', () => {
  void shutdown();
});
