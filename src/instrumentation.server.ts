import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { dev } from '$app/environment';

if (!dev) {
  const agentHost = process.env.DD_AGENT_HOST ?? 'datadog-agent';
  const url = `http://${agentHost}:4318/v1/traces`;
  const metricsUrl = `http://${agentHost}:4318/v1/metrics`;

  console.log(`[otel] initializing NodeSDK, traces to ${url}, metrics to ${metricsUrl}`);

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: metricsUrl }),
    }),
    serviceName: process.env.DD_SERVICE ?? 'woss-io',
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-http': {
          ignoreIncomingRequestHook: (req) => {
            const path = req.url ?? '';
            return path.startsWith('/_app/') || path === '/health' || path === '/api/mcp/status';
          },
          ignoreOutgoingRequestHook: (req) => {
            const host = req.hostname ?? '';
            const port = req.port ?? '';
            return (!host && !port) || host === 'datadog-agent' || (host === '127.0.0.1' && port === '8126');
          },
        },
      }),
    ],
  });

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
  sdk.start();

  process.on('SIGTERM', () => sdk.shutdown().catch(() => {}));
  process.on('SIGINT', () => sdk.shutdown().catch(() => {}));
} else {
  console.log('[otel] skipped — dev environment');
}
