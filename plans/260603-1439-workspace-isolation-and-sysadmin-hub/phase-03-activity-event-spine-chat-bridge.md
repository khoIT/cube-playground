---
phase: 3
title: "Activity Event Spine & Chat Bridge"
status: complete
priority: P1
effort: "3-4d"
dependencies: [1]
---

# Phase 3: Activity Event Spine & Chat Bridge (Sub-project B, core)

## Overview
Stand up one append-only `activity_events` table + an emit helper, instrument the top-3 highest-value event types, and add a shared-secret `/internal/stats` endpoint on chat-service so the admin hub can aggregate activity across both DBs without reaching into `chat.db` directly.

## Requirements
- Functional:
  - `activity_events` table (main DB): `id, actor_sub, actor_email, event_type, target_type, target_id, workspace, game, detail_json, ts`. **Primary key for aggregation = `actor_sub`** (always present via `req.owner`); `actor_email` is a nullable display field. Indexed `(actor_sub, ts)` and `(event_type, ts)`.
  - `recordActivity(principal, { eventType, targetType?, targetId?, workspace?, game?, detail? })` — non-blocking, mirrors `business_metric_audit-store` append. `principal.sub` is mandatory; `detail` passes through the whitelist projector (below).
  - Top emit points this phase: **query-run**, **segment create/edit/delete/refresh** (or a single `segment_op` with action in detail), **feature-open** (route-level, per `feature-keys`).
  - **Chat stats endpoint (red-team F1/C1/C2 — this is NET-NEW auth, not "mirror"):** chat-service has NO inbound secret gate today, and its existing `GET /stats?owner=` 403s cross-user + keys on `sub`. Add a NEW internal route `GET /internal/stats` (bulk, by `sub[]`) on chat-service behind a NEW inbound service-token middleware (introduce a chat-service `INTERNAL_SECRET`). It keys on `owner_id` (=sub). The main server resolves `email→sub` via `user_access.kc_sub` (Phase 1) BEFORE calling — chat.db has no email.
- Non-functional: emit fire-and-forget (wrapped; on `SQLITE_FULL`/`IOERR`/`CORRUPT` log at WARN, not debug, so disk exhaustion is visible); emit runs OUTSIDE the request's own DB transaction (no txn poisoning); retention ≥90d (Phase 4 prune).

## Architecture
- **`actor_sub` primary, `actor_email` display** — resolves the Phase-1 duality correctly (email is nullable; sub is not). Aggregation (Phase 4) groups by sub, joins email for display.
- `event_type` closed enum (`query_run | segment_op | feature_open | export | workspace_switch`; `export`/`workspace_switch` wired Phase 4). Validate on write.
- **`detail_json` = member-NAME whitelist only (red-team F6/F8):** a projector extracts `{cubes[], measures[], dimensions[]}` names from the query payload. NEVER store filter VALUES, predicate literals, or `uid_list_json` (real player IDs). Unit-test that values/UIDs never appear.
- Chat seam: NEVER open `chat.db` from the main server — the new `/internal/stats` is the only cross-service read. **Ensure it is NOT fail-open under `AUTH_DISABLED`** (unlike the existing `/internal/access`); the secret gate is unconditional. Coordinate with `plans/260601-1319-chat-turn-profiling-decompose` (overlapping chat-stats surface) to avoid duplication.

## Related Code Files
- Create: `server/src/db/migrations/0XX-activity-events.sql`, `server/src/services/activity-store.ts` (+ test), `server/src/services/activity-event-types.ts` (enum)
- Modify (emit points): playground query route (`server/src/routes/playground*` / cube-token query path), `server/src/routes/segments.ts`, a feature-open hook in route registration or a thin FE beacon → server endpoint
- Create (chat): `chat-service/src/api/internal-stats.ts` (+ test) — bulk by `sub[]`, register in chat-service app; **NEW** `chat-service/src/middleware/internal-secret.ts` (inbound service-token gate — does not exist today)
- Read: `server/src/db/business-metric-audit-store.ts` (append pattern), `server/src/routes/internal-access.ts` (server-side secret pattern to adapt), `chat-service/src/api/stats.ts` (existing self-scoped `/stats` — do not break), `server/src/middleware/service-token.ts`

