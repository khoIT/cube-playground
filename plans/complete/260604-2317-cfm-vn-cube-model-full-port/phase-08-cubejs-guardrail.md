---
phase: 8
title: cube.js Multi-Tenant + Guardrail
status: completed
priority: P1
effort: 0.75d
dependencies:
  - 2
---

# Phase 8: cube.js Multi-Tenant + Guardrail

## Overview
<!-- Updated: Validation Session 1 - vga/iceberg catalog override DEFERRED. Active: add cros/tf to GAME_SCHEMA + guardrail. -->
Two cube.js changes, both prerequisites for the new tenants:
1. **Tenant routing:** add `cros`/`tf` to `GAME_SCHEMA` (both on the existing `game_integration` catalog). The per-tenant **catalog** override (`vga → iceberg`) is **DEFERRED with vga** — do NOT change the single-catalog driver now; keep the `GAME_CATALOG` design note below for resumption.
2. **Guardrail:** port kraken's `queryRewrite` 31-day behavior-log limit, generalized to bare `etl_*` across all games. Must land BEFORE Phases 5/6/10/11 import any `etl_*` cube (1M–1.3B-row tables OOM Trino on unbounded scans).

## Requirements
- Functional: cros/tf JWTs route to the correct schema (game_integration); reject/constrain unbounded queries on `etl_*` cubes + behavior-panel views; allow bounded ones. (vga routing deferred.)
- Non-functional: preserve local's existing multi-tenant `cube.js` (auth-db routing, per-game schema, `continueWaitTimeout`); both changes additive; no regression to ballistar/cfm/jus/muaw/pubg/ptg routing.

## Tenant routing (change 1)
- `GAME_SCHEMA`: add `cros: 'cros'`, `tf: 'tf'`. (Active scope.)
- Extend `getUserAccess` allow-list + any `GAME_ALIASES` (e.g. `cros_*`/`tf_*` country suffixes if minted).
- **DEFERRED with vga:** add `vga: 'vga'` + a `GAME_CATALOG` map (default `game_integration`; `vga: 'iceberg'`) changing the driver to `catalog: GAME_CATALOG[game] ?? process.env.CUBEJS_DB_PRESTO_CATALOG`. Don't touch the single-catalog driver now.

## Architecture (guardrail — change 2)
- Local `cube.js` already exports a config object (auth/routing). kraken `cube.js` exports `orchestratorOptions` + `queryRewrite`. MERGE: add `queryRewrite` + `continueWaitTimeout: 25` into local's exported object without disturbing tenant routing.
- **Naming adaptation (critical):** kraken's `isBehaviorRawCube` regex is `^[a-z]+_etl_[a-z0-9_]+$` (game-PREFIXED, e.g. `cfm_etl_login`). Local uses BARE names (`etl_login`). Change the regex to match bare `^etl_[a-z0-9_]+$`. Since local compiles ONE game's folder per request, the bare-name guardrail covers whichever tenant is active (cfm/cros/tf all have `etl_*` cubes). Update `BEHAVIOR_VIEWS` to the bare local view names used by ANY ported game: cfm panels (`user_matches_panel`, `user_money_flow_panel`, `user_lottery_panel`, `user_tutorial_panel`, `user_newbie_detail_panel`, `user_game_detail_panel`, `user_prop_flow_panel`, `user_team_starts_panel`) + the shared login/logout/register panels (`user_login_panel`, `user_logout_panel`, `user_register_panel`) that cros/tf also expose. vga has no `etl_*` cubes → unaffected by the guardrail.
- Keep `MAX_RANGE_DAYS = 31`, `TIME_DIM_FIELDS = {log_date, dteventtime}`, `SAFE_SEGMENT_DAYS = {last_7d:7, last_30d:30}`, and the `parseDateRangeDays` / `collectCubesTouched` / `walkFilters` helpers verbatim.

## Related Code Files
- Modify: `cube-dev/cube/cube.js` (merge `queryRewrite` + helpers + `orchestratorOptions.continueWaitTimeout`)
- Reference: kraken `cube/cube.js`

## Implementation Steps
1. Read full local `cube.js`; identify the exported object shape + whether it already has `orchestratorOptions`/`queryRewrite`.
2. Copy kraken's helper fns (`memberPrefix`, `memberSuffix`, `walkFilters`, `collectCubesTouched`, `parseDateRangeDays`, `collectBoundDays`, `touchesBehavior`, `isBehaviorRawCube`).
3. Adapt `isBehaviorRawCube` regex → match bare `etl_*`. Rewrite `BEHAVIOR_VIEWS` to bare local view names.
4. Wire `queryRewrite` into the local export (compose if one already exists — call both).
5. Add `orchestratorOptions.continueWaitTimeout: 25` (keep ≤ gateway 120s).
6. Unit-test the rewrite logic in isolation (node script): unbounded etl query → throws/constrained; bounded (timeDimensions dateRange ≤31d, or `last_30d` segment) → passes; >31d → rejected.

## Success Criteria
- [ ] `GAME_SCHEMA` has cros + tf (both on game_integration). (vga + GAME_CATALOG deferred.)
- [ ] A `cros`/`tf` JWT compiles its folder against game_integration; existing tenants (ballistar/cfm/jus/muaw/pubg/ptg) unchanged.
- [ ] Single-catalog driver left intact (no per-tenant catalog override yet).
- [ ] Bare `etl_*` cube name triggers the bound check; `mf_users`/`active_daily` (non-etl) untouched.
- [ ] Unbounded behavior query rejected; ≤31d bounded passes; >31d rejected.
- [ ] `continueWaitTimeout: 25` set.

## Risk Assessment
- Breaking tenant routing while merging = worst case (all queries fail). Mitigation: additive merge, read full file first, unit-test routing path unchanged.
- Regex over-match: bare `etl_*` is broad but local cfm only has `etl_*` event cubes (no innocent `etl_`-named non-event cube) — confirm via folder listing. ballistar etc. unaffected (compiled separately).
- If local `cube.js` already composes a `queryRewrite`, must chain, not replace.
