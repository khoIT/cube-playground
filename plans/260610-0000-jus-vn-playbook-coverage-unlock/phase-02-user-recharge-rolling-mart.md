# Phase 02 — jus user_recharge_rolling mart → unlocks 03, 04

**Priority:** P1 · **Status:** ☐ not started

## Context Links
- Template to PORT: `cube-dev/cube/model/cubes/cfm/user_recharge_rolling.yml`
- Registry: `playbook-registry.ts:90-116` (03 spike_ratio, 04 qualified_drop_ratio)
- cfm build note: plan `260609-1515/plan.md` "Build note — Phase 03".

## Overview
Direct port of cfm's `user_recharge_rolling` to jus. Materializes trailing 1d/7d/30d spend ratios per user, evaluated as of the jus recharge data anchor, so the spend-spike/spend-drop predicates are plain cohort filters (no trigger engine).

## Key Insights
- Grain = **one row per user as of the data anchor** (MAX(log_date) of the source), NOT "latest recharge day" — this is what makes a DROP visible (a user who went quiet has `revenue_7d_total = 0`).
- spike uses a **prior-29d** baseline (excludes anchor day) → first/only-time payers resolve NULL, never a false spike.
- jus source column is `ingame_total_recharge_value_vnd` (same name as cfm) on `std_ingame_user_recharge_daily` (discovery confirms). The cfm template's SQL transfers near-verbatim — only the source table name is identical, so it is a clean copy.
- Member names MUST match registry exactly: `user_recharge_rolling.spike_ratio` (03), `user_recharge_rolling.qualified_drop_ratio` (04). Same logical cube name as cfm → per-game /meta keeps verdicts separate; zero registry edit.

## Data flow
`std_ingame_user_recharge_daily` (log_date, user_id, ingame_total_recharge_value_vnd) → anchor CTE (MAX log_date) → CASE-window SUMs over trailing 30d → ratio dimensions → exposed as `user_recharge_rolling.{spike_ratio, qualified_drop_ratio}` in jus /meta → availability flips 03/04 to `available` → sweep cohort filter.

## Requirements
- Functional: `user_recharge_rolling` cube present in jus /meta with `user_id` (public PK), `log_date` (time), `spike_ratio`, `drop_ratio`, `qualified_drop_ratio`, `revenue_1d/7d_total/30d_total`.
- 03 (`spike_ratio >= 3`) and 04 (`qualified_drop_ratio < 0.3`) flip to `available`.

## Architecture
Port the cfm YAML 1:1, changing only: `title`/`description` → "JUS VN"; confirm source table `std_ingame_user_recharge_daily` + column `ingame_total_recharge_value_vnd`. Keep: anchor CTE, CASE-window SUMs, NULLIF guards, the `qualified_drop_ratio` floor (`revenue_7d_total > 0 AND revenue_30d_total >= 500000` — recalibrate the ₫500k floor in Phase 06 against jus distribution), `user_id` `public: true`, `log_date` wrapped to TIMESTAMP, `refresh_key.every: 30 minute`, no pre-aggregation (non-additive ratios).

## Related Code Files
- Create: `cube-dev/cube/model/cubes/jus/user_recharge_rolling.yml`
- Read: cfm template, jus `user_recharge_daily.yml` (confirm column names).
- Modify: none (registry untouched).

## Implementation Steps
1. Copy the cfm mart YAML to the jus dir; rename titles to "JUS VN"; verify source table + recharge column against jus `/meta` or `user_recharge_daily.yml`.
2. Restart `cube_api` (+ worker) — DEV_MODE=false = no hot-reload.
3. `/meta` (jus scope): confirm `user_recharge_rolling` + members appear, `user_id` public.
4. `/load` a small query: count rows, eyeball `spike_ratio` / `qualified_drop_ratio` distribution (anchor day non-empty).
5. `curl /api/care/playbooks?game=jus_vn` → assert 03, 04 = `available`.
6. `curl /api/care/cases?game=jus_vn` (or trigger sweep) → 03/04 produce non-empty cohorts; flag full-base or zero (calibrate in 06).

## Todo
- [ ] create jus user_recharge_rolling.yml (porting cfm)
- [ ] restart cube serving instance
- [ ] /meta shows cube + members (user_id public)
- [ ] /load distribution sanity (non-empty anchor day)
- [ ] availability flips 03, 04 → available
- [ ] sweep yields non-empty plausible cohorts

## Success Criteria
- 03, 04 = `available` for jus_vn; both produce non-empty, non-degenerate cohorts (calibration deferred to 06).
- cfm 03/04 unchanged.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| jus recharge column differs from cfm | Low×Med | Verify against jus YAML before copy (Phase 01/this step 1) |
| drop_ratio degenerate (sparse recharge, like cfm 25k/33k) | High×Med | Phase 06 recalibrate: exclude ratio=0 (churn→PB14), require real 30d baseline, percentile threshold |
| YAML folded-comment trap breaks parse | Med×Med | Keep comments out of folded `sql: >` block; see docs/lessons-learned.md |

## Backwards Compatibility
New cube, additive. No existing jus cube or registry member changes. cfm mart of the same name is a separate file in a separate dir — unaffected.

## Security
Read-only mart over std table; no PII beyond user_id already exposed elsewhere.

## Next
Independent of 03/04/05. Feeds Phase 06 calibration (drop_ratio floor + threshold).
