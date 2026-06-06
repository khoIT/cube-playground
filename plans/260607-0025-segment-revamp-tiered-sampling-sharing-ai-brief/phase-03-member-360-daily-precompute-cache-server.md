---
phase: 3
title: Member-360 daily precompute cache (server)
status: completed
priority: P1
effort: 2d
dependencies:
  - 1
---

# Phase 3: Member-360 daily precompute cache (server)

## Overview
Nightly job precomputes the member-360 **core (eager) panels** for each segment's 150 tiered
members and stores rows in a new cache table. User-locked scope: core panels only, all eligible
segments, recalc once per day. Lazy behavior panels are explicitly out (stay live-on-expand).

## Requirements
- Functional: per (segment, uid, panel) cached Cube rows + status; daily recompute; invalidation
  when tier membership changes; eligible = segment has `member_tiers_json` AND game has a
  member-360 registry entry.
- Non-functional: must not wedge dev cube-api (memory: pace probes) — bounded concurrency,
  per-segment budget, nightly window, skip-if-unchanged writes.

## Architecture
- **Panel registry sharing — red-team M1 verified the cross-import is structurally blocked**
  (`server/tsconfig.json` has `rootDir: "src"` scoped to `server/src`; registry transitively
  imports FE deps — `FormatId` from `../presets/types`, `Query` from `@cubejs-client/core`).
  **Primary approach is therefore copy + parity test**: server-local
  `server/src/services/member360-panel-registry.ts` + copied pure
  `build-panel-query` logic, with FE-only types inlined as minimal local types (no
  `@cubejs-client/core` import). Mandatory parity unit test JSON-compares the server registry
  against the FE registry fixture so drift fails CI (precedent: registry ⊆ BEHAVIOR_VIEWS test
  from plan 260605-1200). Core-panel selection is deterministic: the registry already encodes
  `section: 'core' | 'behavior'` (`member360-panels.ts:48`).
- **Cache table** (migration `033-member360-cache.sql`):
  `segment_member360_cache(segment_id TEXT, uid TEXT, panel_id TEXT, query_hash TEXT,
   rows_json TEXT, fetched_at DATETIME, status TEXT, error TEXT,
   PRIMARY KEY (segment_id, uid, panel_id))` + index on `(segment_id, fetched_at)`.
- **Runner** `server/src/services/member360-runner.ts` (card-runner as template):
  - Work unit = one (uid, panel) query, built via the copied `buildPanelQuery`, physicalized
    via `physicalizeQuery`. **Identity filter comes from `panel.identityKey`** exactly like
    the FE (`build-panel-query.ts:51`) — NOT a blanket `identityDim = uid`; login/logout
    panels key `clientsdkuserid`, not `user_id` (red-team M4). Add the
    "clientsdkuserid = user_id direct" equality to Phase 1's manual Cube verification step.
  - Core (`section: 'core'`) panels only.
  - Concurrency 3, per-query timeout 30s, **per-segment budget 8 min**, abort-and-resume-next-
    night on budget hit (persist partial; status per row).
  - Skip-if-unchanged: reuse `query_hash` + rows-hash compare from `card-cache-store.ts` pattern.
- **Scheduling** (`cron-runner.ts`): new daily pass `listDueMember360Segments` — due when
  `member360_last_run_at` (new column on segments, same 033 migration) is NULL or < today's
  04:00 GMT+7 window start, AND now is inside the nightly window (default 02:00–06:00 GMT+7,
  env `MEMBER360_PRECOMPUTE_WINDOW`). Process segments serially (one at a time globally) to cap
  Cube load. Manual trigger endpoint `POST /api/segments/:id/precompute-members` (guarded,
  rate-limited 1/10min/segment) for dev/testing and "compute now" affordance.
- **Invalidation**: on refresh, after tiers change, delete cache rows whose uid is no longer in
  any tier (prune query); changed uids refill next nightly run (or manual trigger).

