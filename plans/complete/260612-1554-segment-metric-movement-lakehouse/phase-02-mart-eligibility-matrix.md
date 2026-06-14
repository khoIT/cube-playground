---
phase: 2
title: Mart eligibility matrix — per-game daily-fact scout
status: completed
priority: P1
effort: 3h
dependencies: []
---

# Phase 2: Mart eligibility matrix — per-game daily-fact scout

## Overview
Scout daily marts per game in the LOCAL workspace to determine which games have per-user daily-snapshot facts usable for metric movement. Output: an eligibility matrix that gates which (game, metric) pairs Phase 6 offers. Report-only phase — no code changes.

## Key Insights
- Metric movement = `membership@D ⨝ fact@D` by uid+date. A game is eligible per metric only if a mart exists with: (a) per-user grain, (b) daily date column, (c) the metric measure, (d) a user column in the SAME identity namespace as the segment's snapshot uid (membership uid = the segment's resolved identity dim, e.g. `mf_users.user_id` after the identity-anchor pivot).
- Known traps from prior work: cfm vopenid namespace (use `user_recharge_daily`, not `recharge`; std bridge join), jus `recharge` transid-PK fan-out (fixed), `mf_users` dual-row (fixed in cube SQL but upstream mart still dual-row — raw-mart joins must dedupe), `iamount ≠ VND`.
- Game→schema map: `GAME_SCHEMA` in `server/src/services/trino-profiler-config.ts:30` (ballistar_vn, cfm_vn, ptg, jus_vn, muaw, pubgm).
- Raw-table taxonomy: `etl_` (event raw) / `std_` / `cons_` (marts) / `mf_` (master files) / `map_` — see `docs/` game-integration taxonomy notes.

## Requirements
- Functional: per-game matrix listing candidate marts, identity column + namespace, date column, supportable metric_keys (revenue, active, playtime/online-time at minimum), row-grain verification.
- Non-functional: read-only; Trino queries capped (LIMIT/short windows); cite `cube-dev/cube/model/cubes/{game}/*.yml` line refs.

## Related Code Files
- Read: `cube-dev/cube/model/cubes/{ballistar,cfm,ptg,jus,muaw,pubg}/*.yml`, `server/src/services/trino-profiler-config.ts`, `server/src/presets/business-metrics/` (metric_key vocabulary)
- Create: `plans/260612-1554-segment-metric-movement-lakehouse/reports/mart-eligibility-matrix.md`

## Implementation Steps
1. Enumerate per-game cube YAMLs; shortlist cubes whose sql_table is a per-user daily mart (e.g. `user_recharge_daily`, active-daily snapshots, `mf_users` for stock attrs).
2. Cross-check Trino `information_schema.columns` for each shortlisted table in its `GAME_SCHEMA` schema: confirm user column, date column, metric columns exist.
3. Verify grain with one bounded query per table: `SELECT count(*), count(distinct <uid>) FROM <t> WHERE <date> = <recent date>` — equal ⇒ per-user-per-day grain; unequal ⇒ note dedupe requirement.
4. Record identity namespace per mart vs the membership uid space for that game's segments (check `cube_identity_map` rows / `resolve-identity-field.ts` behavior).
5. Ask data platform (or test empirically over 2 dates) whether marts are append-immutable + retention window; record answers or mark UNKNOWN.
6. Write the matrix report: rows = (game, mart), cols = uid col/namespace, date col, metrics, grain check, immutability/retention, verdict (eligible / eligible-with-dedupe / ineligible).

## Success Criteria
- [x] Matrix covers all 6 schema-mapped games
- [x] ≥1 revenue mart + ≥1 activity mart verified eligible for cfm_vn AND jus_vn (the demo games)
- [x] Identity-namespace column filled for every eligible mart (join key explicit)
- [x] Immutability/retention recorded as explicitly UNKNOWN with data-platform follow-up noted

## Risk Assessment
- Identity mismatch (membership uid vs mart user col) silently yields zero-join → matrix MUST verify one actual join probe per eligible (game, mart): `membership@D ⨝ mart@D` row count > 0 for a real segment.
- Marts restated/purged → flags Phase 7 to fire earlier (materialize as freeze). Don't block on the answer; record UNKNOWN.
