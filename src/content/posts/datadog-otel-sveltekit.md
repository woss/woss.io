---
published: true
title: 'A Datadog and OpenTelemetry Runbook for SvelteKit'
slug: 'datadog-otel-sveltekit'
description: 'A practical, agent-friendly recipe for sending SvelteKit server traces, logs, and metrics through a Datadog Agent, adding browser RUM, and verifying trace correlation.'
date: 2026-10-14
tags:
  - SvelteKit
  - OpenTelemetry
  - Datadog
  - Kubernetes
  - observability
featured: false
---

I thought this was an exporter URL problem.

The SvelteKit app already had OpenTelemetry instrumentation. Production traces and logs still went to Datadog's public intake, though, while the cluster had a Datadog Agent sitting on the same node as the app. I wanted the app to send OTLP to that Agent and let it handle the Datadog connection.

Changing the URL took a few minutes. Getting logs, traces, metrics, browser RUM, build-time behavior, and the Kubernetes deployment to agree took longer.

This is the runbook I wish I had started with. It's written so an AI coding agent can follow it against an existing SvelteKit repository, but the checks are useful whoever is doing the work.

When I say "100% observability" here, I mean that every intended signal has a complete route from the app to Datadog and a verification step. No SDK can automatically know which business operations matter. Add spans and metrics for those yourself, and decide deliberately whether sampling every trace is affordable.

## Runbook for an AI coding agent

Give the agent the repository and ask it to follow these steps in order. It should inspect the current setup before editing, preserve the existing logger and deployment conventions, and leave the work incomplete until the live canary checks pass.

### 1. Inventory the app and Agent

Confirm the app uses SvelteKit's Node adapter. Find `svelte.config.js`, `src/instrumentation.server.ts`, the server hook, and the application logger. Check whether server tracing and instrumentation are already enabled. Inspect the resolved OTel dependency tree and make sure the app and `sdk-node` share one `@opentelemetry/api-logs` version.

On the cluster side, verify the Agent's OTLP/HTTP receiver, Service port `4318`, namespace, and routing policy. If `internalTrafficPolicy: Local` is set, verify that the app pod and a ready Agent pod share a node. Don't assume the receiver or a local endpoint exists just because the Agent is installed.

Agree on identity before changing files:

| Field             | Example                                        |
| ----------------- | ---------------------------------------------- |
| Service           | `woss`                                         |
| Environment       | `prod`                                         |
| Version           | Exact image tag or release identifier          |
| Server transport  | OTLP/HTTP to the local Agent                   |
| Browser transport | Datadog Browser SDK with a public client token |

### 2. Install compatible OTel packages

Use the package manager already used by the project. This is the dependency shape and version set used here; check the repository lockfile and current OTel compatibility before copying it elsewhere:

```bash
pnpm add \
  @opentelemetry/api@^1.9.1 \
  @opentelemetry/api-logs@0.221.0 \
  @opentelemetry/exporter-logs-otlp-http@^0.221.0 \
  @opentelemetry/exporter-metrics-otlp-http@^0.221.0 \
  @opentelemetry/exporter-trace-otlp-http@^0.221.0 \
  @opentelemetry/instrumentation-http@^0.221.0 \
  @opentelemetry/instrumentation-undici@^0.31.0 \
  @opentelemetry/sdk-metrics@^2.10.0 \
  @opentelemetry/sdk-node@^0.221.0
```

Don't add a LogTape OTel bridge until checking its peer and transitive OTel Logs versions. The bridge available during this implementation targeted a different Logs API. Using `@opentelemetry/api-logs` directly kept the LogTape adapter on the same global provider as `NodeSDK`.

### 3. Enable SvelteKit instrumentation

Keep the existing adapter and enable server tracing plus the instrumentation entry point in `svelte.config.js`:

```js
kit: {
  adapter: adapter(),
  experimental: {
    tracing: { server: true },
    instrumentation: { server: true },
  },
}
```

Create `src/instrumentation.server.ts`. Read endpoint and identity values at runtime through `$env/dynamic/private`; don't bake production identity or credentials into the generated server bundle. SvelteKit loads this module before application modules, making it the place to register the SDK.

Inside a `startSdk()` function, the core wiring is:

```ts
const base = env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/+$/, '');
if (!base || env.OTEL_SDK_DISABLED === '1') return;

const sdk = new NodeSDK({
  resource: resources.resourceFromAttributes({
    'service.name': env.DD_SERVICE || env.OTEL_SERVICE_NAME || 'my-sveltekit-app',
    'deployment.environment': env.DD_ENV || 'prod',
    'service.version': env.DD_VERSION || 'local',
  }),
  spanProcessors: [new tracing.BatchSpanProcessor(new OTLPTraceExporter({ url: `${base}/v1/traces` }))],
  logRecordProcessors: [
    new logs.BatchLogRecordProcessor({
      exporter: new OTLPLogExporter({ url: `${base}/v1/logs` }),
    }),
  ],
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
    }),
  ],
  instrumentations: [new HttpInstrumentation(), new UndiciInstrumentation()],
});

sdk.start();
```

