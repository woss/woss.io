import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { env } from '$env/dynamic/private';

const ddApiKey = env.DD_API_KEY;
if (ddApiKey) {
  console.log('[otel] initializing NodeSDK for Datadog OTLP trace export');
  const site = env.DD_SITE ?? 'datadoghq.eu';
  const serviceName = env.DD_SERVICE ?? 'woss-io';

  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({
      url: `https://otlp.${site}/api/v1/traces`,
      headers: {
        'dd-api-key': ddApiKey,
      },
    }),
    serviceName,
  });

  console.log('[otel] enabling OTel diagnostic logger (DEBUG level)');
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);

  sdk.start();

  // Graceful shutdown — flush remaining spans before exit
  process.on('SIGTERM', () => {
    sdk.shutdown().catch((err) => {
      console.error('[otel] shutdown error:', err);
    });
  });
} else {
  console.log('[otel] DD_API_KEY not set, skipping NodeSDK initialization');
}
