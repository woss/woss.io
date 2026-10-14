---
status: in-progress
phase: 4
updated: 2026-10-13
---

# Datadog Agent Instrumentation

## Goal

Route server traces, metrics, and structured logs through the node-local Datadog Agent with correct production identity, while retaining rotating local files and browser-side Datadog SDKs.

## Context & Decisions

| Decision                                                                                    | Rationale                                                                                                                                                                     | Source                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Treat SvelteKit instrumentation activation as correct; fix exporter routing                 | `experimental.instrumentation.server` is enabled and the module is auto-loaded, but exporters hardcode Datadog intake URLs rather than use the configured Agent endpoint.     | [svelte.config.js](../svelte.config.js), [instrumentation.server.ts](../src/instrumentation.server.ts)                                    |
| Use node-local Agent HTTP receiver at `http://datadog-agent.datadog.svc.cluster.local:4318` | Live Service exposes port 4318 with `internalTrafficPolicy: Local`; live app and Agent pods are both on `buri-image`.                                                         | [deployment.yaml](../deploy/deployment.yaml), [Agent OTLP docs](https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest_in_the_agent/) |
| Enable OTLP log intake separately from container log collection                             | Live Agent has `DD_LOGS_ENABLED=true` and HTTP receiver enabled, but no `DD_OTLP_CONFIG_LOGS_ENABLED`; Datadog documents OTLP logs as disabled by default.                    | [Agent OTLP docs](https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest_in_the_agent/)                                               |
| Send LogTape records through the existing OTel LoggerProvider                               | LogTape's `@logtape/otel` sink supports an existing `LoggerProvider`; sharing it avoids a second exporter/provider and direct Datadog HTTP posts.                             | [logger.ts](../src/lib/server/logger.ts), [LogTape OTel sink](https://jsr.io/@logtape/otel)                                               |
| Make server service/environment/version runtime identity                                    | Built server bundle currently contains `woss-io`, `dev`, `dev`; pod runtime values are `woss`, `prod`, and deploy version. Static imports ignore runtime pod values.          | [instrumentation.server.ts](../src/instrumentation.server.ts), [Dockerfile](../Dockerfile), [deployment.yaml](../deploy/deployment.yaml)  |
| Keep browser RUM and Browser Logs on the browser SDK                                        | Browser SDK uses a public client token and browser intake; it cannot send server logs to a node-local Agent. Keep browser service/environment/version consistent with server. | [datadog-rum.ts](../src/lib/client/datadog-rum.ts)                                                                                        |
| Preserve rotating JSONL files as local fallback                                             | File sink provides local persistence independent of Agent availability.                                                                                                       | [logger.ts](../src/lib/server/logger.ts)                                                                                                  |
| Do not use direct Datadog metrics intake as fallback                                        | Direct metrics intake accepts delta temporality; installed OTel exporter defaults to cumulative. Agent ingestion avoids that intake-specific requirement.                     | [metrics intake docs](https://docs.datadoghq.com/opentelemetry/setup/otlp_ingest/metrics/)                                                |

## Phase 1: Design And Contracts [COMPLETE]

- [x] **1.1 Confirm Agent is the sole server telemetry path and browser SDK remains direct**
- [x] 1.2 Confirm desired Datadog service identity (`woss`), environment (`prod`), deploy version, and service tags.
- [x] 1.3 Confirm current Datadog Operator configuration is externally managed; CI updates the authoritative `DatadogAgent` resource through scoped RBAC.
- [x] 1.4 Define no-duplicate policy: application logs go once through OTel to Agent and once to rotating file; Agent container collection may collect stdout diagnostics but must not tail the same application file.
- [x] 1.5 Record baseline: Agent Service has local-only routing and an Agent pod on app node; OTLP receiver exists, but OTLP log intake flag is missing.

## Phase 2: Server Telemetry Routing [COMPLETE]

- [x] 2.1 Use `@opentelemetry/api-logs@0.221.0` directly; the available LogTape OTel bridge targets an incompatible OTel Logs version.
- [x] 2.2 Connect LogTape records to the global OTel `LoggerProvider` managed by `NodeSDK`; retain the file sink and development console policy.
- [x] 2.3 Remove the custom direct Datadog Logs HTTP sink, avoiding duplicate server log ingestion.
- [x] 2.4 Configure trace, log, and metric exporters to use the Agent HTTP receiver (`/v1/traces`, `/v1/logs`, `/v1/metrics`) through `OTEL_EXPORTER_OTLP_ENDPOINT`.
- [x] 2.5 Keep Agent export failures isolated from requests and local file writes; exporter diagnostics remain bounded and non-recursive.
- [x] 2.6 Preserve SvelteKit trace instrumentation, request/message trace context, LogTape categories, truncation, and trace/log correlation through the OTel sink.

## Phase 3: Identity And Kubernetes Agent [IMPLEMENTED; CANARY PENDING]

- [x] 3.1 Build OTel resource attributes from runtime `DD_SERVICE`, `DD_ENV`, and `DD_VERSION`; Docker runtime identity comes from CI's deploy tag.
- [x] 3.2 Align app resource identity with pod labels and `OTEL_SERVICE_NAME`; service/environment are `woss`/`prod` and deploy version is consistent.
- [x] 3.3 Add a CI-owned, idempotent `DatadogAgent` patch enabling `DD_OTLP_CONFIG_LOGS_ENABLED=true`, while retaining existing log collection.
- [x] 3.4 Preserve node-local delivery using the Agent Service's `internalTrafficPolicy: Local` and the verified app/Agent node placement.
- [x] 3.5 Remove app-only direct-intake `DD_API_KEY` usage and Docker build secret/wiring; Agent retains its own credentials.
- [x] 3.6 Keep Browser RUM/Logs credentials public-token-only; never expose the Datadog API key in browser configuration.

## Phase 4: Verification [IN PROGRESS]

- [x] 4.1 Unit-test OTel sink/provider sharing, Agent endpoint construction, runtime identity, failure isolation, and exactly-once server log export.
- [x] 4.2 Test a LogTape record with an active trace; confirm OTel log record carries trace/span correlation and expected severity/service attributes.
- [x] 4.3 Parse/validate Kubernetes manifests and assert unique app env entries, Agent endpoint, scoped RBAC, and CI Agent patch shell syntax.
- [x] 4.4 Run the full Vitest suite, `pnpm check`, lint, and production build.
- [ ] 4.5 Deploy canary; emit a known trace, metric, and log; confirm receipt in Datadog under `service:woss`, `env:prod`, and deploy version. Confirm no corresponding direct-intake requests and no duplicates.
- [ ] 4.6 Verify local rotating JSONL logs still receive the same server events while Agent is healthy and when Agent export fails.
- [x] 4.7 Verify browser RUM configuration separately; browser telemetry remains browser-to-Datadog, not through the server Agent.

## Acceptance Criteria

- Server exporters use the node-local Datadog Agent, not hardcoded public Datadog intake URLs.
- Agent accepts OTLP traces, metrics, and logs; app and Agent are node-local for the configured Service routing.
- Logs appear once in Datadog with correct service, environment, version, severity, and trace correlation.
- Local rotating files continue to receive server logs independently of Agent availability.
- No API key is present in the built client bundle; browser telemetry uses only public client credentials.
- Production build and focused/full validation pass; live canary confirms delivery.

## Non-Goals

- Removing browser RUM or Browser Logs, changing CSP, or changing local file rotation.
- Treating container stdout collection as a substitute for application logs written only to a file.
- Changing the Datadog Operator through ad-hoc live commands; Agent configuration must be applied through its owning IaC/deployment path.
- Changing Docker Compose, historical logs, or unrelated database data.

## Notes

- 2026-10-13: Planning only. Live read-only checks found Agent HTTP receiver on port 4318, `internalTrafficPolicy: Local`, app and Agent on `buri-image`, general Agent log collection enabled, and no OTLP-specific logs enable flag.
- 2026-10-13: Live pod endpoint env points at the Agent, but built `instrumentation.server.js` hardcodes `http-intake.logs.datadoghq.eu` and bakes `service.name=woss-io`, `deployment.environment=dev`, `service.version=dev` despite pod values `woss`, `prod`, and deploy version.
- 2026-10-13: Datadog direct metrics intake rejects cumulative temporality; current metrics exporter uses its default cumulative preference. Agent routing is the selected remediation path.
- Project-memory and CodeGraph MCP tools were unavailable; decisions cite local implementation, deployment files, live read-only observations, and official vendor documentation directly.
- 2026-10-14: Aligned background generation logs and child spans under an explicit OTel root context. Native span context now takes precedence over custom Datadog fallback IDs, preventing conflicting trace correlation. Full suite passed (551 tests across 40 files), along with `pnpm check`, `pnpm lint`, production build, and a real NodeSDK log/span correlation smoke check. Live canary and Agent healthy/failure delivery checks remain pending.