In production, support signal-specific `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`, `..._LOGS_ENDPOINT`, and `..._METRICS_ENDPOINT` overrides too. Add batching limits, timeouts, shutdown on `sveltekit:shutdown`, and bounded error reporting. Ignore outgoing requests to the telemetry host in HTTP instrumentation, or exporting telemetry can create more telemetry.

### 4. Bridge the app logger

Keep the app's existing logger. Add a sink that maps its levels to OTel severity and emits the message, category, and structured properties through `logs.getLogger(category).emit(...)`. Pass `context.active()` on each record. Keep local file and development console sinks separate.

`NodeSDK` owns the global `LoggerProvider` and exporters. Don't make a second provider or a second Datadog HTTP client in the logger. Test severity mapping, structured properties, truncation, and an emitted record inside an active span. In this app, server logs still go to rotating JSONL files if Agent export fails.

### 5. Activate spans around async work

Creating a span doesn't make it active. For a background job that outlives its HTTP response, start an independent root and run the entire async pipeline inside its context:

```ts
const root = tracer.startSpan('job.process', {}, ROOT_CONTEXT);
const rootContext = trace.setSpan(ROOT_CONTEXT, root);

await context.with(rootContext, async () => {
  try {
    await processJob(); // child spans and logs inherit the root
  } finally {
    root.end();
  }
});
```

If the app has separate async-local message IDs, keep them as application properties. When a valid native OTel span is active, let OTel supply Datadog trace/span correlation. Don't also attach fallback `dd.trace_id` and `dd.span_id` values that could identify a different trace. Use a tested decimal-ID fallback only when no native span is active.

Auto-instrumentation won't know every business operation. Add spans around important work and metrics for counts, durations, and outcomes. An enabled metrics exporter with no instruments is an empty metrics pipeline, not observability.

### 6. Set runtime identity and endpoints

Set these on the running pod, not only at build time:

```yaml
- name: OTEL_SERVICE_NAME
  value: my-sveltekit-app
- name: DD_SERVICE
  value: my-sveltekit-app
- name: DD_ENV
  value: prod
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  value: http://datadog-agent.datadog.svc.cluster.local:4318
```

Pass the release tag into the Docker runner as `DD_VERSION`, but disable exports only during build/prerender:

```dockerfile
RUN OTEL_SDK_DISABLED=1 pnpm run build
ARG DD_VERSION=local
ENV DD_VERSION=$DD_VERSION
```

Do not disable the SDK in the final container. Keep the Datadog API key in the Agent's secret/configuration. Browser RUM and Browser Logs use the public client token, with matching service, environment, and version. They send directly from the browser to Datadog, not through the server Agent.

### 7. Configure the Agent and CI permissions

Enable the Agent's OTLP/HTTP receiver and its logs signal, expose port `4318` on the Service, and retain the Agent's Datadog site and API key. Container log collection does not enable OTLP log ingestion; here the missing setting was `DD_OTLP_CONFIG_LOGS_ENABLED=true`.

Change the Operator-owned `DatadogAgent` configuration through its owning deployment path. If CI applies the change, grant it only `get`/`patch` on the named Agent resource and `get`/`list`/`watch` on the named Agent DaemonSet. An administrator applies that RBAC first; the deploy token cannot grant itself permissions.

Before rollout, inspect Agent pods, app pods, and EndpointSlices. A local-only Service with no ready endpoint on the app's node is still a broken telemetry route.

### 8. Verify the whole path

Run the project checks before deployment:

```bash
pnpm check
pnpm lint
pnpm test
pnpm build
```

Then deploy a canary and generate a known request that produces a trace, a structured server log, and an instrumented metric. In Datadog, find all three under the same service, environment, and version. Open the trace and confirm its log is attached to the expected span. Test browser RUM separately: verify a session and a deliberate test error from the browser SDK.

Test the failure path in a non-production environment. Block Agent access and confirm the request still completes and the local file sink still writes. Inspect network traffic to confirm server telemetry goes to the Agent rather than public Datadog intake.

The work is done only when those checks pass in Datadog. Unit tests prove local contracts; they can't prove the cluster accepted OTLP records.

## Starting at SvelteKit's server hook

