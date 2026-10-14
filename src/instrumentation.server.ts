/**
 * Server-side OpenTelemetry bootstrap for the Datadog Agent.
 *
 * Auto-loaded by SvelteKit via `kit.experimental.instrumentation.server: true`
 * (see svelte.config.js). The NodeSDK starts before application modules and
 * exports traces, logs, and metrics over OTLP HTTP to the node-local Agent.
 *
 * Runtime identity and exporter endpoints are read through `readEnv()` so the
 * running Kubernetes pod, not the image build, determines service/env/version.
 */

import { env as dynamicEnv } from '$env/dynamic/private';
import { dev } from '$app/environment';
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

function readEnv(name: string): string | undefined {
  const fromDynamic = dynamicEnv[name as keyof typeof dynamicEnv];
  return fromDynamic ?? process.env[name];
}

type OtlpSignal = 'traces' | 'logs' | 'metrics';

function getOtlpEndpoint(signal: OtlpSignal): string | undefined {
  const signalEndpoint = readEnv(`OTEL_EXPORTER_OTLP_${signal.toUpperCase()}_ENDPOINT`);
  if (signalEndpoint) return signalEndpoint;

  const endpoint = readEnv('OTEL_EXPORTER_OTLP_ENDPOINT');
  if (!endpoint) return undefined;
  return `${endpoint.replace(/\/+$/, '')}/v1/${signal}`;
}

let sdk: NodeSDK | undefined;
let isSdkDisabled = false;

type TraceExporterNodeConfig = NonNullable<ConstructorParameters<typeof OTLPTraceExporter>[0]>;
type OTelLogRecordExporter = NonNullable<ConstructorParameters<typeof logs.BatchLogRecordProcessor>[0]>['exporter'];
type OTelLogRecord = Parameters<OTelLogRecordExporter['export']>[0][number];
type OTelExportResultCallback = Parameters<OTelLogRecordExporter['export']>[1];

class TruncatingLogRecordExporter implements OTelLogRecordExporter {
  constructor(private wrapped: OTelLogRecordExporter) {}

  export(records: OTelLogRecord[], resultCallback: OTelExportResultCallback): void {
    const truncated = records.map((record) => {
      if (typeof record.body !== 'string' || Buffer.byteLength(record.body, 'utf8') <= MAX_LOG_MESSAGE_BYTES) {
        return record;
      }
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

function createResource(): ReturnType<typeof resources.resourceFromAttributes> {
  const serviceName = readEnv('DD_SERVICE') || readEnv('OTEL_SERVICE_NAME') || SERVICE_NAME_FALLBACK;
  const attributes: Record<string, string> = { 'service.name': serviceName };
  const environment = readEnv('DD_ENV');
  const version = readEnv('DD_VERSION');
  if (environment) attributes['deployment.environment'] = environment;
  if (version) attributes['service.version'] = version;
  return resources.resourceFromAttributes(attributes);
}

function startSdk(): void {
  isSdkDisabled = readEnv('OTEL_SDK_DISABLED') === '1';
  if (isSdkDisabled || sdk) return;

  const tracesEndpoint = getOtlpEndpoint('traces');
  const logsEndpoint = getOtlpEndpoint('logs');
  const metricsEndpoint = getOtlpEndpoint('metrics');
  if (!tracesEndpoint || !logsEndpoint || !metricsEndpoint) {
    if (!dev) console.error('[instrumentation] OTEL_EXPORTER_OTLP_ENDPOINT is required to export telemetry');
    return;
  }

  try {
    if (readEnv('OTEL_DIAG_DEBUG') === '1') {
      diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
    }

    const traceExporter = new OTLPTraceExporter({
      url: tracesEndpoint,
      compression: 'gzip' as TraceExporterNodeConfig['compression'],
    });
    const logExporter = new TruncatingLogRecordExporter(
      new OTLPLogExporter({
        url: logsEndpoint,
        compression: 'gzip' as TraceExporterNodeConfig['compression'],
      }),
    );
    const metricExporter = new OTLPMetricExporter({
      url: metricsEndpoint,
      compression: 'gzip' as TraceExporterNodeConfig['compression'],
    });

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
    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 30000,
      exportTimeoutMillis: 30000,
    });

    const exporterHosts = new Set(
      [tracesEndpoint, logsEndpoint, metricsEndpoint].map((endpoint) => new URL(endpoint).hostname.toLowerCase()),
    );
    const isTelemetryHost = (hostname: string): boolean => {
      const normalized = hostname.toLowerCase();
      return (
        normalized.includes('datadoghq.eu') || normalized.includes('datadoghq.com') || exporterHosts.has(normalized)
      );
    };

    sdk = new NodeSDK({
      resource: createResource(),
      spanProcessors: [spanProcessor],
      logRecordProcessors: [logRecordProcessor],
      metricReaders: [metricReader],
      sampler: new tracing.ParentBasedSampler({
        root: new tracing.TraceIdRatioBasedSampler(1.0),
      }),
      instrumentations: [
        new HttpInstrumentation({
          ignoreOutgoingRequestHook: (request) => isTelemetryHost(request.hostname || ''),
        }),
        new UndiciInstrumentation({
          ignoreRequestHook: (request) => {
            try {
              return isTelemetryHost(new URL(request.origin || '').hostname);
            } catch {
              return false;
            }
          },
        }),
      ],
    });
    sdk.start();
  } catch (error) {
    console.error('[instrumentation] OpenTelemetry SDK initialization failed:', error);
  }
}

startSdk();

export function init(): void {
  startSdk();
}

export async function shutdown(): Promise<void> {
  if (isSdkDisabled || !sdk) return;
  try {
    await sdk.shutdown();
  } catch (error) {
    console.error('[instrumentation] OpenTelemetry SDK shutdown failed:', error);
  }
}

process.once('sveltekit:shutdown', () => {
  void shutdown();
});
