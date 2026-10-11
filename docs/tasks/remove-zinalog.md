---
status: in-progress
phase: 4
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

## Phase 1: Scope And Approval [COMPLETE]

- [x] 1.1 Logging contract agreed; user explicitly approved deleting the unused Compose file. `.env`, external infrastructure, and historical data remain separate gates.
- [x] 1.2 Production server application logs target rotating files and Datadog; development retains console plus file output. Browser errors and warning/error console entries target Datadog.
- [x] 1.3 Covered first-party app logs and operational LogTape scripts. Mermaid renderer is a separate standalone Deno service with no app/deployment wiring in this repo; excluded from this app rollout.
- [x] 1.4 Keep exporter and instrumentation stderr diagnostics as emergency fallbacks to avoid recursive logger failures.
- [x] 1.5 Retain historical Zinalog data; no archive or database deletion performed.
- [x] 1.6 Created `chore/remove-zinalog` via GitButler before implementation. User later explicitly requested committing all worktree changes, including existing `.omp` additions.

## Phase 2: Logger And Coverage [COMPLETE]

- [x] 2.1 Remove the Zinalog sink and credentials from the runtime logger.
- [x] 2.2 Rename the level map for Datadog without changing payload severity mapping.
- [x] 2.3 Production sinks are file plus Datadog; production initialization fails if `DD_API_KEY` is missing. Development keeps console plus file, with Datadog when configured.
- [x] 2.4 Route the model-record diagnostic through LogTape. Existing build-index/download-model scripts already initialize LogTape; reject unresolved MCP secrets instead of writing a console warning.
- [x] 2.5 Initialize Datadog Browser Logs with RUM, forwarding browser exceptions and console warn/error while preserving existing privacy and public-token setup.
- [x] 2.6 Keep export failures on stderr as a non-recursive fallback; file sink remains independent.
- [x] 2.7 Delete the Zinalog log-fetch script and document local rotation plus Datadog's best-effort export.

## Phase 3: Tests And Documentation [COMPLETE WITH REPO GATES]

- [x] 3.1 Remove obsolete sink-specific tests and update logger environment/routing coverage.
- [x] 3.2 Cover production file+Datadog policy, missing-key retry, development routing, and absence of Zinalog requests.
- [x] 3.3 Retain existing Datadog site/key fallback, payload, truncation, tags, trace correlation, and failure coverage.
- [x] 3.4 Focused logging/browser suites pass, including production and MCP regression cases; targeted ESLint and production build pass. Full suite has 34 unrelated route/early-gates/E2E failures; `pnpm check` has existing diagnostics in chat-events, llm-cache, pipeline, route types, and component tests.
- [x] 3.5 Update README logging configuration, browser/server behavior, retention, Compose instructions, and stack overview.
- [x] 3.6 Scan tracked source/docs/config. Zinalog references remain only in this plan and regression tests asserting the legacy sink is ignored; Compose file and fetch tooling are deleted.

## Phase 4: Deployment And Retirement [IN PROGRESS]

- [x] 4.1 User approved removing the unused `docker-compose.yml`; deleted the file and removed its launch instructions. The Compose-only app/init deployment is retired too.
- [ ] **4.2 Remove Zinalog credentials from deployment environment/secrets and verify Datadog configuration** ← CURRENT
- [ ] 4.3 Deploy and emit identifiable application and 404 records. Verify JSONL file writes and corresponding Datadog events, including message/trace IDs and severity. Check startup and exporter-failure diagnostics.
- [ ] 4.4 Check browser events separately if included. Confirm application startup no longer depends on Zinalog and no requests reach its ingestion endpoint.
- [ ] 4.5 Only after successful cutover, retire any existing Zinalog container, port 4000 exposure, and actual `logs.woss.io` proxy/DNS route. Revoke credentials and remove external service configuration.
- [ ] 4.6 Only after separate deletion approval and archive verification, remove Zinalog-specific stored data. Do not delete the shared application data directory or unrelated databases.

## Acceptance Criteria

- No active Zinalog integration, source-controlled Compose definition, ingest requests, or operational tooling remains in this repository. External credentials, services, and routes require deployment access and remain to be checked.
- Production application logs reach local rotating files and Datadog under the agreed log-level policy. Missing Datadog configuration cannot pass rollout verification.
- Datadog failures do not prevent local logging or break requests. Emergency diagnostics remain visible through the agreed fallback.
- Existing CSP, 404 diagnostics, trace/message correlation, and OpenTelemetry behavior remain intact.
- Browser forwarding configuration is covered by tests; live Datadog ingestion and deployment smoke checks remain unverified.
- Focused logging tests, targeted lint, and production build pass; unrelated full-suite/typecheck failures are reported separately.

## Non-Goals

- Replacing LogTape, changing rotation policy, redesigning CSP/origin checks, or migrating historical logs into Datadog.
- Adding a delivery queue, retries, or an agent as part of sink removal. Current direct HTTP export is fire-and-forget and does not guarantee Datadog delivery; local files are the retained fallback.
- Deleting stored logs, editing `.env`, or changing external infrastructure without explicit approval.

## Notes

- 2026-10-11: User requested implementation and explicitly approved removing unused `docker-compose.yml`. Branch created; first implementation commit exists. Follow-up Compose deletion and test changes are pending commit. `.env`, external infrastructure, and historical data remain unchanged.
- Project-memory, graph, Backlog, and plan-save MCP tools were unavailable. This local task document records the backlog and plan; source links replace unavailable delegation references. No delegation IDs were invented.