SvelteKit has a server instrumentation entry point behind `kit.experimental.instrumentation.server`. We already had it enabled in `svelte.config.js`, so I used `src/instrumentation.server.ts` to start the OpenTelemetry `NodeSDK` before the rest of the server application loads.

The app uses OTLP over HTTP. In Kubernetes, its generic endpoint is:

```text
http://datadog-agent.datadog.svc.cluster.local:4318
```

The SDK derives the signal URLs from that base:

```text
/v1/traces
/v1/logs
/v1/metrics
```

I also let signal-specific `OTEL_EXPORTER_OTLP_*_ENDPOINT` variables take precedence. That makes local debugging and future endpoint changes less surprising.

The Agent Service uses `internalTrafficPolicy: Local`, and the app and Agent are pinned to the same node. That detail matters: a node-local endpoint is only useful if the workload can actually reach a local Agent pod.

The app no longer needs a Datadog API key for this path. The Agent owns the Datadog credential and forwards telemetry upstream. That keeps the app's server and browser configurations from growing another copy of a powerful secret.

## LogTape needed a small adapter

Traces and metrics already had OTLP exporters. Application logs came from LogTape, which had its own sinks: a rotating JSONL file and a development console sink. I wanted those same LogTape records to go through the `LoggerProvider` owned by the `NodeSDK`.

I looked at LogTape's OpenTelemetry bridge first. Its OTel Logs API dependency did not match the version used by this app, so I used `@opentelemetry/api-logs` directly instead. The sink maps LogTape levels to OTel severity, keeps the category and structured properties, truncates oversized messages, and emits through the global OTel logger provider.

The file sink stays. If the Agent is unavailable, local logs should still be written. The Agent export is batched separately; it shouldn't decide whether the request can finish or whether the local log file gets a record.

## The IDs looked correlated, until they weren't

This was the bug that changed the implementation.

The app already had its own `AsyncLocalStorage` for message trace IDs. OTel has a separate active context for spans. A log could carry the app's `traceId` and `spanId` as properties while its OTel context pointed at a different HTTP span. Both values looked reasonable in isolation. Together, they could point Datadog at two different traces.

It showed up most clearly in chat generation. The request returns `202`, then the longer generation pipeline continues in the background. That work needs a trace of its own, not a request span that has already finished. We created a root span, but creating a span doesn't make it active. The pipeline's child spans and logs were not necessarily running under that root.

The fix was to create the generation span with `ROOT_CONTEXT`, then run the whole pipeline inside a context containing that span. The pipeline's child spans now inherit it. The logger checks for a valid active OTel span and lets that context provide Datadog's trace and span IDs. The app's message IDs remain structured log properties, but they no longer overwrite native OTel correlation fields.

I kept a fallback for logs emitted without an active OTel span. Datadog's log correlation fields use decimal IDs, so the fallback converts the low 64 bits of the app's hex IDs and skips zero values. The native span path is preferable whenever it exists.

## Builds are not production pods

SvelteKit prerendering and the production build happen before an Agent is available. Exporting telemetry from those steps would create noise and make the build depend on a runtime service it cannot reach.

The Docker build disables the OTel SDK during `pnpm run build`. The running container reads service identity and endpoints at runtime. `DD_SERVICE` and `DD_ENV` identify the service as `woss` in `prod`; `DD_VERSION` comes from the image tag created by CI. Browser RUM keeps using the public browser client token and gets the same service, environment, and deploy version.

## The Agent needed a deployment change too

The Agent's OTLP receiver was enabled, but OTLP log ingestion was a separate setting. Container log collection being enabled did not mean OTLP logs would be accepted.

The deploy workflow now patches `DD_OTLP_CONFIG_LOGS_ENABLED=true` on the `DatadogAgent` resource before rolling out the app, then waits for the Agent DaemonSet. The CI service account gets narrowly scoped permissions for that resource and the DaemonSet status check. This keeps the Operator change in the deployment path instead of relying on someone to remember a one-off cluster command.

The workflow deploys to the production Kubernetes cluster after a pull request is merged into `main`. A commit on a feature branch doesn't deploy by itself.

## What is verified, and what isn't

The implementation passes the full Vitest suite, Svelte typecheck, lint, and production build. I also ran a small check against the installed OTel SDK to confirm that a log emitted inside a child span exports with that span's trace and span IDs.

That proves the local wiring, not delivery into Datadog. The live canary still needs to confirm that traces, metrics, and logs arrive with the expected service, environment, and version, and that the Agent and local file sink behave as expected when export succeeds or fails.

For me, the useful lesson was that telemetry configuration doesn't stop at the exporter. The async context that creates a span, the logger that emits a record, the build that bundles the server, and the Agent that receives the data all have to describe the same running service.
