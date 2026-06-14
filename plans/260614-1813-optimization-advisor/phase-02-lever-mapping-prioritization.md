# Phase 02 — Goal trees → lever map → prioritization (power check + Library)

## Overview
- **Priority:** P0.
- **Status:** ✅ done (2026-06-14). `server/src/advisor/`: candidate-types, lever-map (VIP-Care registry → feasibility CS=feasible / push+pricing=nearest-feasible+substitute / unmapped=infeasible sentinel), power-check (two-proportion MDE solver; worked example powered, tiny-segment underpowered surfaced-not-hidden), money-model (₫/unit TBD → null + ranks by effect×N×confidence), treatment-effect-library + migration `053-treatment-effect-library.sql` (seeded assumption/benchmark priors incl. win-back +6pp), candidate-ranker (deterministic; win-back rank-1), llm-phrasing (cube-advisor `claude -p` default, injectable, template fallback). 44 unit tests; build clean; full 1536-test suite green. **Live LLM phrasing + write-back flywheel (`recordResult`) deferred to host/command-center.**
- Turn ranked opportunities (Phase 1) into ranked, power-checked, ₫-estimated **experiment candidates**,
  honestly gated by actuator feasibility, with expected-effect priors sourced from a Treatment-Effect Library.

## Key insights
- **Feasibility gate is a feature, not a filter to hide.** Map each opportunity → lever family → concrete
  playbook (reuse the 21 VIP-Care playbooks), then mark feasibility honestly: "this gap wants a price-anchored
  offer; we can't push offers → nearest feasible = CS-delivered offer." No vaporware recommendations. (Today: CS-only — open Q#2.)
- **The realism gate competitors skip = power/MDE check.** `N × reachable% → detectable lift in window at
  80% power`. Segments too small to move are flagged, not recommended.
- **Expected-effect priors carry a confidence label** (locked #3): (1) own past experiments = highest,
  (2) cross-segment benchmark, (3) game-ops default = "assumption". Ranking must never present (3) as (1).
- **The Library is the flywheel** — empty at first, fills as command-center experiments complete and write back.

## Requirements
Functional:
1. `lever-map.ts` — opportunity.factor → lever family → playbook(s) from the VIP-Care registry; attach feasibility verdict + actuator.
2. `power-check.ts` — `mde(N, reachablePct, window, baselineRate, alpha, power)` → detectable lift + verdict (`powered`/`underpowered`). Two-proportion / mean test as fits the factor.
3. `money-model.ts` — `expectedIncremental(gapValue, addressableN, valuePerUnit)` using agreed ₫-per-unit factors (open Q#4). Per-currency for jus.
4. `treatment-effect-library.ts` — store + read priors keyed by `(game, segment-shape, lever)`; returns prior + confidence + source. SQLite (new migration after `052`, the command-center one).
5. `candidate-ranker.ts` — score = `addressable_N × expected_effect × value_per_unit × feasibility × confidence ÷ effort`; emit ranked `ExperimentCandidate[]`.
6. **LLM phrasing pass** — feed diagnosis + matched playbook into the cube-advisor `claude -p` pattern to produce 3 phrased, defensible hypotheses. **LLM proposes wording; data ranks.** (Reuse sibling cube-advisor; do not rebuild.)

Non-functional: deterministic scoring given inputs; LLM pass is additive phrasing only (never reorders); all priors labeled.

## Related code files
Create (`server/src/advisor/`): `lever-map.ts`, `power-check.ts`, `money-model.ts`, `treatment-effect-library.ts`, `candidate-ranker.ts`, `candidate-types.ts`.
Migration: `server/migrations/053_*.sql` (Treatment-Effect Library tables) — confirm latest is `052` (command-center) before numbering.
Read: VIP-Care playbook registry + `threshold-rule.ts`; cube-advisor `claude -p` spawn; command-center plan §scorecard (where results write back from).

## Implementation steps
1. `candidate-types.ts` + `lever-map.ts` against the VIP-Care registry; encode CS-only feasibility today.
2. `power-check.ts` with the standard sample-size formula; verify the worked example ("N=2,400, 78% reachable → ≥4pp in 14d").
3. `money-model.ts` once ₫-per-unit factors agreed (open Q#4); jus per-currency.
4. `treatment-effect-library.ts` + migration `053`; seed labeled game-ops defaults (assumption), incl. the win-back +6pp prior.
5. `candidate-ranker.ts`; then the LLM phrasing pass (additive).
6. Compile + a ranking smoke test on the worked example → win-back is rank 1.

## Todo
- [x] `candidate-types.ts` + `lever-map.ts` (feasibility-gated, CS-only)
- [x] `power-check.ts` (MDE + verdict)
- [x] `money-model.ts` (₫-per-unit, jus per-currency) — TBD path implemented; Q#4 still open
- [x] `treatment-effect-library.ts` + migration `053` (labeled defaults)
- [x] `candidate-ranker.ts`
- [x] LLM phrasing pass (cube-advisor pattern, additive; deferred to host)
- [x] ranking smoke test → win-back rank 1 on `5ee78131…` (candidate-ranker.test.ts)

## Success criteria
- `5ee78131…` / Revenue↑ → ranked candidates with win-back rank 1, a `powered` verdict, an expected-incremental-₫ figure, and a labeled prior source.
- An underpowered small segment surfaces with an explicit `underpowered` flag, not silently ranked low.
- Every expected-effect shows confidence + source (own / benchmark / assumption).

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| ₫-per-unit factors unagreed → ranking arbitrary | M×H | block money-model on Q#4; until then rank by effect×N×confidence and label ₫ "TBD". |
| LLM reorders / invents lift | M×H | LLM is phrasing-only; ranker is deterministic; numbers come from Library, not the model. |
| Cold-start priors over-trusted | M×M | mandatory confidence label; UI (Phase 3) renders "assumption" distinctly. |
| Playbook ↔ lever mismatch | L×M | map via the existing registry; unmapped factor → "no feasible lever yet", not a fabricated one. |

## Security (PII)
Operates on aggregates + priors; no member contact data. Library keyed by segment-shape, not individuals.

## Next steps
Phase 3 renders candidates as cards (Recommend posture). Phase 4 hands the chosen candidate to the command center and writes results back to the Library.
