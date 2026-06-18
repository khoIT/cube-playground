---
phase: 4
title: Per-user state writer
status: completed
priority: P1
effort: 1d
dependencies:
  - 2
  - 3
---

# Phase 4: Per-user state writer

## Overview

After a segment's membership snapshot lands at `snapshot_ts`, write per-uid canonical
state for **that segment's members** into `segment_member_state_daily`. Done as one
cross-catalog `INSERT … SELECT` per (segment, snapshot_ts): a predicate-free `mf_users`
projection — compiled **once per (game, snapshot_ts)** and reused across the game's
firing segments — JOINed in Trino to the segment's membership at that `snapshot_ts`.

## Requirements

- Functional: per segment firing at this tick, write one state row per member uid with
  the (pruned) canonical columns at `snapshot_ts`.
- Functional: idempotent per (snapshot_ts, game, segment) — DELETE slice then INSERT.
- Functional: per-segment keying (no cross-segment dedup) — a uid in N segments → N rows.
- Non-functional: prune columns absent from the game's `/meta` (Phase 1 helper) → NULL.
- Non-functional: as-of-`snapshot_ts` semantics; trailing metrics captured forward, never backfilled.
- Non-functional: compile the `mf_users` projection once per (game, ts) and cache within the tick.

## Architecture

### Why mf_users + Trino JOIN (scan-wide, write-narrow)

`mf_users` is the uid-grain feature store carrying nearly all canonical columns. A
predicate-free projection `dimensions:[identity, ...dims], measures:[...measures]`
compiles to a clean game-wide SELECT with **no segment filters** → zero join-rooting
risk. The segment restriction is the Trino JOIN to that segment's membership at
`snapshot_ts`. Trino *scans* `mf_users` once, but **only member rows are written**
(a few thousand for a million-user game) — storage + downstream stay member-scoped.
Do NOT widen this to write all users.

### Writer flow (`writeMemberStateSnapshot(segment, snapshotTs, compiledStateSql, opts)`)

1. (Per game/ts, once) resolve `mf_users` identity; prune canonical columns for the
   game's `/meta`; physicalize via resolver; `cubeSql(projection)` → `[sql, params]` →
   `inlineSqlParams` + `stripTrailingLimit`, alias columns to canonical keys → SELECT `S`.
   Cache `S` keyed by (game, snapshot_ts).
2. Compose per segment:
   ```sql
   INSERT INTO segment_member_state_daily
     (snapshot_date, snapshot_ts, game_id, segment_id, uid, <cols…>)
   SELECT DATE '<d>', TIMESTAMP '<ts>', '<game>', '<seg>', m.uid, s.<col>…
   FROM ( <S> ) s
   JOIN ( SELECT DISTINCT uid FROM segment_membership_daily
          WHERE game_id='<game>' AND segment_id='<seg>' AND snapshot_ts = TIMESTAMP '<ts>' ) m
     ON s.uid = m.uid
   ```
3. DELETE the (snapshot_ts, game, segment) slice, run the INSERT, post-INSERT COUNT.
4. Return structured `MemberStateWriteResult` (never throw per-segment).

### Orchestration

In `snapshot-segment-membership.ts`, inside the per-segment loop (after membership at
this tick), compile-or-reuse `S` for (game, ts) then call `writeMemberStateSnapshot`.
Log via heartbeat (`detail:'state:…'`). Runs at the segment's cadence; manual trigger covered.

## Related Code Files

- Create: `server/src/lakehouse/segment-member-state-writer.ts` (mirror `segment-snapshot-writer.ts`).
- Modify: `server/src/jobs/snapshot-segment-membership.ts` (per-segment state write; per-(game,ts) projection cache).
- Read/reuse: `inline-sql-params.ts`, `cube-member-resolver.ts`, `resolve-identity-field.ts`,
  `member-profile-runner.ts` (pruning), Phase 1 module, Phase 3 table consts, Phase 2 cadence/ts.

## Implementation Steps

1. Implement `compileMemberStateSelect(gameId, snapshotTs, opts)` (the cached `S` builder).
2. Implement `writeMemberStateSnapshot` reusing `extractCompiledSql`/`stripTrailingLimit`/`toSqlLiteral`.
3. Alias every member to its canonical key so the inner SELECT is positionally safe.
4. Wire into the job per segment; cache `S` per (game, snapshot_ts) within the tick.
5. Log per-segment outcome.

## Success Criteria

- [ ] `segment_member_state_daily` populated for a sub-daily test segment at each `snapshot_ts`; daily segments once/day.
- [ ] Row count per (ts, segment) == that segment's member count at that ts.
- [ ] A uid in N segments → N rows per ts (per-segment keying).
- [ ] Re-run same `snapshot_ts` is a no-op (idempotent slice).
- [ ] Compiled `mf_users` SELECT has no segment filters (verify SQL text); reused across the game's segments at a tick.
- [ ] Missing column → NULL, not error. `npm run server:build` + vitest pass.

## Risk Assessment

- **Scan-wide vs write-narrow** → game-wide `mf_users` scan, member-only writes; equivalent
  to current membership-snapshot scan cost. Do NOT write all users.
- **mf_users intraday staticness** → expected: sub-daily per-user rows are near-identical
  (feature store is daily-batch). Accepted per user's "everything sub-daily" decision; the
  intraday signal lives mostly in Phase 5 KPIs. Storage bounded (few test segments).
- **identity parity vs membership uid** → both key on the same identity field; assert in tests.
- **Crash between DELETE/INSERT** → self-correcting non-atomic window (as documented for membership).
