---
phase: 4
title: "Telemetry Aggregation & Inactive Detection"
status: complete
priority: P2
effort: "2-3d"
dependencies: [3]
---

# Phase 4: Telemetry Aggregation & Inactive Detection (Sub-project B, complete)

## Overview
Widen telemetry to the remaining event types, add the admin aggregation API that fuses main-DB activity + chat-service stats into per-user + org rollups, add inactive-user detection, and add the retention prune job. This is the data layer the Observability tab (Phase 7) renders.

## Requirements
- Functional:
  - Remaining emit points: **export** (chart/query export) + **workspace-switch**.
  - Admin aggregation endpoints (under `/api/admin`, `requireRole('admin')` + `requireFeature('admin')`):
    - `GET /api/admin/activity/summary` → org rollup: total users by status, active-last-7/30d, inactive list, total chats, top features.
    - `GET /api/admin/activity/users/:email` → per-user: last login, session/turn counts (via chat `/internal/stats`), recent features used, recent query shapes, segment counts.
  - **Inactive detection:** user with `last_login` older than 30d (Q4) flagged `inactive` in summary.
  - Retention prune job: delete `activity_events` older than 90d (cron, mirror `refresh-dashboard-tiles` job pattern).
- Non-functional: aggregation queries time-range-indexed; admin API fans out to chat `/internal/stats` with a timeout + graceful degradation (chat down → counts shown as null, not a 500).

## Architecture
- `activity-aggregator.ts`: composes `activity_events` rollups grouped by **`actor_sub`** (joined to `user_access`/`users` for email + last_login display) + chat `/internal/stats` (bulk, **by `sub[]`**). Resolve the user list's emails→subs via `user_access.kc_sub` (Phase 1) before the chat call — chat keys on sub, NOT email (red-team F7/C2).
- Bulk chat-stats (one round-trip for the user list) to avoid N+1.
- **Fastify guard encapsulation (red-team M2):** `admin-activity` routes will NOT inherit `admin-access.ts`'s router-scoped `addHook` preHandlers. Either register `admin-activity` inside the same encapsulated scope, or re-declare `requireRole('admin')+requireFeature('admin')` on it. Test that an unauthenticated/non-admin request 403s.
- Chat call: explicit **timeout value (e.g. 2s)**; degrade on BOTH error AND slow (timeout) → null counts, never a hanging admin request (red-team F7).
- Inactive threshold = exported constant `INACTIVE_DAYS = 30` (not env yet — YAGNI).
- Prune job registered alongside existing jobs; logs rows pruned (no silent truncation). Single-instance runner — acceptable contention with reads (note, don't over-engineer locking).

## Related Code Files
- Create: `server/src/services/activity-aggregator.ts` (+ test), `server/src/routes/admin-activity.ts` (+ test), `server/src/jobs/prune-activity-events.ts` (+ test)
- Modify: `server/src/routes/admin-access.ts` or app route registration (mount `admin-activity` under same guards), export/workspace-switch emit points
- Read: `server/src/jobs/refresh-dashboard-tiles.ts` (job pattern), Phase 3 `activity-store.ts`, chat `/internal/stats`

## TDD: Tests First
1. `activity-aggregator.test.ts`: org summary (by status, active-7/30d, inactive) grouped by sub from seeded events; per-user shape; **email→sub resolution feeds the chat call** (assert it queries chat by sub, not email); chat-down/slow → null counts (no throw, no hang).
2. `admin-activity.test.ts`: routes 403 for non-admin/unauthenticated (**verify guards actually apply on the separate plugin** — encapsulation); summary + per-user payload shapes; bulk chat fan-out mocked.
3. `prune-activity-events.test.ts`: deletes >90d, keeps ≤90d, logs count.
4. Run → red → implement → green.

## Implementation Steps
1. Write aggregator + route + prune tests (tests-first).
2. Wire export + workspace-switch emit points.
3. Implement `activity-aggregator` (main DB rollups + bulk chat stats + graceful degradation).
4. Implement `admin-activity` routes under existing admin guards.
5. Implement + register prune job (90d).
6. Full suites green.

## Success Criteria
- [x] `/api/admin/activity/summary` returns org rollup incl. inactive list (>30d). — `activity-aggregator.ts` + `admin-activity.ts`.
- [x] `/api/admin/activity/users/:email` returns per-user activity fusing main + chat stats. — `buildUserActivity`; 404 on unknown user.
- [x] All emit points (8 event types) live; chat-down degrades gracefully (null, not 500). — export + workspace_switch via generalized `POST /api/activity`; `chat-stats-client` timeout/error → null (unit-tested).
- [x] 90d prune job runs + logs pruned count. — `prune-activity-events.ts`, registered in `index.ts`.
- [x] Routes admin-gated (guards verified to apply on the separate plugin); full suites green. — own `requireRole+requireFeature` hooks; 401/403/200 tested.

## Completion Notes (2026-06-03)
- Built TDD; server tsc 0; server suite 678 pass / 4 pre-existing (internal-access-route, unrelated). FE tsc unchanged (0 new).
- Generalized the Phase-3 beacon to `POST /api/activity` with a CLIENT_EMITTABLE allowlist {feature_open, export, workspace_switch}; `query_run`/`segment_op` remain server-only (unspoofable, tested).
- email→sub resolved via `user_access.kc_sub` before the bulk chat call; chat unreachable → null counts (never silent zero / false-inactive).
- Code review: DONE, no blockers. Addressed: added `chat-stats-client.test.ts` (timeout/error/non-200/missing-secret → null) + guarded `JSON.parse` of query-shape detail. Deferred (non-blocking): single `WHERE owner_id IN(...)` bulk query + `subs[]` cap when the Phase-5 hub wires a large caller; "inactive" is login-based per spec Q4 (Phase-7 UI should label it "last login >30d").

## Risk Assessment
- **Risk:** N+1 to chat-service. **Mitigation:** bulk sub-keyed endpoint; single fan-out.
- **Risk:** email→sub gap → silent zero chat counts → false "inactive" → admin disables active user. **Mitigation:** resolve via `user_access.kc_sub` before call; tested.
- **Risk:** chat-service slow/down hangs or 500s admin page. **Mitigation:** explicit timeout (~2s) + degrade-on-slow-or-error to null, tested.
- **Risk:** guards don't inherit on separate plugin (Fastify encapsulation). **Mitigation:** register in-scope or re-declare; 403 test.
- **Risk:** prune deletes too much. **Mitigation:** boundary test + logged count.
