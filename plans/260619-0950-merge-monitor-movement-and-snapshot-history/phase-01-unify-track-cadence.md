---
phase: 1
title: "Unify recompute + capture into one Track cadence"
status: in-progress
priority: P1
effort: "1d"
dependencies: []
---

# Phase 1: Unify recompute + capture into one Track cadence

## Overview
Collapse the two per-segment cadence knobs (`refresh_cadence_min` recompute +
`snapshot_cadence` capture) into ONE operator-facing **`track_cadence`**. One "Track
every" control replaces the two-knob panel. Both existing schedulers stay slaved to the
single field via backend derivation — no job rewrite.

## Corrected premise (verified against the code)
The original plan assumed one job could "compute membership once per tick and fan out to
both stores." **That is false against the implementation:**
- Recompute (`refreshSegment`) pulls ranked rows via Cube **REST into the app** → writes
  **SQLite** (live list + tiers/profiles). No lakehouse write.
- Capture (`writeSegmentSnapshot`) compiles the predicate via Cube **/sql** → runs a
  cross-catalog **`INSERT…SELECT` entirely in Trino** → Iceberg. Rows never touch the app
  (deliberate: scales to huge cohorts). Plus extra state + KPI queries.

There is **no shared in-memory row set** to fan out — different engines, different stores,
different consumers. They share only the predicate *definition* (`cube_query_json`), which
both already read. So the achievable + valuable merge is the **control plane**, not the
compute: one cadence field drives both schedules at the same frequency. (Confirmed:
`refresh-segment.ts` imports zero lakehouse writers.)

## Why this is the right merge (not just a veneer)
- One source-of-truth field + one knob → kills the two-knob confusion (the actual pain).
- Both jobs run at the SAME frequency → live list and history stop drifting by ~23h
  (was: hourly live vs daily snapshot). Max offset shrinks to <1 bucket.
- The two data stores stay separate **on purpose** — SQLite live list must stay cheap
  (Members tab / size / experiments); Iceberg history must stay append-only (trends).
  Collapsing them would force app-side shipping of full cohorts = pessimization.

## Requirements
- Functional: single `track_cadence` field (enum `Off|15m|30m|1h|3h|6h|12h|daily`). The UI
  reads/writes ONLY this. On PATCH, backend **derives + dual-writes** the legacy columns so
  both existing crons follow one source of truth:
  - `refresh_cadence_min := CADENCE_MS[track]/60000` (`Off` → `null` = no auto recompute).
  - `snapshot_cadence := track` when `track` is a snapshot-enum; `Off` leaves capture idle.
