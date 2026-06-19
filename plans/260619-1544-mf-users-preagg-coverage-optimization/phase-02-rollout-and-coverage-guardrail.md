# Phase 02 — Roll out to 8 games + coverage guardrail

**Priority:** P1. **Status:** DONE (19 Jun). **Goal:** replicate the
proven fix across all games carrying `mf_users`, and add a guardrail so future rollup-miss
regressions are caught.

> **Outcome:** 6 games (ballistar, cros, muaw, ptg, pubg, tf) MIGRATED from partitioned+lambda
> to the proven non-partitioned shape + LTV measures + per-game churn_risk/engagement dims +
> segments; jus extended; cfm from phase-01. All 8: routing HIT (26/26) + serving sub-second,
> verified live. Builds sealed via one all-games sweep; worker restored to default. Guardrail
> `cube-dev/scripts/check-mf-users-rollup-coverage.py` added — PASS + demonstrably catches a
> break. Both stacks share ONE model dir (no separate prod registry) → prod picks up on
> deploy-restart, which MUST be followed by a build sweep (else serve-error window). Per-game:
> ptg has 0 payers (all non_payer) — correct, not a bug. ballistar/muaw/pubg cohort rollup
> carries payer_tier so payer_tier×ltv routes there (also correct).

## Pre-flight (informational, NOT a stop — user locked "roll out all")

- Record the phase-00 prod-frequency finding for context, but proceed to all 8 games
  regardless (decision locked 19 Jun).

## Games in scope

`mf_users` pre-aggs exist in: ballistar, cfm, cros, jus, muaw, ptg, pubg, tf
(`cube-dev/cube/model/cubes/*/mf_users.yml`). Per-game raw tables are byte-identical
([[standard-cube-model-onboarding-plan]]), so the cfm_vn rollup shape should port — but
verify per game: column names (e.g. `unified_first_country_code`), snapshot field presence,
and that the chosen time/snapshot dim exists.

## Steps

1. Port the cfm_vn rollup(s)/originalSql to each game's `mf_users.yml`. Prefer the generator
   if one is truth ([[standard-cube-model-onboarding-plan]]); else hand-port + per-game verify.
2. Reload, rebuild, confirm SEALED for each game (sweep board; [[cubestore-introspection-and-probe-hardening]]).
3. Per game: re-run the miss→hit `/sql` probe (workspace local, x-cube-game=<game>) — compiled
   SQL must show the rollup/snapshot path, no `etl_ingame_moneyflow`.
4. Land in BOTH dev + prod-docker registries ([[workspace-config-roll-out-both-stacks]]); deploy
   (`second` remote auto-deploys, [[prod-deploy-and-local-vs-prod-debug]]); restart cube_api +
   worker so new rollups route ([[cube-serving-instance-needs-restart-for-new-rollups]]).

## Coverage guardrail (prevent regression)

5. Add a check (extend the existing readiness/preagg probe harness) that runs the known
   segment/member query signatures through `/sql` per game and asserts `external:true`.
   Wire into the pre-push gate or the sweep monitor so a future model edit that breaks
   coverage is visible. Keep it data-shape-based, not finding-coded (naming rules).

## Success criteria

- All 8 games: target shapes `external:true`, verified per game.
- Sweep stays SEALED / bounded duration after added rollups.
- Guardrail catches an intentionally-broken probe (test it).
- docs/lessons-learned.md updated if a new trap surfaced; docs/codebase-summary refreshed if
  model surface changed materially.

## Open questions

- Does any game lack a needed snapshot field (forcing upstream/C for that game only)? Record
  per-game exceptions rather than forcing a uniform rollup.
