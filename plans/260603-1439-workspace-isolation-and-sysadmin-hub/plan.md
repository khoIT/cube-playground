---
title: "Per-User Isolation + Sys-Admin Hub"
description: "Enforce per-user segment isolation (visibility ladder), add a full activity-telemetry event spine, and a huashu-built tabbed sys-admin hub for fine-grained per-user access control + observability. Built TDD on the already-shipped DB-authz spine."
status: pending
priority: P2
branch: "main"
tags: [authz, multi-user, isolation, admin, telemetry, segments, huashu]
blockedBy: []
blocks: []
created: "2026-06-03T07:56:40.010Z"
createdBy: "ck:plan"
source: skill
mode: tdd
spec: "plans/reports/brainstorm-260603-1439-workspace-isolation-and-sysadmin-hub-report.md"
---

# Per-User Isolation + Sys-Admin Hub

## Overview

After Keycloak/O365 auth landed, make the app properly multi-user. Three sub-projects shipped as ONE phased, TDD feature on top of the **already-shipped** DB-authz spine (`/admin/access`, `admin-access.ts` CRUD, grant matrices, default-deny, migrations 019/020):

- **A — Segment isolation:** enforce the dormant `segments.visibility` column (`personal|shared|org`). The column + unified vocabulary already exist (migration 028, `trust-mapping.ts`); the LIST query just never filters on it. **Enforce + wire, not add.**
- **B — Activity telemetry (full):** one append-only `activity_events` spine + emit points (query-run, segment ops, exports, feature-open, workspace-switch) + a chat-service `/internal/stats` bridge. Incremental rollout: spine + top events first, then widen.
- **C — Sys-admin hub:** tabbed hub extending `/admin/access` (Users & Access · Observability · Dev/Chat-Audit). Centerpiece = a huashu-designed fine-grained per-user control panel (role/status, workspace grants = switch ability, game grants w/ count, feature toggles, activity snapshot). Backend grant API already exists → mostly frontend.

**Spec:** `plans/reports/brainstorm-260603-1439-workspace-isolation-and-sysadmin-hub-report.md` (decisions §3 are user-confirmed — do not re-litigate).

### The cross-cutting landmine (why Phase 1 exists)
Artifacts are written with `owner = req.owner = Keycloak **sub**`, but access grants and the admin UI key on **email**. `email ≠ sub`. Per the unified-concept-fabric drift note, owner-scoping "never matched / was null in dev." Both isolation (A) and telemetry (B) inherit this bug unless the sub↔email mapping is fixed and locked by tests FIRST.

**Canonical map = `user_access.kc_sub` (NOT `users`).** Red-team verified: `users.email` is nullable + unindexed and only exists post-login, so invited-not-yet-logged-in users resolve null — re-creating the very bug. `user_access` is the maintained map (migration 019, `kc_sub` reconciled on login, email is the normalized grant key). **Telemetry keys on `sub` primary** (always present via `req.owner`), email is a display join resolved via `user_access.kc_sub`.

## Build Order

```
Phase 1 (identity + regression lock)  ──┬──> Phase 2 (A: segment visibility)
                                        ├──> Phase 3 (B: event spine) ──> Phase 4 (B: aggregation)
                                        └──> Phase 5 (C: hub shell + huashu) ──> Phase 6 (C: controls) ──> Phase 7 (C: observability + rollout)
```
Phase 2, the Phase-3/4 chain, and the Phase-5→7 chain are parallelizable after Phase 1. Phase 7's Observability tab consumes Phase 3/4 data; Phase 6 consumes only the existing grant API, so C's Users&Access path can progress before B lands.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Identity Foundation & Regression Lock](./phase-01-identity-foundation-regression-lock.md) | Complete |
| 2 | [Segment Visibility Enforcement](./phase-02-segment-visibility-enforcement.md) | Complete |
| 3 | [Activity Event Spine & Chat Bridge](./phase-03-activity-event-spine-chat-bridge.md) | Complete |
| 4 | [Telemetry Aggregation & Inactive Detection](./phase-04-telemetry-aggregation-inactive-detection.md) | Complete |
| 5 | [Admin Hub Shell & Huashu Per-User Panel](./phase-05-admin-hub-shell-huashu-per-user-panel.md) | Complete |
| 6 | [Fine-Grained Per-User Controls](./phase-06-fine-grained-per-user-controls.md) | Pending |
| 7 | [Observability Dashboard & Rollout](./phase-07-observability-dashboard-rollout.md) | Pending |

## Resolved Design Questions (from brainstorm §12 + red-team 2026-06-03)

1. **Cube per-query metrics:** B logs that a query ran + its shape (cubes/measures/dimensions, **names only — no filter values, no UIDs**). Duration/rows deferred — do not block on Cube instrumentation.
2. **`org` visibility setting:** `personal`/`shared` user-settable; `org` admin-only (governance). Matches migration-028 note that `org` is future + needs no access-guard change yet.
3. **Segment visibility = enforce, NULL→`personal` (honor migration 028).** Column exists (028); unified vocab in `trust-mapping.ts`; gap = LIST (`segments.ts:137`) + by-id routes don't filter. **NO backfill migration** — NULL already maps to `personal` (`SEGMENT_DEFAULT_VISIBILITY`). Predicate treats NULL as personal via `COALESCE(visibility,'personal')`. **⚠ Intentional behavior change (user-confirmed):** legacy segments become owner-only — teammates LOSE visibility of segments they currently see (LIST shows all today only because it never filters). The existing `segment-multi-user-scoping.test.ts` (asserts cross-owner delete → 204) encodes the OLD workspace-shared contract and MUST be updated to the new owner-private contract in Phase 2.
4. **Inactive threshold:** 30 days since last login → "inactive" flag (constant, not yet configurable — YAGNI).
5. **Identity (red-team):** canonical sub↔email map = `user_access.kc_sub`, not `users`. Telemetry primary key = `sub`.
6. **Telemetry depth (user-confirmed):** FULL now — Phases 3 + 4 ship together (all event types + aggregator + inactive detection + prune). Not deferred.
7. **huashu (user-confirmed):** FULL hi-fi prototype gate before React work (Phase 5).

