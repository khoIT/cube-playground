---
title: "Standard per-game Cube model + agent-driven onboarding script"
description: "Canonical Tier-1 cube set, per-game gap matrix, and a generator script an agent runs to onboard a game from sampled data."
status: pending
priority: P2
effort: ~5d (planning complete; build phases sequential)
branch: main
tags: [cube-model, onboarding, data-model, multi-tenant, dry, generator]
created: 2026-06-14
---

# Standard per-game Cube model + agent-driven onboarding script

Standardize the per-game Cube model across 8 games (ballistar, cfm, cros, tf, ptg, jus, muaw, pubg)
on the cfm-reference common core, then encode the standard as a generator script an AGENT runs
after sampling a game's Trino data — clean cases auto-emit canonical YAMLs; anomalies are flagged
with a proposed strategy for the agent to confirm/override.

## Repo boundary (every change is tagged)
- **cube-dev submodule** (separate repo): all `cube/model/cubes/<game>/*.yml` + the generator script
  at `cube-dev/scripts/` (Node `.mjs`, co-located with the cube model it emits).
- **main repo**: `server/src/presets/**` (business-metrics, bundles), `src/pages/Segments/presets/**`
  (FE mirror).
- Phase files state the repo per change. A standardization PR therefore SPANS BOTH repos.

## Three layers (all must stay consistent)
- L1 Cube model — `cube-dev/cube/model/cubes/<game>/*.yml` (bare table names; schema resolved per-tenant in `cube.js`).
- L2 Server presets — `server/src/presets/` metrics (`required_cubes`) + bundles; availability gates on L1.
- L3 Bespoke etl event cubes — out of scope for template; stay hand-authored per game.

## Phases
| # | Phase | Status | Repo | Depends on |
|---|-------|--------|------|-----------|
| 01 | Canonical common-core cube spec (lock cfm-style mf_users) | **done** — `reports/canonical-cube-catalog.md` | cube-dev | — |
| 02 | Per-game gap matrix + prioritization | **done** — `reports/per-game-gap-matrix.md` | both (analysis) | 01 |
| 03 | Onboarding generator script (clean-case emit) | **done** — `cube-dev/scripts/onboard-game-cube-model.mjs` (reviewed) | cube-dev (`scripts/`) | 01 |
| 04 | Anomaly detection + agent-decision flow | **done** — dual-identity/role-name/high-scale samplers, verified jus/tf/ptg | cube-dev (script) | 03 |
| 05 | Layer-2 preset / metric reconciliation | **done** — `reports/metric-availability-reconciliation.md` (no edits needed; data-driven verified) | main | 01, 02 |
| 06 | Per-game rollout w/ fan-out + pre-agg guards | **in progress — clean games DONE** (cros+6, ballistar/muaw/pubg+7 each = 27 cubes written, guards green, YAML-valid; serving restart + commit pending). tf/jus/ptg (anomaly games) await per-game agent decision | cube-dev + main | 03, 04, 05 |
| 07 | Tests / validation harness | partial — cfm round-trip 14/14 byte-equal + 4-game dry-run verified; formal harness pending | both | 03, 06 |

> **Scope refined 2026-06-14 (during build):** generator emits **14 portable cubes** (Tier A+B) — the 16
> minus `recharge` + `ordered_funnel_canonical`, which are etl_ingame_*-sourced and NOT column-portable
> across games (cfm's etl_ingame_recharge has 26 cols cros lacks). Those stay per-game bespoke. The 20
> net-new core-table cubes remain deferred (user decision: Tier A+B only this round).

## Key dependencies
- Phase 03 cannot start before the canonical spec (01) freezes — the script emits that spec.
- Phase 06 rollout per game is gated by 03 (generator), 04 (anomaly flow), and 05 (preset reconcile)
  so a newly-modeled cube is immediately wired into metric/segment availability.
- ptg is sequenced LAST in 06 (scale + missing mf_users → mandatory pre-agg, treated as a special case).

## Locked decisions (verified against codebase + user-confirmed 2026-06-14)
- Canonical `mf_users` = **cfm-style**: plain `SELECT base.* … LEFT JOIN (max_by role name) latest_role`
  (`cube-dev/cube/model/cubes/cfm/mf_users.yml:7-16`). jus's `split_part` merge CTE
  (`jus/mf_users.yml:14-67`) is a **jus-only override**, triggered only by the @-suffix dual-identity anomaly.
- Fan-out guard (finding 6) is a **success criterion**: `user_roles` stays `many_to_one`
  (`cfm/user_roles.yml:16-18`) and is NEVER added to any preset `reachableCubes`
  (`server/src/presets/bundles/mf-users-hub.yml:25` keeps `reachableCubes: [mf_users]`).
- Per-tenant rollup schema collision already handled in `cube.js:292-293` — generator must NOT
  reintroduce per-game pre-agg name divergence.
- **[user] Scope = FULL 33-table common core.** Phase 01 canonical catalog covers ALL 33 uniform tables
  (incl. every `std_role_*` and `cons_*` mart), not a high-value subset. Phase 06 rolls out the full set.
- **[user] ptg IS in scope this round** — onboarded as the LAST sequenced game in Phase 06, with mandatory
  pre-aggs/rollups from day one (75.5M rows) + cube-serving restart handling. In-scope, isolated, last.
- **[user] Generator script = Node `.mjs` at `cube-dev/scripts/`** (submodule, co-located with output).
- **[user] Generator-as-single-source-of-truth** — re-run to regenerate; document drift risk
  (mirrors the hand-synced-mirror lesson in `preset-bundles-loader.ts:1-10`). No maintained hand-copies.

## Remaining open question — RESOLVED (Phase 05)
- **`funnel` logical-name mismatch** — NOT a typo. The 4 cvr_* metrics reference AppsFlyer acquisition-funnel
  measures (`funnel.users_completed_*`, `funnel.users_total`), a distinct not-yet-ingested cube — NOT the
  in-game `ordered_event_funnel` (which only has `step_count`). No rename; they stay correctly unavailable
  until an AppsFlyer `funnel` cube is modeled (out of scope). See reconciliation report.

## Phase files
- `phase-01-canonical-common-core-cube-spec.md`
- `phase-02-per-game-gap-matrix-and-prioritization.md`
- `phase-03-onboarding-generator-script.md`
- `phase-04-anomaly-detection-and-agent-decision-flow.md`
- `phase-05-layer2-preset-metric-reconciliation.md`
- `phase-06-per-game-rollout-with-fanout-and-preagg-guards.md`
- `phase-07-tests-and-validation-harness.md`
