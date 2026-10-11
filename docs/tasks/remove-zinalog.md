---
status: not-started
phase: 1
updated: 2026-10-11
---

# Remove Zinalog

## Goal

Remove Zinalog completely while retaining structured server logs in rotating local files and Datadog, with browser logs sent to Datadog.

## Context & Decisions

| Decision                                                | Rationale                                                                                                                                   | Source                                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change the logger, not request-hook behavior            | The hook initializes LogTape and emits request logs; sink selection belongs to the logger. Preserve CSP and 404 logging.                    | [logger](../../src/lib/server/logger.ts#L156), [hook](../../src/hooks.server.ts#L86)                                                                  |
| Retain JSONL files and existing rotation                | Current file sink uses `data/logs/woss.io.log`, 10 MiB rotation, and 70 files. Removal must not weaken local retention.                     | [file sink](../../src/lib/server/logger.ts#L188)                                                                                                      |
| Preserve Datadog payload contracts                      | Datadog shares the Zinalog-named level map and message formatter. Keep severity mapping, truncation, tags, and trace correlation unchanged. | [Datadog sink](../../src/lib/server/logger.ts#L84), [tests](../../src/lib/server/logger.test.ts#L314)                                                 |
| Require Datadog configuration for production acceptance | Today `DD_API_KEY` is optional; no key means no Datadog LogTape sink. Do not silently declare dual-destination logging complete.            | [sink configuration](../../src/lib/server/logger.ts#L180)                                                                                             |
| Audit logs outside LogTape                              | Server console calls bypass the file sink. Browser RUM initialization alone does not establish browser-log collection.                      | [DB](../../src/lib/server/db.ts#L645), [MCP config](../../src/lib/server/mcp/config.ts#L52), [browser setup](../../src/lib/client/datadog-rum.ts#L24) |
| Preserve existing OpenTelemetry integration             | Separate Datadog OTLP logs/traces/metrics setup exists. Zinalog removal must not remove it or add duplicate exports.                        | [instrumentation](../../src/instrumentation.server.ts#L168)                                                                                           |
| Gate deployment and data cleanup                        | Repository rules prohibit Compose and `.env` edits and require explicit approval before database deletion.                                  | [repository rules](../../AGENTS.md)                                                                                                                   |

## Phase 1: Scope And Approval [PENDING]

- [ ] **1.1 Confirm logging contract and approve protected deployment changes** ← CURRENT
- [ ] 1.2 Proposed contract: production server application logs go to file and Datadog; development may retain console output. Browser logs go to Datadog, not local server files unless an explicit ingestion endpoint is requested.
- [ ] 1.3 Include first-party server logs, startup, request errors, scripts used operationally, and browser diagnostics in the coverage audit. Decide whether the separate Mermaid service belongs to this rollout.
- [ ] 1.4 Preserve an emergency stderr path for logger/exporter failures without recursive logging; document exceptions to the dual-destination contract.
- [ ] 1.5 Confirm retention of historical Zinalog data. Back up or export before any separately approved deletion. Never touch application/vector databases.
- [ ] 1.6 Before any implementation changes, inspect GitButler status and create a dedicated `chore/remove-zinalog` branch using the GitButler CLI. Preserve existing uncommitted work and keep unrelated changes out of this branch's commits. Do not create the branch during this planning-only session.

## Phase 2: Logger And Coverage [PENDING]

- [ ] 2.1 Remove `getZinaLogSink`, Zinalog environment reads, sink registration, and related comments from `src/lib/server/logger.ts`.
- [ ] 2.2 Rename `ZINA_LEVEL_MAP` to a Datadog-specific name. Retain the shared message formatter and existing Datadog payload semantics.
- [ ] 2.3 Configure production application/meta loggers for file and Datadog; retain development console output only if approved in phase 1.
- [ ] 2.4 Audit direct server console calls and route normal application logs through category-scoped LogTape loggers. Ensure initialization covers startup and operational scripts, not only the first HTTP request.
- [ ] 2.5 Inspect existing browser-logs initialization and console/error forwarding before changing it. Preserve privacy, service/environment tags, and public-token-only client configuration.
- [ ] 2.6 Keep HTTP export failure handling and local file writes independent. Missing production credentials must be observable without exposing secrets; choose a startup warning or fail-fast policy in phase 1.
- [ ] 2.7 Remove `scripts/fetch-zinalog-logs.ts`. Keep local-file investigation workflows; add Datadog retrieval instructions only where needed.

## Phase 3: Tests And Documentation [PENDING]

- [ ] 3.1 Update logger test environment fixtures, import-time checks, and routing assertions; remove tests that exercise the removed Zinalog sink.
- [ ] 3.2 Assert exact allowed sink sets with and without Datadog credentials, unchanged file configuration, production/development console policy, idempotency, and no HTTP export when Datadog is disabled.
- [ ] 3.3 Preserve Datadog site/key fallback, severity mapping, message truncation, environment tags, trace correlation, and network/non-2xx failure coverage. File logging must still work when Datadog fails.
- [ ] 3.4 Run focused logger, truncation, ID, trace-context, hook, instrumentation, and affected browser tests. Then run repository typecheck, targeted lint, and production build.
- [ ] 3.5 Update README logging overview, environment table, service list, and tech stack. Describe file rotation, Datadog prerequisites, diagnostics, and delivery limitations accurately.
- [ ] 3.6 Scan maintained source, scripts, configuration, and docs for remaining Zinalog names and endpoints. Exempt only this historical plan and deliberately retained archives; regenerate build output rather than editing it.

## Phase 4: Deployment And Retirement [PENDING]

- [ ] 4.1 After explicit approval, remove the Zinalog Compose service and the application's dependency on it. Preserve the index-init dependency and application data mount.
- [ ] 4.2 After explicit approval, remove Zinalog URL, API key, encryption key, and script credentials from deployment environment/secrets. Verify Datadog credentials/site/environment without printing secrets.
- [ ] 4.3 Deploy and emit identifiable application and 404 records. Verify JSONL file writes and corresponding Datadog events, including message/trace IDs and severity. Check startup and exporter-failure diagnostics.
- [ ] 4.4 Check browser events separately if included. Confirm application startup no longer depends on Zinalog and no requests reach its ingestion endpoint.
- [ ] 4.5 Only after successful cutover, retire the Zinalog container, port 4000 exposure, and any actual `logs.woss.io` proxy/DNS route. Revoke credentials and remove external service configuration.
- [ ] 4.6 Only after separate deletion approval and archive verification, remove Zinalog-specific stored data. Do not delete the shared application data directory or unrelated databases.

## Acceptance Criteria

- No active Zinalog integration, credentials, container dependency, ingest requests, or operational tooling remains.
- Production application logs reach local rotating files and Datadog under the agreed log-level policy. Missing Datadog configuration cannot pass rollout verification.
- Datadog failures do not prevent local logging or break requests. Emergency diagnostics remain visible through the agreed fallback.
- Existing CSP, 404 diagnostics, trace/message correlation, and OpenTelemetry behavior remain intact.
- Agreed browser and auxiliary-service coverage is verified, not inferred from package dependencies or RUM setup.
- Focused tests, typecheck, lint, build, and deployment smoke checks pass; unrelated pre-existing failures are reported separately.

## Non-Goals

- Replacing LogTape, changing rotation policy, redesigning CSP/origin checks, or migrating historical logs into Datadog.
- Adding a delivery queue, retries, or an agent as part of sink removal. Current direct HTTP export is fire-and-forget and does not guarantee Datadog delivery; local files are the retained fallback.
- Deleting stored logs, editing protected configuration, or changing infrastructure during this planning session.

## Notes

- 2026-10-11: Planning only. No runtime, test, environment, deployment, or data changes made.
- Project-memory, graph, Backlog, and plan-save MCP tools were unavailable. This local task document records the backlog and plan; source links replace unavailable delegation references. No delegation IDs were invented.
