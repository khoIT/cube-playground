# Merge Monitor + Movement, add Snapshot history

Fold the BETA **Movement** tab into **Monitor** as one single-scroll "Now → Over time"
surface, reconcile the two cadence knobs + the view-grain control, add a per-segment
**Snapshot ledger**, and ship a phase-2 cross-segment **Snapshot coverage** fleet page.

Driven by the design pick: one-scroll layout, per-segment ledger now + fleet later.
Visuals: `visuals/merged-monitor-full.html`, `visuals/merged-monitor-degraded.html`,
`visuals/snapshot-fleet-overview.html`.

## Why
- Monitor (all segments) = operational *now*; Movement (predicate+game, BETA) = historic
  *over time*. Same question ("how is this segment doing"), two data layers (SQLite refresh
  log vs lakehouse snapshots), two tabs, two cadence controls → confusing. Merge resolves it.
- "View all historic snapshots + which grain is available, per segment" needs both a
  per-segment ledger (extends the coverage strip already shipped) and a fleet overview.

## Key reconciliations (the hard part)
- **One cadence, not two:** `refresh_cadence_min` (recompute) + `snapshot_cadence` (capture)
  collapse into a single **`track_cadence`** — one job computes membership once per tick and
  fans out to SQLite (live list) + lakehouse (state+KPI history). Removes the two-knob
  confusion AND the dual-query. *View grain* (display downsample) stays in the header,
  separate. (User picked the true merge; cost now scales with the chosen cadence.)
- **De-dupe overlapping cards:** lakehouse trends (Trajectory / MembershipMovement / KPI)
  are primary when snapshots exist; SQLite SizeTrend + MetricMovementCard become the
  fallback path for snapshot-less segments. No double-rendering of "size over time".
- **No Activation section** on this tab (dropped per decision).
- **Graceful degrade:** non-predicate / no-game segments keep NOW + refresh history; the
  single Track knob does recompute-only; strip/trends/ledger collapse to one empty-state
  card. Monitor stays the default tab for ALL segments.

## Phases
| # | Phase | Status | Notes |
|---|-------|--------|-------|
| 1 | [Unify recompute+capture into one Track cadence](phase-01-unify-track-cadence.md) | done | Control-plane merge: `track_cadence` source-of-truth + derive/dual-write legacy cols; +30m; migration 065 applied; control built (mounts in P2) |
| 2 | [Single-scroll merge + retire Movement tab](phase-02-single-scroll-merge.md) | pending | Now→Over time zones; fold Movement sections; de-dupe; no activation; `?tab=movement` redirect; degrade |
| 3 | [Per-segment snapshot ledger](phase-03-snapshot-ledger.md) | pending | `readSnapshotLedger` endpoint + collapsible ledger table (ts·grain·members·kpis) |
| 4 | [Fleet "Snapshot coverage" page](phase-04-fleet-snapshot-coverage.md) | pending | Phased follow-up: cross-segment availability endpoint + new top-level page + nav |

## Dependencies
- Phases 1→2 sequential (2 consumes the single Track control + degrade behaviour). 3 builds
  on 2's merged shell. 4 is independent of 1–3 (own page), reads `track_cadence` from P1 +
  reuses the captureEras/availability helpers.
- Backend reuses: `computeCaptureEras` / `finestEraCadence` / `grain-availability.ts` (shipped),
  `readCaptureTimestamps`, `segment_kpi_daily` / `segment_membership_*` lakehouse tables.

## Non-goals (this round)
- "View this snapshot" frozen-snapshot detail view (ledger row → modal/deep-link) — define
  target surface separately; ledger rows link-out is a stub in phase 3.
- Changing snapshot WRITE cadence/scheduling. Changing Monitor's non-snapshot sections
  (refresh history, activation) beyond relayout.
