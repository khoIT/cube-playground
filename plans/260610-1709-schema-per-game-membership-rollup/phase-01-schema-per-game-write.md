# Phase 01 — Schema-per-Game Write Path

**Priority:** P1. **Status:** not started. **Depends on:** Phase 00 (decision a).
Move the writer from a single `stag_iceberg.khoitn.segment_membership_daily` (+ `_delta`)
to per-game targets, so each game's rows live in its own schema (or table, per Phase 00 fallback).

## Key insight
Today `LAKEHOUSE_SCHEMA = 'khoitn'` is a constant and `game_id` is just a partition column.
Per-game means the schema (or table suffix) is **derived from the game**, mirroring `GAME_SCHEMA`
in `cube.js` / `trino-profiler-config.ts`. The fact stays one-row-per-(date,game,segment,uid);
only its physical home changes. The writer already canonicalizes game via `game-aliases.ts`.

## Related code files (modify)
- `server/src/lakehouse/lakehouse-trino-connector.ts` — replace `LAKEHOUSE_SCHEMA` constant with
  a `lakehouseSchemaForGame(game)`-style resolver returning the per-game schema (reuse
  `GAME_SCHEMA`/`canonicalGameId`); `SEGMENT_MEMBERSHIP_DAILY`/`_DELTA` become schema-qualified
  per game. `ensureLakehouseTables` takes a game (or loops games) and creates each schema+table.
- `server/src/lakehouse/segment-membership-ddl.sql` — parameterize the schema; keep
  `partitioning=ARRAY['snapshot_date','segment_id']` (drop `game_id` from partition spec — schema
  isolation already separates games; keep the `game_id` *column* for self-describing rows + the
  Cube `game_id` dim). `sorted_by=ARRAY['uid']`, PARQUET unchanged.
- `server/src/lakehouse/segment-snapshot-writer.ts` — target the per-game daily table; partition
  DELETE scoped to `(snapshot_date, segment_id)` within the game schema.
- `server/src/lakehouse/segment-delta-writer.ts` — per-game delta table; the D vs D-1 join is now
  intra-schema (no game_id predicate needed, but keep it harmless).
- `server/src/jobs/snapshot-segment-membership.ts` — `runSegmentMembershipSnapshot` groups eligible
  segments by game and ensures each game's schema/table once; serial within game (writes stay serial).

## Implementation steps
1. Add `lakehouseSchemaForGame` reuse (it already exists in connector for game→schema; confirm it
   now drives the WRITE target, not just a validation check).
2. Parameterize DDL + `ensureLakehouseTables(game)`; create schema `IF NOT EXISTS` per game (or
   per-table fallback from Phase 00).
3. Repoint snapshot + delta writers at the per-game qualified names.
4. Group job by game; ensure-tables once per game per run.
5. **Fresh re-run** (no backfill migration of `khoitn` rows — decision #3 "start fresh"). Optionally
   drop the old `stag_iceberg.khoitn.segment_membership_*` after the per-game run verifies.

## Success criteria
- Per game: `stag_iceberg.<schema>.segment_membership_daily` exists, row count == Cube `total:true`
  for ≥1 segment (idempotent re-run = same count).
- Existing `server/test/lakehouse-snapshot-sql.test.ts` updated for the per-game resolver; full
  suite green (`npm test`); tsc clean.
- Heartbeat (`segment_snapshot_log`) still records per-segment status.

## Risks
- **Shared Trino** — schema creation is visible org-wide; confirm naming won't collide (Phase 00).
- Dropping `game_id` from the partition spec changes file layout — verify Phase 02 queries still
  prune by `segment_id` + `snapshot_date` (they do; game is now the schema).

## Next → Phase 02 (model points at these per-game schemas).
