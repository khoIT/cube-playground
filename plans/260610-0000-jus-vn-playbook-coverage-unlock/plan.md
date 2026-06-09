---
title: "jus_vn VIP-care playbook coverage unlock"
description: "Port the cfm_vn coverage-expansion marts to jus_vn so the CS dashboard unlocks ~12-13/21 playbooks on real anchored data."
status: completed
result: "13/21 enabled (9 available + 4 partial). Result report: plans/reports/from-cook-jus-vn-playbook-coverage-unlock-result-report.md"
priority: P2
effort: 9h
branch: main
tags: [cube, care-playbooks, jus_vn, cohort, mart]
created: 2026-06-10
---

# jus_vn Playbook Coverage Unlock — baseline ~6/21 → ~12-13/21

**Goal:** unlock the most VIP-care playbooks for `jus_vn` in the CS dashboard, mirroring the completed cfm_vn expansion (plan `260609-1515`). jus is a wuxia/social MMO (no FPS ladder / clan / lottery / gacha). Honest mapping only — no fabrication.

## How the system already works (verified — drives the plan)
- Registry (`server/src/care/playbook-registry.ts`) is **shared across games**; verdict is **per-game** from live `/meta` member presence (`availability.ts:75-89`, `extractLogicalMembers` `:53`). A mart that exposes a member named exactly as a playbook's `dataRequirements` flips that game's verdict — **zero registry edits** for 03/04/15/06/09.
- Fail-CLOSED: absent member → `unavailable`, no query (`availability.ts:83-84`).
- Per-game **data as-of anchor** already built (`resolve-data-anchor.ts` — MAX(member), per source table, env-overridable). Relative windows bind to each member's freshest date, not `now()`. No new anchor code.
- Local cube mounts `./cube-dev/cube`; `jus_vn`→`jus`. Marts MUST land in `cube-dev/cube/model/cubes/jus/`. NOT `../cube-api`.

## Phases
| # | Phase | Unlocks | Status |
|---|-------|---------|--------|
| 01 | [Baseline verify + registry member reconciliation](phase-01-baseline-verify-and-reconciliation.md) | confirm 01,02,14,18 + 19,20 partial | ✅ done (no mismatch; no reconciliation needed) |
| 02 | [user_recharge_rolling mart](phase-02-user-recharge-rolling-mart.md) | 03, 04 | ✅ done (03→1324, 04→623) |
| 03 | [user_active_rolling mart](phase-03-user-active-rolling-mart.md) | 15 | ✅ done (15→237) |
| 04 | [user_gameplay_daily power-leaderboard mart](phase-04-user-gameplay-daily-power-leaderboard-mart.md) | 06, 09 | ✅ done — fighting_power NULL in jus; ranked by role_level+LTV per user choice (06→10, 09→1) |
| 05 | [etl_prop_flow rare-item partial (jus)](phase-05-etl-prop-flow-rare-item-partial.md) | 07 (partial) | ✅ done (07 + 11 partial; mirrors cfm) |
| 06 | [Calibrate + live-validate + coverage surface + restart](phase-06-calibrate-validate-coverage-restart.md) | all | ✅ done — no calibration needed (cohorts non-degenerate). Report in plans/reports/ |

## Key dependencies
- 01 is foundational: confirms baseline members + that jus member names match registry `dataRequirements` (fail-closed depends on it). Marts in 02-05 are independent of each other (different source tables, different YAML files) — can build in any order / parallel.
- Each mart phase: write jus YAML → restart cube → verify `/meta` member appears → verify availability flips → non-empty plausible cohort.
- 06 gates the demo: full sweep, calibrate degenerate cohorts, surface as-of date, restart serving instance (DEV_MODE=false = no hot-reload — must restart `cube_api` + `cube-refresh-worker`).

## File ownership (no overlap)
- 02 → `cube-dev/cube/model/cubes/jus/user_recharge_rolling.yml` (new)
- 03 → `cube-dev/cube/model/cubes/jus/user_active_rolling.yml` (new)
- 04 → `cube-dev/cube/model/cubes/jus/user_gameplay_daily.yml` (new)
- 05 → `cube-dev/cube/model/cubes/jus/etl_prop_flow.yml` (new)
- 06 → calibration JSON / registry overrides only (no mart files)
- Registry `playbook-registry.ts` is touched by NO phase (see 07 risk below).

## Out of scope (no jus source — stay unavailable, no fabrication)
- **05** payment-fail, **13** sentiment, **16** support ticket, **21** birthday — hard-blocked everywhere.
- **10, 17** guild/clan, **12** gacha/lottery — no jus table.
- **08** rank-drop (power near-monotonic, no per-match drop), **11** set-completion (no item-set enum). Deferred, like cfm.
- App-side trigger engine. Pushing to `second` (prod) remote. Generalizing marts to other games.

## Target outcome
~12-13/21 jus_vn playbooks available/partial producing non-empty, plausible cohorts in the CS dashboard on real (anchored) jus data: 01,02,03,04,06,07(partial),09,14,15,18 available/partial + 19,20 ops-partial. Comparable to cfm's 12.