## TDD: Tests First
1. `activity-store.test.ts`: insert + query by **sub**/type/time; enum rejects unknown event_type; emit swallows errors (inject failing db, assert request unaffected); **detail projector test: filter values + uid_list NEVER appear in `detail_json`** (only member names).
2. Emit-point tests: query-run / segment-op / feature-open → exactly one row with `actor_sub` set + correct shape.
3. `internal-stats.test.ts` (chat-service): bulk by `sub[]` returns correct per-sub counts; **rejects without `INTERNAL_SECRET` (401) even when `AUTH_DISABLED=true`**; existing `/stats?owner=` self-scope still 403s cross-user (unbroken).
4. Run → red → implement → green.

## Implementation Steps
1. Write store + enum + emit tests (tests-first).
2. Migration + `activity-store.ts` + `recordActivity` (fire-and-forget wrapper).
3. Wire top-3 emit points (query-run, segment ops, feature-open).
4. Chat-service `/internal/stats` (+ bulk) behind shared secret; tests.
5. Full suites green (server + chat-service); confirm no request-latency regression on a smoke run.

## Success Criteria
- [x] `activity_events` records query-run, segment-op, feature-open keyed on `actor_sub` (email = display). — migration `029-activity-events.sql`, `activity-store.ts`, emits in `cube-proxy.ts`/`segments.ts`/`activity.ts`.
- [x] Emit non-blocking; store failure never fails the request; disk-error surfaces at WARN; emit outside caller txn. — `recordActivity` swallows, WARN on `SQLITE_FULL/IOERR/CORRUPT`, runs on shared autocommit conn; tested.
- [x] `detail_json` proven (test) to contain member names only — never filter values or UIDs. — `projectQueryShape` is an extract-only allowlist `{cubes,measures,dimensions}`; `activity-store.test.ts` asserts values/dateRange/UIDs never serialise.
- [x] NEW chat `/internal/stats` (bulk, sub-keyed) behind unconditional `INTERNAL_SECRET` (rejects even under `AUTH_DISABLED`); existing `/stats` unbroken. — `internal-secret.ts` (no AUTH_DISABLED branch) + `internal-stats.ts` + `queryStatsBulk`; `internal-stats.test.ts` proves 401-under-AUTH_DISABLED and /stats cross-user 403.
- [x] Full suites green; no measurable latency regression. — server 659 pass / 4 pre-existing (internal-access-route, unrelated); chat-service 885/885; FE tsc 0 new.

## Completion Notes (2026-06-03)
- Built TDD; server tsc 0, chat-service tsc 0, FE tsc unchanged (72 pre-existing, 0 new).
- Emit points wired: `query_run` (cube-proxy `/load` GET+POST, only on 200), `segment_op` (create/update/delete/append/refresh), `feature_open` (FE beacon → `POST /api/activity/feature-open`). `export`/`workspace_switch` reserved for Phase 4.
- Code review: DONE, no blocking issues. **Carry-forward to Phase 4/5 (non-blocking):**
  - `queryStatsBulk` is N sequential per-sub queries — collapse to one `WHERE owner_id IN (...) GROUP BY owner_id, skill` if the hub passes large `subs[]`.
  - `/internal/stats` has no upper bound on `subs[]` length — add a cap when the caller (admin hub) is wired.
  - cost-math (`cost_usd`) duplicated between `stats.ts` and `internal-stats.ts` — extract a helper if touched again.
  - `import-ids` segment creation is uninstrumented — decide in Phase 4 whether it should emit `segment_op{action:'create'}`.

## Risk Assessment
- **Risk:** telemetry write slows hot paths / poisons txns. **Mitigation:** fire-and-forget, single indexed insert, run outside caller txn.
- **Risk:** "mirror existing auth" fiction → unauthenticated cross-user stats leak. **Mitigation:** build a real chat-service inbound secret gate; sub-keyed; not fail-open under AUTH_DISABLED.
- **Risk:** PII in detail_json. **Mitigation:** name-whitelist projector + test; bounded retention (Phase 4).
- **Risk:** duplicate chat-stats surface. **Mitigation:** coordinate with chat-turn-profiling plan; don't break existing `/stats`.
