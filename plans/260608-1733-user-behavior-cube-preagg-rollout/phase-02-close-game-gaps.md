# Phase 2 — Close Per-Game Coverage Gaps

**Priority:** P1 (parallel with Phase 1). **Status:** pending. **blockedBy:** Phase 0.

## Gap inventory (verified 2026-06-08)
| Game | Cubes w/ rollup today | Action |
|---|---|---|
| **cros** | 0 | Add standard set (zero coverage — every query live) |
| **tf** | 0 | Add standard set |
| **cfm** | 4 / 25 | Add `mf_users` + `recharge` rollups (covered in Phase 1); behavior `etl_*`/`*_panel` cubes stay live (row-level, out of scope) |
| ptg | 1 (plain rollup) | Convert `ordered_funnel_canonical` to lambda; add `recharge` rollup |

User confirmed cros/tf worth doing.

## Standard set (per game, matches ballistar/muaw)
`active_daily` (DAU baseline + country/payer), `game_key_metrics` (acquisition/revenue by media_source/country/platform), `marketing_cost`, `ordered_funnel_canonical`. All as `batch rollup` + `rollup_lambda`.

## Steps
1. Confirm cros/tf cube schemas match the standard cubes via `/meta` (game ids: `cros`, and tf — confirm tf's registry id; not in current games list probe → verify it exists locally).
2. Copy ballistar's pre-agg blocks into cros/tf equivalents; adjust measure/dim names to each game's `/meta`.
3. Convert ptg `ordered_funnel_canonical` plain `rollup` → `batch + rollup_lambda` so it degrades gracefully instead of 404ing (this was the hard-fail in measurement).
4. Rebuild + validate `usedPreAggregations` per game.

## Success criteria
- cros/tf: standard aggregate queries served from CubeStore.
- ptg funnel no longer 404s when partitions are mid-build (lambda fallback).
- No game left with a bare `rollup` that can hard-fail.

## Risks / open
- `tf` not seen in `/api/playground/games` probe — confirm it's a real local game before scoping (Phase 0 topology step).
- cros/tf may be pilot games with thin/empty source data → partitions build empty. Verify source row counts; if empty, defer (don't ship dead rollups).

## Open question
Are cros/tf actually in active local use, or pilot stubs? If stubs, drop from scope to avoid maintaining inert rollups.
