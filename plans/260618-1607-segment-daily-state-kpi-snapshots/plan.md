---
title: Segment per-segment-cadence state + canonical KPI snapshots
description: >-
  Extend the segment-membership snapshot from daily uid-only to
  per-segment-cadence (15m–daily) capture of per-user canonical state + a
  segment KPI time-series, then serve + visualize movement on a huashu-designed
  monitor view.
status: pending
priority: P2
branch: main
tags:
  - segments
  - lakehouse
  - snapshot
  - kpi
  - liveops
  - cadence
blockedBy: []
blocks: []
created: '2026-06-18T09:19:44.232Z'
createdBy: 'ck:plan'
source: skill
---

# Segment per-segment-cadence state + canonical KPI snapshots

## Overview

Today the nightly job snapshots **only uids** per segment, **once per calendar
day**, into Iceberg (`segment_membership_daily` / `_delta` / `_definition_daily`).
To track *data movement* inside a segment we add three things:

1. **Per-user state** (`segment_member_state_daily`) — per snapshot, one row per
   (segment, uid) carrying a **canonical metric set** (`mf_users` feature store +
   member-column fields + Insights-tab metrics). Distributions (lifecycle, payer
   tier, churn risk, country, OS) derive from this via GROUP BY.
2. **Segment KPI time-series** (`segment_kpi_daily`) — the segment-level KPIs the
   Insights tab + headline strip already compute via `card-runner`, persisted as a
   time-series. They span `mf_users`/`recharge`/`etl_game_detail` and include
   non-additive ratios (`paying_rate_30d`, `arppu_vnd`, `whales_count`) that cannot
   be derived from per-user state — so they reuse `card-runner`.
3. **Per-segment capture cadence** — each segment carries a `snapshot_cadence`
   (`15m|1h|3h|6h|12h|daily`, **default `daily`**). All snapshot tables gain a
   `snapshot_ts TIMESTAMP`; the job materializes a segment only when its cadence
   bucket has elapsed. Only opted-in (test) segments run sub-daily.

Then a tokenless **read API** and a **huashu-designed** Segments *Movement* monitor
view expose day-over-day (and intraday) movement, with a view-time granularity
toggle.

### Locked decisions (user, 2026-06-18)

- **State scope:** segment members only (per segment, per snapshot — not game-wide).
- **Serve layer:** full vertical — lakehouse tables + read API + UI monitor view.
- **Metric set:** full `mf_users` feature set **plus any metric currently rendered**
  in the segment Insights tab / KPI cards (enumerated in Phase 1).
- **Cadence:** **per-segment configurable** capture cadence (`15m|1h|3h|6h|12h|daily`),
  **default `daily`**; only opted-in segments run sub-daily.
- **Sub-daily scope:** **everything** (state + KPIs + membership/delta) runs at the
  segment's cadence; defaults keep every segment daily.
- **UI:** revamp the segment **monitor view** with **huashu-design** (hi-fi HTML
  variants first → user picks/mixes → React), including these metrics + a view-time
  granularity toggle (`15m|1h|3h|6h|12h|daily`).

### Key architectural choices

- **Capture cadence (backend) ≠ view granularity (frontend).** Backend captures at
  each segment's `snapshot_cadence`; the monitor view's granularity toggle is a
  **view-time downsample** over captured points (e.g. a 1h-captured segment can show
  1h/3h/6h/12h/daily; 15m requires 15m capture enabled). The toggle is bounded by
  the segment's capture cadence.
- **`snapshot_ts` threaded through every snapshot table** (incl. the existing
  membership + delta). `snapshot_date` retained for partition pruning. Idempotence
  key becomes `(snapshot_ts, game, segment[, uid])`, `snapshot_ts` floored to the
  cadence bucket.
- **Per-segment state keying** (NOT cross-segment dedup). Per-segment cadence makes a
  global per-uid dedup ambiguous (a uid in a daily + a 1h segment), so state is keyed
  `(snapshot_ts, game, segment, uid)`. A uid in N segments → N rows/snapshot.
  Acceptable: only a few test segments go sub-daily; daily segments stay 1 row/day.
- **Predicate-free `mf_users` projection JOINed in Trino** — avoids per-segment Cube
  join-rooting. Compile the `mf_users` projection **once per (game, snapshot_ts)** and
  reuse it across that game's segments firing at that tick, JOINing each segment's
  membership. Reuses the proven cross-catalog `INSERT…SELECT`.
- **As-of-snapshot semantics** — trailing/windowed metrics (`ltv_30d`,
  `paying_users_30d`) captured at their as-of-`snapshot_ts` value; history is built
  forward, never backfilled. Documented invariant.
