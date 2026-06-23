# Plan — recover the "no-artifact" resolver gaps, across all 8 games

## Why
The cfm_vn glossary answer-quality eval left 33 questions with no chart. Triage
(snapshot `test/eval/cfm_vn-glossary-aq-snapshot.json`) shows **32 of 33 are NL
resolver gaps, not missing data** — the cube members exist, the resolver doesn't
map the word a person types to the member.

A real-data probe (2026-06-23) of all 8 modeled games then showed the fixes are
**game-generic by construction**: the members the resolver fails to map are named
**identically across every game**, and the resolver already scopes per-game via the
glossary + member-resolver seams. So this is a code-once fix that lands on all 8
games at once — plus a thin per-game verification pass, not 8 separate plans.

Diagnosis artifact: routing-diagnosis (claude.ai artifact, 2026-06-22).

## Outcome
Re-running the eval subset per game, the resolver cases answer (artifact emitted)
on every game. Target: glossary answered-rate 61% → ~95% on cfm_vn, with parity
verified on jus_vn + the other 6.

## Real-data coverage (verified 2026-06-23, `cube-dev/cube/model/cubes/*`)
8 modeled games: ballistar, cfm, cros, jus, muaw, ptg, pubg, tf.

| Member needed | Coverage | Naming variance | Consequence |
|---|---|---|---|
| platform | **all 8** | `os_platform` on mf_users/active_daily/recharge; `platform` on game_key_metrics/new_user_retention — **identical in every game** | Phase 01's `(os_)?platform` cube-relative resolve covers all 8 with zero per-game work |
| payer_tier (whale/dolphin/minnow) | **all 8** (mf_users + active_daily) | none | persona routing (Phase 02) generalizes to all 8 |
| revenue measure | **all 8** carry `revenue_vnd` (+`_total`/`_iap`/`_web`) | `revenue_vnd_real` is cfm-only but **not needed** — `revenue_vnd` is the universal money-cue default | Phase 02 money-cue default resolves on every game |
| wau / trailing_wau | **6/8**: cfm, jus, ballistar, muaw, ptg, pubg | already a measure where present | only **cros + tf** lack it; the cfm WAU eval case already resolves (`active_daily.wau`) — see Phase 03 |

Net: **no per-game member-naming variance** for the resolver fixes (consistent with
the generator-as-truth / byte-identical raw-table layout). The only true cube-model
gap is `wau` on cros + tf.

## Phases — two layers
**Layer A — code-once resolver fix (chat-service, applies to all 8 games):**

| # | phase | cases | kind | status |
|---|-------|-------|------|--------|
| 01 | [Platform dimension — cube-relative resolution](phase-01-platform-dimension-resolution.md) | 21 | resolver (chat-service) | **DONE — all 5 smoketest platform cases fixed (cfm_vn 2026-06-23)** |
| 02 | [Segment-without-metric → default metric](phase-02-segment-default-metric.md) | 11 | resolver (chat-service) | **DONE — Minnow + Whale-this-month fixed; mom cases data-blocked (1 month of test data)** |

**Smoketest result (cfm_vn, 2026-06-23):** 7/16 → **13/16 ok, zero regressions.**
The only unfixed cases are the 2 month-over-month comparisons — blocked by the
test set holding a single month (2026-06), not by the resolver. See
[smoketest-validation.md](smoketest-validation.md).

Hard rule for both: **never hardcode a cfm physical name** (`revenue_vnd_real`,
`mf_users.os_platform`, `payer_tier`). Resolve through glossary → member-resolver →
live `/meta`. Honor that and every game gets the fix on merge. Acceptance adds a
unit test that runs the resolver against ≥2 games' `/meta`, not just cfm.

**Layer B — per-game verification + parity (data, not resolver code):**

| # | phase | scope | kind | status |
|---|-------|-------|------|--------|
| 04 | [Per-game coverage + eval sweep](phase-04-per-game-coverage-and-eval.md) | 8 games | verify glossary revenue→`revenue_vnd` mapping; run per-game eval subset; record answered-rate delta | **DONE — all 8 games swept, zero true resolver regressions. Platform fix 5/5 every game; segment-default works every game. ok: pubg 15, jus/ballistar/muaw 14, cfm/cros 13, ptg/tf 12. See parity matrix + smoketest-validation.md** |
| 03 | [WAU parity (cros + tf only)](phase-03-wau-rolling-measure.md) | 2 games | cube model (cube-dev) | deferred / optional |

Phases 01 and 02 are independent — either can land first. 02 absorbs 9 persona
cases + 2 segment-mom cases. Layer B runs after Layer A merges.

## Key facts (verified in code)
- Dimension binding: `slot-extractor.ts::pickDimension` only accepts glossary
  hits classified `dimension`; "platform" is not a glossary term → fell to
  meta-fuzzy → mis-guessed `mf_users.platform`. (agent reply confirms.)
- Resolution must be **scoped to the metric's resolved cube** (os_platform on
  user/engagement cubes, platform on the UA cube) — but the names are stable
  across games, so the cube-relative resolve is the only variance to handle.
- `model-graph-digest.ts:31-37` already normalizes prefixed (`cfm_vn_mf_users`)
  vs bare (`mf_users`, game_id workspaces) base names — resolution runs on logical
  names, the cross-game seam already exists.
- `smart-defaults.ts:10-41` already resolves the default metric **per game** from
  that game's glossary (`resolveRevenueDefault`), returning a logical ref the
  member-resolver maps per workspace, with graceful ask-first fallback. Game-agnostic today.
- `active_daily` ships a `dau_by_platform_daily` rollup — DAU×platform is
  pre-aggregated and waiting.

## Validation (all phases)
Host chat-service on :3005, subscription lane (VY token), workspace=local. Per game,
targeted resume re-runs only affected cases:
`GAME=<game> GROUP=synthesized-glossary RESUME=1 RESUME_KEEP=ok PACE_MS=3000 …`
then regenerate the report and diff answered-rate. Layer B loops this over all 8.

## Decisions (locked)
1. Default metric for a bare segment+time question = **active-user count**;
   switch to **Revenue** only when the message carries a money cue
   (spend/revenue/ARPU/…). Decided by user 2026-06-23.

## Open questions
2. Per-game glossary revenue mapping: confirm each game's glossary `revenue`
   concept points to `revenue_vnd` (present in all 8) and not a cfm-only ref like
   `revenue_vnd_real` (which would silently fall to ask-first on other games).
   Resolved in Phase 04 step 1.
3. The single failing cfm WAU case is the **mom-comparison** form, not the plain
   "show WAU" form (which already resolves). Confirm whether the mom path fails for
   a measure reason or a compareDateRange reason before scoping Phase 03 work.
