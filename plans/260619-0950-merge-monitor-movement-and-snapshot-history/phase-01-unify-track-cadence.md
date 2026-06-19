---
phase: 1
title: "Unify recompute + capture into one Track cadence"
status: pending
priority: P1
effort: "1.5d"
dependencies: []
---

# Phase 1: Unify recompute + capture into one Track cadence

## Overview
Collapse the two independent schedules (`refresh_cadence_min` recompute + `snapshot_cadence`
capture) into **one** per-segment cadence. One job computes membership ONCE per tick and
fans out to both stores: SQLite (live member list) + lakehouse (state+KPI history). One
"Track every" control replaces the two-knob panel.

## Why this is sound (not just fewer knobs)
- Today both jobs re-run the SAME predicate query independently → merging computes once,
  writes twice = DRY + less Trino load per tick.
- Eliminates live-vs-history drift (one tick = one consistent as-of for both stores).
- User accepted the tradeoff: history-snapshot cost now scales with the chosen cadence.

## Requirements
- Functional: single `track_cadence` field (enum `Off|15m|30m|1h|3h|6h|12h|daily`). One track
  job per tick: (1) recompute membership from `cube_query_json` once; (2) write live member
  list to SQLite; (3) if predicate+game AND snapshots enabled for env → write
  membership/state/KPI to lakehouse from the SAME computed set. `Off` = on-demand only.
- Non-snapshot segments (manual / no game) → track job does steps 1–2 only (no history).
  The single knob degrades automatically.
- Non-functional: no double-query per tick; preserve serve-stale + opt-in
  `SEGMENT_SNAPSHOT_ENABLED` env gate; preserve header health-pill cadence display.

## Architecture
- **Schema (migration):** add `track_cadence TEXT` to `segments`. Backfill (decision below).
  Keep `refresh_cadence_min` + `snapshot_cadence` columns during transition (other readers
  use them — esp. the header pill reads `refresh_cadence_min`); derive/dual-write until all
  readers move to `track_cadence`, then deprecate.
- **Job unification:** new/!refactored track job (fold `refresh-segment.ts` +
  `snapshot-segment-membership.ts` orchestration) keyed off `track_cadence` via the existing
  `cadenceElapsed`/`floorToCadenceBucket` bucket guard. Compute identity set once →
  `writeLiveMembership(SQLite)` + (eligible) the existing snapshot writers
  (membership/state/KPI) reusing that set. Existing per-writer code reused (DRY).
- **Cadence option set:** add `30m` to `SNAPSHOT_CADENCES` + `CADENCE_MS` + bucket floor
  (30m floors cleanly) so the unified set is consistent across UI + bucket math.
- **UI:** single `track-cadence-control.tsx` (segmented, owner/admin gated). Helper copy:
  predicate+game → "recomputes the live list AND writes a state+KPI snapshot each tick —
  history below updates at this cadence"; else → "recomputes the live member list each
  tick". Sub-hourly + large-segment → inline cost note (guardrail, not a block).

## Related Code Files
- Modify: `server/src/db/migrations/*` (new migration), `server/src/types/segment.ts`,
  `server/src/jobs/{refresh-segment,snapshot-segment-membership,cron-runner}.ts`,
  `server/src/services/snapshot-cadence.ts` (+30m), `server/src/routes/segments.ts`
  (PATCH `track_cadence`), header-pill reader (`refresh-cadence.ts`)
- Create: `src/pages/Segments/detail/tabs/monitor/track-cadence-control.tsx`,
  `server/test/track-cadence-unification.test.ts`
- Read: `tabs/monitor/cadence-control.tsx`, `tabs/movement/snapshot-cadence-control.tsx`
  (both superseded by the single control)

## Implementation Steps
1. Migration: add `track_cadence`; backfill per decision; add 30m to cadence enum/bucket.
2. Refactor cron into one track job: compute-once → fan out SQLite + (eligible) lakehouse.
3. PATCH route accepts `track_cadence`; dual-write/derive legacy fields until readers move.
4. `track-cadence-control.tsx` + retire the two old controls; header pill reads track.
5. Tests: bucket guard fires once/tick; fan-out writes both stores from one set; degrade
   (no-game → SQLite only); 30m bucket math; PATCH persistence. Build green.

## Todo List
- [ ] migration + `track_cadence` + 30m cadence support
- [ ] unified track job (compute-once, fan-out, bucket-guarded)
- [ ] PATCH + legacy dual-write/derive; header pill on track
- [ ] track-cadence-control.tsx; retire 2 old controls
- [ ] tests + tsc + suites green

## Success Criteria
- [ ] One knob sets one cadence; one tick recomputes once + writes both stores consistently
- [ ] No double query per tick; no live/history drift at a tick
- [ ] Non-snapshot segments tracked (SQLite only) with the same knob
- [ ] Existing segments migrated without silent cost spike / staleness regression

## Risk Assessment
- **Migration backfill (OPEN DECISION):** deriving `track_cadence` from two old fields.
  Setting it to the finer value spikes snapshot cost for all; the coarser regresses live
  freshness. Proposed default: `COALESCE(snapshot_cadence,'daily')` for predicate+game,
  refresh-nearest-enum (cap daily) otherwise; flag for operator review. CONFIRM before migrate.
- **Cost coupling (accepted):** sub-hourly Track = sub-hourly heavy snapshots. Mitigate with
  the inline cost note; keep a deferred "capture history less often" escape hatch (YAGNI now).
- **Blast radius:** `refresh_cadence_min` readers (header pill, refresh-queue, retention).
  Keep legacy columns + dual-write until all migrated; don't hard-cut.

## Security Considerations
- Track-cadence write stays owner/admin gated. No new data exposure (same jobs, merged).
