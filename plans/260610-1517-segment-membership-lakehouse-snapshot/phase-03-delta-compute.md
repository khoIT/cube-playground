# Phase 03 — Delta computation (D vs D-1)

**Priority:** P1 · **Status:** pending · **Depends on:** Phase 02

## Overview
After date D's full snapshot lands, derive the change feed (entered/exited) by diffing
D against D-1 per `(game_id, segment_id)`, writing to `segment_membership_delta`.
Full snapshot stays the source of truth; delta is a downstream convenience derived from it.

## Compute (runs in Trino, per date D)
```
DELETE FROM stag_iceberg.khoitn.segment_membership_delta WHERE snapshot_date = DATE 'D';

INSERT INTO stag_iceberg.khoitn.segment_membership_delta
WITH d AS (SELECT game_id, segment_id, uid FROM segment_membership_daily WHERE snapshot_date = DATE 'D'),
     p AS (SELECT game_id, segment_id, uid FROM segment_membership_daily WHERE snapshot_date = DATE 'D' - INTERVAL '1' DAY)
SELECT DATE 'D', COALESCE(d.game_id,p.game_id), COALESCE(d.segment_id,p.segment_id),
       COALESCE(d.uid,p.uid),
       CASE WHEN p.uid IS NULL THEN 'entered' ELSE 'exited' END AS change
FROM d FULL OUTER JOIN p
  ON d.game_id=p.game_id AND d.segment_id=p.segment_id AND d.uid=p.uid
WHERE d.uid IS NULL OR p.uid IS NULL;   -- only changed rows
```
Idempotent: clears D's delta slice first. If D-1 is missing (first run / gap), treat all of
D as `entered` (the FULL OUTER JOIN already yields this since `p` is empty).

## Implementation steps
1. `server/src/lakehouse/segment-delta-writer.ts` — runs the diff SQL on the Trino write client,
   parameterized only by `snapshot_date` (operates over all segments at once — set-based, cheap).
2. Sequence in the job (Phase 04): snapshot all segments for D → then one delta pass for D.
3. Guard: only run delta once D's snapshot pass reported success for ≥1 segment.

## Backfill (Open Q3)
- Default: **start fresh** — first run = all `entered`, deltas accrue forward. Simplest, correct.
- Optional later: seed a base snapshot from SQLite uid samples — rejected for v1 (samples are capped
  & stale; would emit false deltas). Document as not-done.

## Related code files
- Create: `server/src/lakehouse/segment-delta-writer.ts`
- Read: Phase 02 writer (shares the Trino write client)

## Success criteria
- For a segment with known churn between two days, delta rows match a hand-computed diff
  (entered = in D not D-1; exited = in D-1 not D).
- Re-running date D produces identical delta (idempotent).
- First-ever run yields all `entered`, zero `exited`.

## Risks
- Cross-day partition scan cost — bounded by `(snapshot_date, game_id)` pruning; both days are
  single-partition reads per game. Fine.

## Next
Phase 04 models the daily table in Cube + schedules the nightly snapshot→delta job.
