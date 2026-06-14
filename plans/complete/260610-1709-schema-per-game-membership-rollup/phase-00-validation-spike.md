# Phase 00 — Validation Spike (gates everything)

**Priority:** P0 — blocking. **Status:** not started.
**Why first:** the whole plan rests on four assumptions that are cheap to verify and expensive
to discover wrong mid-build. Spend ≤1 session proving them before touching the writer.

## Context links
- Writer/tables: `server/src/lakehouse/`, commit `ac25dfc`.
- Routing: `cube-dev/cube/cube.js` (`driverFactory` pins one catalog+schema; `repositoryFactory`
  reads only `model/cubes/<game>/`; `contextToAppId = cube_<game>` ⇒ per-game compile).
- Creds: `cube-dev/.env` (`CUBEJS_DB_*`).

## Assumptions to verify (each = one probe)

1. **Write perms to per-game schemas.** Can the `khoitn` Trino principal `CREATE SCHEMA IF NOT
   EXISTS stag_iceberg.cfm_vn` (and `jus_vn`, `ballistar_vn`, `ptg`, `muaw`, `pubgm`) and create
   a table in each? Probe with a throwaway `stag_iceberg.cfm_vn.__probe__` create+insert+drop.
   - If **denied** → fall back to per-*table* in the existing `khoitn` schema
     (`segment_membership_daily_<game>`); routing still works via FQN, governance parity lost.
     Record which path the rest of the plan takes.
2. **Cross-catalog FQN cube read.** With the Cube session on `game_integration.<game_schema>`, a
   cube whose `sql_table: stag_iceberg.<schema>.segment_membership_daily` must compile + return
   rows. Probe: drop a one-off bare cube into `model/cubes/cfm/`, restart, query `/sql` + `/load`.
3. **Per-game schema via COMPILE_CONTEXT in a `.js` cube.** A `.js` cube reading
   `COMPILE_CONTEXT.securityContext.game` → schema map must compile a *different* FQN per game
   (verify cfm resolves `cfm_vn`, jus resolves `jus_vn` in the compiled SQL, not a shared value).
   - If COMPILE_CONTEXT proves flaky → fall back to a generator that writes one baked YAML per
     game dir (Phase 02 alt path).
4. **Rollup builds + routes.** A `members_daily` rollup over the probe table seals in CubeStore
   and a size-over-time query reports `usedPreAggregations` (per `cube-preagg-build-mechanics-harness`
   + `cube-rollup-authoring-rules` memories — verify by *compiled SQL*, not just the flag).

## Success criteria
- A short findings note in this dir: each assumption PASS/FAIL + the chosen fallback for any FAIL.
- Decisions recorded: (a) schema-per-game vs per-table-in-khoitn; (b) shared `.js`+COMPILE_CONTEXT
  vs generated-per-game-YAML.

## Risks
- Probe writes hit a **shared** Trino — name probes `__probe__*` and drop them in the same session.
- DEV_MODE=false ⇒ restart Cube to load probe cubes; remove probe cubes after.

## Next
Feeds the two decisions into Phase 01 (write target) and Phase 02 (model authoring style).