## Related Code Files
- Create: `server/src/db/migrations/033-member360-cache.sql`
- Create: `server/src/services/member360-runner.ts`
- Create: `server/src/services/member360-cache-store.ts`
- Modify: `server/src/jobs/cron-runner.ts` (daily pass), `server/src/jobs/refresh-segment.ts`
  (prune on tier change)
- Modify: `server/src/routes/segments.ts` (manual trigger endpoint)
- Create: `server/src/services/member360-panel-registry.ts` (copy of FE registry data +
  pure query builder, FE deps inlined) + parity test vs FE registry

## Implementation Steps
1. Server registry copy + parity test (import path verified blocked — see Architecture).
2. Migration 033 (cache table + `member360_last_run_at` column).
3. `member360-cache-store.ts`: upsert-if-changed, get-by-segment-uid, prune-by-segment.
4. `member360-runner.ts`: budgeted pump (template `card-runner.ts:143-201`), status/error rows.
5. Cron daily pass + window/env parsing + serial segment processing + structured log line per
   segment (counts: ok/error/skipped/elapsed).
6. Manual trigger route.
7. Tests: store upsert/prune; runner budget abort; window gating; eligibility filter; physical-
   ization on prefix workspace; refresh-prune integration.

## Success Criteria
- [x] Nightly run fills cache for an eligible segment: 150 uids × core panels, statuses ok
      (unit-verified with mocked Cube; live happy path infra-blocked — see notes)
- [x] Per-segment budget abort leaves partial cache + correct statuses, resumes next window
- [x] Re-run with unchanged data writes nothing (hash skip)
- [x] Tier change prunes stale uids' rows only
- [x] Ineligible segments (no tiers / no registry game) untouched (no Cube load, no cache
      writes; last_run_at IS stamped so the due-list re-qualifies next window, not per-tick)

## Verification notes (260607)
- Built as: registry copy `member360-panel-registry.ts` (core panels only — behavior panels
  never precomputed) + builder copy `member360-panel-query.ts`; parity test deep-compares both
  against the FE sources per game and per panel (incl. clientsdkuserid identity-key case).
- Tests: 42 new (parity 5, store 6, runner 9+2 helpers, scheduler 9, refresh-prune integration 1
  + pre-existing). Full server suite 122 files / 868 tests green under nvm node v24.11.1.
- Live verified: migration 033 applied; manual trigger 202 → 429 (retry-after) on repeat;
  **the real nightly cron pass fired in-window (02:35 GMT+7)** and serially drained all 3
  eligible dev segments, persisting 2,624 per-row statuses + last_run_at stamps. All rows were
  status=error because the :4000 SSH tunnel to remote cube-dev was down/flaky at the time —
  infra, not code (single probe queries succeeded when the tunnel was up; error rows self-heal
  next window via the status-flip write rule). Happy-path fill is unit-verified.
- Code review DONE_WITH_CONCERNS → applied: stamp last_run_at on ALL terminal outcomes
  (tiered-but-no-registry games are reachable — mf_users preset tiers every game).
- Deferred (review M-4, tracking only): FE `build-panel-query.ts` filters behavior panels on
  `<view>.log_date` while their timeDimension is `<view>.dteventtime` — pre-existing FE
  divergence copied verbatim for parity; harmless (behavior panels not precomputed); fix
  belongs FE-side if a behavior panel ever becomes core.
- Deferred (review M-3): manual-trigger cooldown Map is process-lifetime; bounded by segment
  count in practice.

## Risk Assessment
- **Cube load**: worst case ~1,350 queries/segment. Serial segments + concurrency 3 + nightly
  window bounds it; budget abort guarantees an upper bound per night. If real-world cost still
  too high, drop to top-tier-only precompute (config flag) — decision logged, not silent.
- **Registry drift** (copy path): parity test fails CI on drift — explicit, not silent.
- **SQLite write volume**: 150×9 rows/segment ≈ 1.3k rows — trivial for better-sqlite3.
- **Server restart mid-run**: in-process cron aborts the current segment; per-row statuses are
  already persisted and `member360_last_run_at` gating re-qualifies it next window — no
  corruption, just delayed completion (same posture as card-runner).
