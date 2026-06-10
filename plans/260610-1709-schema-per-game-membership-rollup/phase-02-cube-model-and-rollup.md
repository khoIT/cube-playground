# Phase 02 — Per-Game Cube Model + `members_daily` Rollup

**Priority:** P1. **Status:** not started. **Depends on:** Phase 00 (decision b), Phase 01.
Register a segment-membership cube **per game** so the existing `repositoryFactory` picks it up,
and define a CubeStore rollup so size-over-time resolves sub-second.

## Key insight (the unlock)
`contextToAppId = cube_<game>` ⇒ Cube compiles a separate schema per game, and
`COMPILE_CONTEXT.securityContext.game` is available at compile time. So **one** `.js` cube can
derive each game's FQN — no cross-game cube, no `_shared` hack. The inert
`cube-dev/cube/model/_shared/segment_membership.yml` (hard-pinned to `khoitn`) is **replaced** by
this approach and should be deleted.

## Authoring style — pick per Phase 00 decision (b)
- **Preferred (DRY):** add `model/cubes/_common/` (and `model/views/_common/`) to the
  `repositoryFactory` file sweep in `cube-dev/cube/cube.js` (additive: one extra dir read per kind,
  loaded for every tenant alongside `<game>`). Drop a single `model/cubes/_common/segment_membership.js`
  that maps `COMPILE_CONTEXT.securityContext.game` → `STAG_SCHEMA[game]` → `sql_table:
  stag_iceberg.<schema>.segment_membership_daily`.
- **Fallback (zero router change):** a generator script writes one baked `segment_membership.yml`
  into each `model/cubes/<game>/` (schema hard-coded per file). More files, no `cube.js` edit.

## Cube definition (mirror the inert YAML, minus the cross-game `_shared` framing)
- dims: `composite_pk` (hidden PK), `snapshot_date` (time), `game_id`, `segment_id`, `uid`.
- measures: `members` = `count_distinct_approx(uid)` (HLL, merges across grains); `members_exact`
  = `count_distinct(uid)`.
- `pre_aggregations.members_daily`: rollup, measure `members`, dims `[game_id, segment_id]`,
  time_dimension `snapshot_date`, granularity `day`, `partition_granularity: year`,
  `refresh_key.every: 1 hour incremental: true`, `build_range_start/end` bound to the table's
  real MIN/MAX `snapshot_date` (fixed wide ranges build empty partitions that stall the loader —
  see `cube-preagg-build-mechanics-harness` + `cube-rollup-authoring-rules` memories).
- `refresh_key.every: 1 hour` on the cube (partitions immutable once written).

## Related files
- Create: `cube-dev/cube/model/cubes/_common/segment_membership.js` (or per-game YAMLs).
- Modify (preferred path only): `cube-dev/cube/cube.js` `repositoryFactory` — sweep `_common` too.
- Delete: `cube-dev/cube/model/_shared/segment_membership.yml` (superseded).
- Note: `cube-dev` is a submodule with unrelated dirty state — commit there separately.

## Implementation steps
1. Author the cube (`.js` + COMPILE_CONTEXT, or generated YAMLs).
2. If preferred path: extend `repositoryFactory` to also read `model/cubes/_common/` +
   `model/views/_common/` (tolerate ENOENT, same as today).
3. **Restart the Cube serving instance** (DEV_MODE=false ⇒ no hot reload) — restart `cube_api`
   AND the refresh worker, or new rollups never route (memory: `cube-serving-instance-needs-restart-for-new-rollups`).
4. Trigger a refresh (`CUBE_REFRESH_GAMES=cfm` for a single-game seal first) and confirm the
   `members_daily` partitions build in CubeStore.
5. Verify a size-over-time query (`members` by `segment_id` over a `snapshot_date` range) routes to
   the pre-agg — confirm by **compiled SQL referencing the rollup table**, not just `usedPreAggregations`.

## Success criteria
- Per game: cube compiles, `members`/`members_exact` return correct values vs a direct Trino count.
- `members_daily` seals; size-over-time query served from CubeStore (compiled-SQL verified).
- No regression to existing game cubes (compile clean for every `SUPPORTED_GAMES` tenant).

## Risks
- COMPILE_CONTEXT per-game resolution flaky → use generated-YAML fallback (Phase 00 catches this).
- Rollup additivity: only `members` (approx) merges across week/month; `members_exact` is point-in-time
  only — don't put `members_exact` in the rollup measure list.
- `repositoryFactory` change touches multi-tenant-critical code — keep it additive + ENOENT-tolerant;
  regression-test that a game with no `_common` file still loads.

## Next → Phase 03 (swap the serve path onto this rollup).
