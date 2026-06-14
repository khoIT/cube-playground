---
phase: 4
title: Chat-service prompt enforcement + tests
status: completed
effort: ''
---

# Phase 4: Chat-service prompt enforcement + tests

## Overview

The server fallback (Phase 3) guarantees a chart even if the model is silent. This phase adds the
"prompt" half of the user's "both" decision: nudge the LLM to emit a *good* chart proactively (better
type/encoding than a generic fallback), so the deterministic net is the safety floor, not the norm.

## Related Code Files

- Modify: `chat-service/.claude/commands/cube-playground.md` (the master command) — add a concise
  directive: every analytical turn that emits a query artifact SHOULD pass a `chart` describing the same
  data, choosing the type from the data shape (time→line, category→bar, part-of-whole→stacked-bar/pie,
  two-metrics→scatter/dual). Keep it short; do not bloat the prompt.
- Read for context: `chat-service/src/tools/emit-query-artifact.ts` (the `chart` field description at
  `:44-47`), `chat-service/src/tools/emit-chart.ts` (standalone chart tool description) — keep tool
  descriptions and the command guidance consistent (embed chart in the artifact, don't double-emit).

## Implementation Steps

1. Add the chart-always guidance to the master command, framed as "prefer emitting a chart; the server
   will add a basic one if you don't, but yours will be better-typed."
2. Tighten the `emit_query_artifact.chart` field description to encourage it (without making it
   `required` — the schema stays optional because the server guarantees the floor).
3. Add a small eval/integration assertion if the test harness supports it: a representative analytical
   prompt yields an artifact with a chart (covered already by Phase-3 fallback, but assert the model
   path too if feasible). If live-LLM eval isn't deterministic in CI, document it as a manual check.

## Success Criteria

- [ ] Master command instructs the model to emit a chart with every query artifact.
- [ ] Tool field descriptions consistent with the command + the new fallback.
- [ ] No prompt regressions (existing chat-service prompt/integration tests pass).

## Risk Assessment

- Prompt changes are low-risk but can shift model behavior subtly. Keep the edit minimal and additive;
  the deterministic fallback means even a prompt miss can't produce a chart-less artifact.