## Decisions Locked (do not reverse without user)
Logical isolation (one SQLite, owner-scoped) · **full telemetry now (Phases 3+4 together)** · tabbed hub extending `/admin/access` · segment default `personal`, **legacy NULL→personal (no backfill, accepted visibility loss)** · canonical map `user_access.kc_sub`, telemetry sub-keyed · **full huashu prototype gate** · KC auth-only (no SCIM/no KC admin UI) · binary game access (no Cube row/measure filtering) · metrics multi-user approval flow OUT of scope.

## Dependencies

- **Builds on (completed):** `plans/complete/260530-0219-db-authz-microsoft-sso-admin-page/` (authz spine, admin page), `plans/complete/260527-1539-cube-workspace-switching/` (workspace model), `plans/260603-0324-unified-concept-fabric/` (unified `visibility×trust` ladder — Phase 2 here MUST use its vocabulary, not a parallel model).
- **Soft overlap (unfinished, non-blocking):** `plans/260601-1319-chat-turn-profiling-decompose` (chat observability — coordinate with Phase 3's chat `/internal/stats` bridge to avoid duplicate chat-stat surfaces); `plans/260601-1803-querybuilder-right-pane-redesign` (query-builder UI — Phase 3 query-run emit point may touch the same routes). Verify both before touching shared files.

## Red Team Review

### Session — 2026-06-03
**Reviewers:** 4 (Security Adversary, Failure-Mode Analyst, Assumption Destroyer, Scope & Complexity Critic).
**Findings:** 27 raw → 15 after dedup (6 Critical, 6 High, 3 Medium). 13 accepted, 2 deferred to user (kept as user-confirmed).

| # | Finding | Severity | Disposition | Applied To |
|---|---------|----------|-------------|------------|
| 1 | Canonical map is `user_access.kc_sub`, not `users` (email nullable/post-login) | Critical | Accept | P1, P3, P4 |
| 2 | Chat `/internal/stats` is net-new auth (no gate exists; `/stats` collides; must be sub-keyed) | Critical | Accept | P3, P4 |
| 3 | Phase 2 left `GET /:id`,`/append`,`/refresh`,`/sql-filter`,`/refresh-log` unguarded | Critical | Accept | P2 |
| 4 | Backfill NULL→shared reverses migration-028 verified default | Critical | User decision → **NULL→personal, no backfill** (honor 028; accepted visibility loss) | P2, plan |
| 5 | Existing `segment-multi-user-scoping.test.ts` encodes opposite contract | High | Accept | P1, P2 |
| 6 | Regression lock is circular (Phase 1 writes what Phase 2 rewrites) | High | Accept (pin invariants) | P1 |
| 7 | `AUTH_DISABLED` prod-leak surface expands (fail-open `/internal/access`, synth email) | High | Accept | P1, P3 |
| 8 | `detail_json` may capture filter values / `uid_list` | High | Accept (name-whitelist) | P3, P7 |
| 9 | Phase 6 ~70% rebuild of shipped `AccessEditor`; no cache layer to "invalidate" | High | Accept (reframe to enhance) | P6 |
| 10 | Phase 5 should generalize existing tab shell; DevAudit uses legacy `T` not tokens | High | Accept (+ token-migrate task) | P5 |
| 11 | `admin-activity` won't inherit `admin-access` Fastify guards (encapsulation) | Medium | Accept | P4 |
| 12 | Telemetry depth exceeds researcher v1 scope | Medium | User decision → **keep full now** (Phases 3+4) | — |
| 13 | huashu full gate vs reskin overkill | Medium | User decision → **keep full gate** | — |
| 14 | Dev-principal machinery may be redundant (`X-Owner` override exists) | Medium | Accept (verify-first) | P1 |
| 15 | Emit can poison caller txn / swallow disk errors at debug | High | Accept (outside txn, WARN on disk error) | P3 |

### Whole-Plan Consistency Sweep
- Decision delta applied everywhere: **identity → `user_access.kc_sub`, telemetry → `sub`-primary** (plan Overview/§5, P1, P3, P4); **segments NULL→personal, NO backfill** (plan §3, P2 — removed all "backfill→shared" / "vanish trap mitigated by backfill" language; predicate now `COALESCE(visibility,'personal')`); **chat seam = net-new gate, sub-keyed** (P3/P4 — removed "mirror existing" framing); **all by-id segment routes guarded** (P2); **full telemetry + full huashu retained** (no scope cut).
- Verified no stale references remain: searched for "backfill", "actor_email primary", "mirror existing", "NULL→shared" — reconciled. P2 effort/migration section no longer adds a migration; P6 effort reduced 3-4d→2d to match reframe.
- No unresolved contradictions remain. Plan is internally consistent and ready for implementation.

