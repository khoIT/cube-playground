---
phase: 0
title: "Chat-agent resolution-baseline harness (accuracy guard)"
status: pending
priority: P1
effort: "3h"
dependencies: []
---

# Phase 0: Chat-agent resolution-baseline harness

## Overview
Before touching the catalog, capture how `chat-service` resolves cfm_vn questions to
metrics/cubes/queries **today**, as a frozen baseline. This is the safety net that proves
the curation + reseed + rollup work does not regress agent accuracy. Re-run as the gate
after Phases 2, 4, 5.

## Why (red-team finding)
The catalog is the agent's retrieval vocabulary (`tools/list-business-metrics`,
`nl-to-query/synonym-resolver`, `core/starter-question-*`). Pruning/adding/reseeding moves
accuracy in both directions. No eval set exists today → "did accuracy drop?" is currently
unanswerable. Fix that first.

## Requirements
- Functional:
  1. **Build the eval corpus** (greenfield): cfm_vn NL questions → expected
     `{metric_id, backing_cube, key measures/dims, query-shape class}`. Source questions from
     (a) the current `starter-questions.ts` + chat-service starter templates, (b) prior chat
     history if recoverable. The forward/regression set is seeded from the NEW questions
     (Phase 5), but the BEFORE baseline is captured on the CURRENT set so we have an apples
     comparison the moment we start editing.
  2. **Capture current behavior**: run each question through chat-service locally, record the
     resolved metric/cube + emitted query. Save as the immutable baseline snapshot.
  3. **Verify ARPDAU query shape specifically** (red-team Q4): does
     `tools/emit-query-artifact` / `preview-cube-query` emit the combined 2-measure
     `[recharge.revenue_vnd, active_daily.dau]` query (the fanout) or already blend? Record —
     this decides whether Phase 3/4's ratio reshape is a cross-repo agent change or a no-op.
  4. **Scorer**: a diff that, given baseline vs a re-run, reports per-question
     match/mismatch on resolved metric + cube (query-shape change flagged, not auto-failed).
- Non-functional: deterministic enough to compare (pin model/temp where the harness allows;
  subscription-auth lane per chat-service norms; don't burn the gateway key on batches).

## Architecture
Harness lives in `chat-service` (its own test/eval dir). Drive the real resolution path
(`resolve-query-terms` → `synonym-resolver` → metric/cube selection), not a mock, so it
measures true behavior. Baseline = checked-in JSON snapshot keyed by question.

## Related Code Files
- Read: `chat-service/src/tools/{list-business-metrics,get-business-metric,resolve-query-terms,emit-query-artifact,preview-cube-query}.ts`, `chat-service/src/nl-to-query/synonym-resolver.ts`, `chat-service/src/core/starter-question-*.ts`
- Create: `chat-service/test/metric-resolution-eval/` (corpus + runner + scorer + baseline snapshot)
- Create: `plans/.../reports/cfm-vn-chat-resolution-baseline-report.md`

## Implementation Steps
1. Enumerate the resolution entrypoint chat-service uses for a question → metric/cube.
2. Author the corpus (start ~25–40 cfm_vn questions spanning all domains + the metrics most
   likely affected by curation: duplicates like revenue/gross_bookings, multi-source ones
   like paying_users vs paying_users_30d, arpu vs arppu).
3. Run live against current chat-service; snapshot baseline; record ARPDAU shape.
4. Implement the scorer + a single command to re-run + diff vs baseline.

## Success Criteria
- [ ] Baseline snapshot committed; every corpus question has a recorded current resolution.
- [ ] ARPDAU current query shape documented (combined vs blend).
- [ ] Scorer runs and reports a clean diff (0 changes) against the just-captured baseline.

## Risk Assessment
- LLM nondeterminism → resolution may vary run-to-run. Mitigate: run N times, treat stable
  majority as baseline; scorer tolerates known-flaky items (flag, don't hard-fail).
- Local auth: use subscription lane (host dev service has token; Docker doesn't).

## Next steps
Gate for Phases 2/4/5. Corpus extended with Phase-5 new seeds once the final list exists.
