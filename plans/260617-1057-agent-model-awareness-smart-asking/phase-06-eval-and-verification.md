# Phase 06 — Eval + live verification harness

## Overview
Priority: P3 (gates the rework). Status: ☐. Agent-behavior changes can't be
proven by unit tests alone. Build a small eval that measures the actual goal:
fewer obvious questions, no wrong-grain suggestions, no re-asking.

## Key insights
- Prior advisor work established a live OAuth+Cube smoke pattern (multi-run).
  Reuse that approach for the "questions-asked-per-task" metric.
- The metrics must map 1:1 to the success criteria in `plan.md`.

## Requirements
- Functional: a fixed prompt corpus + a runner that records, per prompt:
  clarifying-turns-before-answer, grain errors, redundant `get_cube_meta` calls,
  whether locked slots were re-asked. Compare flags-off vs flags-on.
- Non-functional: runnable locally against the dev cube lane; deterministic
  scoring where possible; live LLM portion clearly separated.

## Architecture
- Corpus `chat-service/test/agent-intelligence-eval/corpus.json`: ranking
  (individuals + groups), trend, compare, recovery (unresolvable metric),
  follow-up (continuity), rephrase (must flip). Each with expected posture.
- Runner `chat-service/src/scripts/run-agent-intelligence-eval.ts`: drives
  `/agent/turn` against the dev lane, parses SSE, tallies metrics, emits JSON.
- Deterministic sub-checks as vitest where possible (grain gate, default table,
  resolved-context rendering) so CI catches regressions without the LLM.
- Live multi-run smoke (N≥3) on the OAuth+Cube lane for the guidance-dependent bits.

## Related code files
- Read: prior advisor smoke scripts, `chat-service/src/scripts/run-parallel-emit-soak.ts` (pattern).
- Create: corpus.json, runner script, vitest sub-checks.

## Implementation steps
1. Author corpus with expected behavior per prompt.
2. Build runner; capture metrics; baseline with flags off.
3. Enable flags; re-run; diff metrics; assert improvement on the success-criteria targets.
4. Add deterministic vitest for grain/defaults/continuity.
5. Live N-run smoke; screenshot monitoring/answers for the report.

## Todo
- [ ] Corpus.json (ranking/trend/compare/recovery/follow-up/rephrase)
- [ ] Eval runner + metrics JSON
- [ ] Baseline (flags off) vs treatment (flags on) diff
- [ ] Deterministic vitest sub-checks
- [ ] Live multi-run smoke + screenshots

## Success criteria
- Treatment shows ↓ clarifying turns, 0 grain errors, 0 re-asks of locked slots, ↓ meta fetches vs baseline;
  full suites green.

## Risks
- LLM nondeterminism inflates variance → N-run, report median + range, not single shot.
- Dev cube cold reads slow → use `loadWithContinueWait`; separate latency from correctness metrics.

## Open questions
- Wire the eval into CI (deterministic part only) or keep manual? Lean: deterministic part in CI, live part manual.
