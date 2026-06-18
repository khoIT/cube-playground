---
phase: 2
title: Per-segment cadence + timestamping
status: completed
priority: P1
effort: 1d
dependencies:
  - 1
---

# Phase 2: Per-segment cadence + timestamping

## Overview

Foundational change every writer depends on: give each segment a `snapshot_cadence`
(default `daily`), thread a `snapshot_ts` through the snapshot system, and generalize
the job from "act once per calendar day" to "materialize each segment when its
cadence bucket has elapsed". This phase touches config, the segments table, the job
tick/idempotence, and the **existing** membership + delta writers (snapshot_ts).

## Requirements

- Functional: per-segment `snapshot_cadence ∈ {15m,1h,3h,6h,12h,daily}`, default `daily`.
- Functional: a `snapshot_ts TIMESTAMP` (floored to the cadence bucket) identifies each
  snapshot; idempotence key `(snapshot_ts, game, segment[, uid])`.
- Functional: base tick ≤15m; per-segment elapsed-check decides whether to materialize
  this tick. Daily segments fire once/day (cheap check otherwise).
- Functional: membership + delta become snapshot_ts-aware (additive — existing daily
  rows treated as `snapshot_ts = date 00:00`).
- Non-functional: keep the GMT+7 `[8,24)` window (plan Open Q2). Manual trigger still
  bypasses window + cadence (forces an immediate snapshot of all eligible segments).

## Architecture

### Config / schema

- Migration `063-segment-snapshot-cadence.sql`:
  `ALTER TABLE segments ADD COLUMN snapshot_cadence TEXT NOT NULL DEFAULT 'daily'`
  (CHECK in `{15m,1h,3h,6h,12h,daily}`).
- Cadence helper `server/src/services/snapshot-cadence.ts`:
  - `CADENCE_MS = { '15m':9e5, '1h':3.6e6, '3h':…, '12h':…, 'daily':864e5 }`.
  - `floorToCadenceBucket(nowMs, cadence): string` → ISO `YYYY-MM-DD HH:MM:00` (the
    canonical `snapshot_ts`). Daily → `… 00:00:00` (or the run-time anchor — pick midnight
    GMT+7 for stable daily keys).
  - `cadenceElapsed(lastTs, nowMs, cadence): boolean`.

### Job changes (`snapshot-segment-membership.ts`)

- `TICK_INTERVAL_MS`: 3_600_000 → **900_000** (15m). (Plan Open Q1.)
- Replace the per-calendar-date heartbeat guard with a **per-(segment, snapshot_ts)**
  guard: a segment is materialized this tick iff `cadenceElapsed(lastSnapshotTs, now,
  segment.snapshot_cadence)` and `snapshot_ts` bucket not already logged.
- Keep GMT+7 window guard + `SEGMENT_SNAPSHOT_ENABLED`. Window still gates sub-daily ticks.
- The eligible-segment list now carries each segment's cadence + computed `snapshot_ts`.

### Timestamping the existing tables

- Membership/delta/definition DDL gains `snapshot_ts TIMESTAMP` (Phase 3 owns the DDL
  edits; this phase defines the contract). Partition stays `(snapshot_date, game, segment)`;
  `snapshot_ts` is a sort/cluster + filter column.
- Membership writer: idempotent slice DELETE keys on `snapshot_ts` (not just date).
- Delta writer: "previous" = the segment's `max(snapshot_ts) < current` (was D-1 day).
  Generalize `segment-delta-writer.ts` to diff consecutive snapshots **per segment**.

## Related Code Files

- Create: `server/src/db/migrations/063-segment-snapshot-cadence.sql`,
  `server/src/services/snapshot-cadence.ts`.
- Modify: `server/src/jobs/snapshot-segment-membership.ts` (tick interval + per-segment
  cadence guard + snapshot_ts), `server/src/lakehouse/segment-snapshot-writer.ts`
  (snapshot_ts in slice key + INSERT), `server/src/lakehouse/segment-delta-writer.ts`
  (previous-snapshot per segment), segment read model (expose `snapshot_cadence`).
- Read: Phase 1 module; `segment_snapshot_log` (048) for the per-ts heartbeat.

## Implementation Steps

1. Migration 063 + load `snapshot_cadence` into the segment model/types (default daily).
2. Implement `snapshot-cadence.ts` (pure → unit-testable).
3. Rework the job guard: per-segment elapsed-check + `snapshot_ts` bucket; tick → 15m;
   keep window + enable gate; manual trigger forces all eligible.
4. Thread `snapshot_ts` into the membership writer slice key + INSERT column.
5. Generalize the delta writer to "previous snapshot per segment".
6. Backfill-safe: treat pre-existing daily rows as `snapshot_ts = snapshot_date 00:00`.

## Success Criteria

- [ ] A segment set to `1h` materializes ~hourly; a `daily` segment once/day; default is `daily`.
- [ ] `snapshot_ts` floored to the cadence bucket; re-run within the same bucket is a no-op.
- [ ] Membership delta diffs consecutive per-segment snapshots (intraday entered/exited works).
- [ ] 15m base tick does not run daily segments more than once/day.
- [ ] Manual trigger snapshots all eligible segments immediately regardless of window/cadence.
- [ ] `snapshot-cadence.ts` unit tests pass; `npm run server:build` clean.

## Risk Assessment

- **15m tick load when many segments sub-daily** → each tick is a cheap elapsed-check;
  only opted-in segments do work. Document the load model; single snapshot instance.
- **Daily key stability** → floor daily to GMT+7 midnight so a daily snapshot has one
  deterministic `snapshot_ts` regardless of which tick fires it.
- **Delta correctness across cadence change** → "previous per segment" handles a segment
  switching cadence (diffs against its actual last snapshot, whatever the gap).
- **Modifying shipped membership tables** → additive `snapshot_ts` only; existing rows
  mapped to midnight; no destructive migration.
