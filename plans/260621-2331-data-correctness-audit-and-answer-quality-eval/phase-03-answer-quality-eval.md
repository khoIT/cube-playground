# Phase 03 — Answer-quality eval (Idea 2, reach)

**Priority:** P1 · **Status:** 📋 planned · **Depends on:** Phase 01 (corpus), Phase 02 (trusted numbers)

## Overview

Generalize the cfm_vn-only `metric-resolution-eval` harness to **all games**, driven by the Phase 01 question bank, and extend scoring beyond "right metric/cube" to the full silent-failure surface: empty range, refused/errored, trust-guard misfire. Output = per-game answer-quality scorecard + frozen baselines; runs periodically, not a hard CI gate.

## Why after Phase 02

The eval scores whether chat *routes* to the right measure and returns a non-empty answer — it cannot tell a right number from a wrong one. Only once Phase 02 certifies the underlying measures does an 85% answer-quality score mean "the product answers correctly" rather than "the product confidently returns wrong numbers 85% of the time."

## What exists vs the gap

| Have (`metric-resolution-eval`) | Gap to close |
|---|---|
| SSE `/agent/turn` runner, baseline-vs-rerun scorer, verdict semantics | Drive from Phase 01 bank, all games (today: cfm_vn only) |
| Scores metric/cube resolution + query shape | Add: **non-empty range**, **answered-vs-refused**, **trust-guard-fired** dimensions |
| Subscription-lane run flow documented | Per-game baselines + a roll-up scorecard report |

## Scoring dimensions (per case)

1. **Resolution** — emitted `cube.measure` == golden ref (existing). For synthesized cases the golden is deterministic; for asked-tail cases, score loosely.
2. **Non-empty range** — artifact has rows (catches empty-window / coverage-snap failures, `[[chat-empty-range-coverage-snap]]`).
3. **Answered vs refused** — did it produce an artifact at all vs decline/error.
4. **Trust-guard fired** — for measures with known trust caveats, did the trust rail surface (`[[chat-diagnostic-prescriptive-rail]]`, `[[metric-trust-audit-playbook]]`).

## Related code files

- **Modify:** `chat-service/test/metric-resolution-eval/metric-resolution-runner.ts` — accept per-game bank path; loop games.
- **Modify:** `metric-resolution-scorer.ts` — add the 3 new dimensions to the verdict + report.
- **Create:** `chat-service/test/eval/answer-quality-scorecard.ts` — roll up per-game snapshots → scorecard.
- **Output:** per-game `{game}-baseline-snapshot.json`; scorecard under this plan's `reports/`.

## Implementation steps

1. Parameterize runner by `gameId` + bank path; preserve the frozen cfm_vn baseline as-is.
2. Extend scorer verdicts with non-empty / answered / trust-guard checks.
3. Run on the **subscription lane** (PUT `/internal/llm-auth-mode {mode:subscription}` first — `[[batch-llm-verification-subscription-auth-first]]`); host dev service holds the token, Docker doesn't.
4. Capture per-game baselines (start with cfm_vn + jus_vn, then expand).
5. Build scorecard; identify worst-failing (game, metric, dimension) cells as the fix worklist.
6. Verify renders in BOTH chat surfaces where relevant (`[[chat-feature-parity-two-surfaces]]`).

## Success criteria

- Eval runs across all modeled games from the Phase 01 bank.
- Scorecard reports per game: resolution %, non-empty %, answered %, trust-guard-correct %.
- Worst cells produce an actionable worklist (the "where does the product silently fail" deliverable).
- Re-runnable for regression diffing against frozen baselines.

## Risks / mitigations

- **LLM token burn + auth fragility** (`[[llm-gateway-key-sonnet-only]]`, `[[anthropic-key-failover-chat-service]]`): subscription lane only; batch off-peak; cap corpus size per run.
- **Nondeterminism:** treat as periodic eval, not hard gate; score trends, not single runs. Query-shape changes flagged not failed (existing semantics).
- **Empty-on-local ≠ bug:** local lacks some billing data (`[[ops-charts-reuse-chat-renderer]]`) → run where data exists, or mark known-empty cases.

## Unresolved questions

- Q1: Which env is the eval run-of-record — local dev service, or `playground.gds.vng.vn` (real data)? Non-empty scoring is meaningless without data.
- Q2: Trust-guard-fired check needs a per-measure expected-trust map — derive from `audit:metric-trust` output, or annotate in the bank?
