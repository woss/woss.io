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
 * Env is read via `process.env`, never `$env/dynamic/private`: the
 * adapter-node facade imports this module before `Server.init()` populates
 * SvelteKit's private env, so `$env/dynamic/private` would be permanently
 * undefined here in built mode.
 */

import process from 'node:process';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { logs, NodeSDK, resources, tracing } from '@opentelemetry/sdk-node';
import { MAX_LOG_MESSAGE_BYTES, truncateLogMessage } from './lib/server/log-truncate';

export { MAX_LOG_MESSAGE_BYTES, truncateLogMessage };

/** Datadog EU agentless OTLP intake endpoints (HTTP, protobuf payloads). */
const DATADOG_TRACES_ENDPOINT = 'https://http-intake.datadoghq.eu/api/v0.2/otlp/v1/traces';
const DATADOG_LOGS_ENDPOINT = 'https://http-intake.datadoghq.eu/api/v0.2/otlp/v1/logs';

/** `dd-otel-span-mapping` header value: use the span name as the resource name. */
const SPAN_NAME_AS_RESOURCE_NAME = '{"span_name_as_resource_name": true}';

/** Lazily created SDK; guards against double initialization. */
let sdk: NodeSDK | undefined;

/**
 * True when the OpenTelemetry SDK must stay disabled (dev, CI, tests).
 *
 * Read once from `process.env` at module scope: process env is populated by
 * the OS before the process starts, so the module-level startup path can rely
 * on it (unlike `$env/dynamic/private`, which the adapter-node facade has not
 * populated yet when this module is imported).
 */
const isSdkDisabled = process.env.OTEL_SDK_DISABLED === '1';

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
 * `service.name` falls back to `woss.io` when `DD_SERVICE` is unset;
 * `deployment.environment` and `service.version` are only included when
 * their environment variables are defined.
 */
function createResource(): ReturnType<typeof resources.resourceFromAttributes> {
  const attributes: Record<string, string> = {
    'service.name': process.env.DD_SERVICE || 'woss-io',
  };
  if (process.env.DD_ENV) {
    attributes['deployment.environment'] = process.env.DD_ENV;
  }
  if (process.env.DD_VERSION) {
    attributes['service.version'] = process.env.DD_VERSION;
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
  if (isSdkDisabled || sdk) {
    return;
  }

  try {
    const traceExporter = new OTLPTraceExporter({
      url: DATADOG_TRACES_ENDPOINT,
      // gzip is a CompressionAlgorithm member; the enum type lives in otlp-exporter-base (not root-importable).
      compression: 'gzip' as TraceExporterNodeConfig['compression'],
      headers: {
        'dd-api-key': process.env.DD_API_KEY ?? '',
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
          'dd-api-key': process.env.DD_API_KEY ?? '',
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
    });

    sdk = new NodeSDK({
      resource: createResource(),
      spanProcessors: [spanProcessor],
      logRecordProcessors: [logRecordProcessor],
      sampler: new tracing.ParentBasedSampler({
        root: new tracing.TraceIdRatioBasedSampler(1.0),
      }),
      // http + https only: HttpInstrumentation covers both modules. undici,
      // fs, and dns instrumentations are intentionally excluded.
      instrumentations: [new HttpInstrumentation()],
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
 * No-op when the SDK is disabled or was never initialized. Errors are
 * logged and swallowed so shutdown never throws.
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