- **Reuse over rebuild** — extend `snapshot-segment-membership.ts`, reuse
  `card-runner`, `cube-member-resolver`, `resolve-identity-field`, member-column
  pruning, the lakehouse connector, and the care-cache serve-stale pattern.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Canonical metric registry](./phase-01-canonical-metric-registry.md) | Completed |
| 2 | [Per-segment cadence + timestamping](./phase-02-per-segment-cadence-and-timestamping.md) | Completed |
| 3 | [Lakehouse + SQLite schema](./phase-03-lakehouse-sqlite-schema.md) | Completed |
| 4 | [Per-user state writer](./phase-04-per-user-state-writer.md) | Completed |
| 5 | [Segment KPI time-series writer](./phase-05-segment-kpi-timeseries-writer.md) | Completed |
| 6 | [Movement read API](./phase-06-movement-read-api.md) | Completed |
| 7 | [Movement monitor UI (huashu)](./phase-07-movement-monitor-ui-huashu.md) | Completed (capture-cadence write control deferred) |
| 8 | [Tests + docs](./phase-08-tests-docs.md) | Pending |

## Dependencies

- Builds on the **completed** `260615-0252-segment-care-cache-precompute` (serve-stale
  + precompute scheduler patterns) and `260616-1036-snapshot-tz-autorun-preagg-autobuild`
  (GMT+7 window + `SEGMENT_SNAPSHOT_ENABLED` gate). Both shipped — no blocking dep.
- Phase order: 1 → 2 → 3 → (4, 5) → 6 → 7 → 8. Phase 2 is foundational (cadence/ts
  model used by every writer); land it before the schema + writers.

## Reference inventory (verified file:line)

- Daily job: `server/src/jobs/snapshot-segment-membership.ts` — `TICK_INTERVAL_MS = 3_600_000`
  (hourly tick), GMT+7 `[8,24)` window, daily-date idempotence heartbeat,
  `SEGMENT_SNAPSHOT_ENABLED`, `triggerManualSnapshot()`.
- Membership writer: `server/src/lakehouse/segment-snapshot-writer.ts:93` (compile
  segment query → `/sql` → cross-catalog `INSERT…SELECT`, `stripTrailingLimit`,
  `extractCompiledSql`).
- Delta writer: `server/src/lakehouse/segment-delta-writer.ts:41` (D vs D-1).
- DDL: `server/src/lakehouse/segment-membership-ddl.ts:18`; connector/schema helpers:
  `server/src/lakehouse/lakehouse-trino-connector.js`; params: `inline-sql-params.ts`.
- KPI/card compute: `server/src/services/card-runner.ts` (`queryForKpi`); cache table
  `segment_card_cache` (migration 051).
- Member runner + pruning: `server/src/services/member-profile-runner.ts`; rank:
  `server/src/services/segment-rank-measure.ts`.
- Resolver: `server/src/services/cube-member-resolver.ts`; identity:
  `server/src/services/resolve-identity-field.ts`.
- Preset bundles: `server/src/presets/bundles/{mf-users-hub,recharge-events,etl-game-detail}.yml`.
- Segment schema: `server/src/db/migrations/001-init.sql` (`segments`); game-scoping 004;
  member-profiles 046; snapshot-log 048. Highest migration **062**; next **063**.
- Segment detail UI + tabs: `src/pages/Segments/detail/` (headline-stats-row, preset-tab);
  chart reuse `AssistantChartSection`; header refs `src/pages/Liveops/cohort/index.tsx`,
  `src/pages/Dashboards/index.tsx`; tokens `src/theme/tokens.css`; `docs/design-guidelines.md`.
- Members pull API + redaction: `server/src/routes/segments.ts:500`.

## Open questions

1. **15m base tick.** The job ticks hourly today. 15m capture needs the base tick ≤15m
   (Phase 2 sets it to 15m with a cheap per-segment elapsed-check; daily segments just
   fail the check 95/96 ticks). Confirm a 15m base tick is acceptable for the single
   snapshot instance.
2. **Sub-daily inside the GMT+7 [8,24) window only?** Intraday capture currently
   inherits the 08:00–24:00 window (no 00:00–08:00 snapshots). Keep, or run 24h for
   sub-daily test segments? Plan default: keep the window.
3. **Non-mf_users composition trends** (revenue-by-payment-channel, game-mode) are not
   derivable from per-user state; deferred for v1 (distribution trends cover the
   captured mf_users dims only).
4. **Retention/pruning** of sub-daily partitions (heaviest at 15m) — keep all vs prune
   beyond N days. Default: keep all; revisit if cost bites.