- `Off` = on-demand only (matches today's `refresh_cadence_min IS NULL` segments).
- Migration is **additive — zero behavior change at deploy**: add the column, backfill
  `track_cadence` to a cost-safe display value; do NOT touch `refresh_cadence_min` /
  `snapshot_cadence`. Unification takes effect per-segment the next time the operator sets
  the knob (or via a later opt-in "apply to all").
- Non-functional: preserve serve-stale + `SEGMENT_SNAPSHOT_ENABLED` gate + header pill.

## Architecture
- **Schema (migration 065, additive):** `ALTER TABLE segments ADD COLUMN track_cadence TEXT`.
  Backfill **cost-safe** (operator-confirmed): `track_cadence = snapshot_cadence` for
  eligible (predicate+game) rows; for manual/no-game rows derive from `refresh_cadence_min`
  → nearest enum, capped `daily` (null → `Off`). No CHECK constraint — enum enforced in
  `snapshot-cadence.ts` + the PATCH validator (matches the 063 precedent). Keep both legacy
  columns; the two crons keep reading them, now fed from `track_cadence`.
- **No scheduler rewrite, no job merge.** `cron-runner.listDueSegments` (age-based on
  `refresh_cadence_min`) and `snapshot-segment-membership` (bucket on `snapshot_cadence`)
  are unchanged. They become consumers of the derived columns.
- **Cadence option set:** add `30m` to `SNAPSHOT_CADENCES` + `CADENCE_MS` + bucket floor
  (minute → multiple of 30) so 30m works for capture buckets + the UI. Add a separate
  `TRACK_CADENCES = ['Off', ...SNAPSHOT_CADENCES]` + helpers `trackToRefreshMinutes()` /
  `trackToSnapshotCadence()` / `deriveTrackFromLegacy()` (single conversion home, DRY).
- **PATCH route (`segments.ts`):** accept `track_cadence`; validate against `TRACK_CADENCES`;
  persist it AND dual-write the two derived legacy columns in one statement.
- **UI:** single `track-cadence-control.tsx` (segmented, owner/admin gated), replaces
  `monitor/cadence-control.tsx` ("Auto-refresh") + `movement/snapshot-cadence-control.tsx`.
  Helper copy: predicate+game → "recomputes the live list AND writes a state+KPI snapshot
  each tick"; else → "recomputes the live member list each tick". Sub-hourly + large-segment
  → inline cost note (guardrail, not a block). "Refresh now" button stays (manual track-now).

## Related Code Files
- Create: `server/src/db/migrations/065-segment-track-cadence.sql`,
  `src/pages/Segments/detail/tabs/monitor/track-cadence-control.tsx`,
  `server/test/track-cadence-unification.test.ts`
- Modify: `server/src/services/snapshot-cadence.ts` (+30m, TRACK_CADENCES, converters),
  `server/src/routes/segments.ts` (PATCH `track_cadence` + dual-write),
  `server/src/types/segment.ts` (+`track_cadence`), `src/pages/Segments/refresh-cadence.ts`
  (UI cadence options/labels), header-pill reader if it should prefer `track_cadence`
- Read (superseded controls): `tabs/monitor/cadence-control.tsx`,
  `tabs/movement/snapshot-cadence-control.tsx`

## Implementation Steps
1. `snapshot-cadence.ts`: add `30m` (enum + CADENCE_MS + 30m bucket floor); add
   `TRACK_CADENCES`, `trackToRefreshMinutes`, `trackToSnapshotCadence`, `deriveTrackFromLegacy`.
2. Migration 065: add `track_cadence`; backfill cost-safe (eligible=snapshot_cadence,
   manual=derive-from-refresh cap daily, null→Off). Additive only.
3. `types/segment.ts`: add `track_cadence?: SnapshotCadence | 'Off'`.
4. PATCH route: accept + validate `track_cadence`; dual-write derived legacy columns.
5. `track-cadence-control.tsx`; wire into Monitor (phase 2 mounts it); retire the two old
   controls' usages; header pill prefers `track_cadence`.
6. Tests: 30m bucket math; track↔legacy conversions both ways; backfill rule; PATCH
   dual-write persistence + Off→null. `tsc` + suites green.

## Todo List
- [x] snapshot-cadence: +30m, TRACK_CADENCES, converters
- [x] migration 065 (additive) + cost-safe backfill (applied + verified on live dev DB)
- [x] type + PATCH `track_cadence` dual-write
- [x] track-cadence-control.tsx created (mounting + retiring 2 old controls deferred to phase 2)
- [x] tests + tsc + suites green (new track-cadence suite + extended PATCH suite)

## Success Criteria
- [ ] One knob sets one cadence; backend derives both legacy columns from it
- [ ] Both crons fire at the same frequency for a tracked segment (drift ≤ 1 bucket)
- [ ] Migration is additive — no segment's recompute/capture behavior changes at deploy
- [ ] `Off` = no auto recompute + idle capture; `30m` buckets/round-trips correctly

## Risk Assessment
- **Backfill (RESOLVED — cost-safe, operator-confirmed):** `track := snapshot_cadence` for
  eligible. 28 segs → daily, 1 → 1h. Zero snapshot-cost increase. Display value may read
  coarser than the still-running hourly recompute until the knob is next set — harmless
  (live list fresher than implied; no cost surprise).
- **Blast radius:** `refresh_cadence_min` readers (header pill, refresh-queue, retention)
  keep working — column retained + dual-written, never hard-cut.
- **Frequency-aligned ≠ phase-aligned:** age-based recompute vs bucket-based capture can be
  offset < 1 bucket. Acceptable for the UX goal; true bucket-alignment of recompute is a
  deferred refinement (YAGNI now).

## Security Considerations
- Track-cadence write stays owner/admin gated (same as the controls it replaces). No new
  data exposure — same jobs, one control.
