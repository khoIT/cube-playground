# Phase 04 — Cube model + rollup + nightly job wiring

**Priority:** P1 · **Status:** pending · **Depends on:** Phases 02–03

## Overview
Make the snapshot useful: model `segment_membership_daily` as a Cube cube with a day-grain
rollup (so segment-size-over-time is sub-second + serves downstream via the semantic layer),
and schedule the nightly snapshot→delta job using the existing `setInterval` job pattern.

## Part A — Cube model (`cube-dev`)
New cube over `stag_iceberg.khoitn.segment_membership_daily`:
- **Dimensions:** `segment_id`, `game_id`, `snapshot_date` (type: time).
- **Measures:** `members: count_distinct(uid)` (HLL → additive, sketch-mergeable across grains).
- **pre_aggregations:** `members_daily` rollup — measure `members`, dims `segment_id`,`game_id`,
  time_dimension `snapshot_date`, granularity `day`, `partition_granularity: year`,
  `refresh_key: { every: 1 hour, incremental: true }`, build range bound to MIN/MAX(snapshot_date).
  Follow the additive-measure + time-dim-match rules; verify by compiled SQL, not just
  `usedPreAggregations`. Cube serving instance must be **restarted** to pick up new rollup defs.

Result: the segment Library sparkline + Monitor history read this rollup (deterministic,
no cold-Trino pagination) — the eventual swap-out of the SQLite read path (decision #5).

## Part B — Nightly job
`server/src/jobs/snapshot-segment-membership.ts` mirroring `refresh-dashboard-tiles.ts`:
- `start…(): setInterval` once/day (after the segment refresh window, GMT+7-aware).
- Each run: list segments with `game_id` + `cube_query_json` → for each, call Phase 02 writer for
  today → after all, call Phase 03 delta writer once for today.
- Log per-segment outcome to a small SQLite heartbeat table `segment_snapshot_log`
  (`snapshot_date, segment_id, game_id, row_count, status, ts`) — mirrors `segment_refresh_log`.
- Concurrency: reuse the serial/queue discipline from `refresh-queue.ts`; cross-catalog INSERTs
  are heavy — cap parallelism low (1–2).
- Register start in the app bootstrap (`index.ts`) alongside the other `start*()` jobs.

## Related code files
- Create: `cube-dev/cube/model/cubes/_shared/segment_membership.yml` (or per-workspace location),
  `server/src/jobs/snapshot-segment-membership.ts`,
  `server/src/db/migrations/0XX-segment-snapshot-log.sql`
- Modify: `server/src/index.ts` (register job)
- Read: `server/src/jobs/refresh-dashboard-tiles.ts` (interval pattern), `refresh-queue.ts` (serial discipline)

## Success criteria
- A `members` query by `snapshot_date` for a segment resolves from the `members_daily` rollup
  (confirmed in compiled SQL), sub-second.
- Nightly job lands today's snapshot + delta for all eligible segments unattended; heartbeat rows written.
- Re-running the job same-day is idempotent (Phase 02/03 partition-clear semantics).

## Risks
- `segment_membership` is cross-workspace (lives in `stag_iceberg`, not per-game `game_integration`).
  Confirm which Cube workspace/model dir it belongs in so the member resolver routes it correctly.
- Rollup won't seal if `snapshot_date` is stored as a type Cube treats as non-time — store as DATE,
  verify the rollup builds (cold-build mechanics + future-seal caveats apply).

## Next
Post-ship: swap the segment Library/Monitor read path off SQLite onto the Cube rollup (decision #5),
and expose `segment_membership_delta` to downstream consumers (documented contract).
