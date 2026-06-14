---
phase: 3
title: Chat-service deterministic chart fallback
status: completed
effort: ''
---

# Phase 3: Chat-service deterministic chart fallback

## Overview

Guarantee (software-level) that an emitted query artifact carries a chart. When the LLM omits `chart`
or `buildChartArtifact` fails, the handler executes the query, derives a chart spec deterministically
from the query shape + result rows, and attaches it. This closes the gap at
`emit-query-artifact.ts:156-169` where a missing/failed chart silently ships chart-less.

## Key Insight

`emit_query_artifact` does NOT currently execute the query — it only builds a deeplink. ChartSpec
requires `data.min(1)`, so the fallback MUST fetch rows. chat-service already has a cached `/load`
executor inside `preview-cube-query.ts:128` — factor it out and reuse (incl. `load-cache-adapter`) to
avoid a second uncached round-trip.

## Related Code Files

- Create: `chat-service/src/services/load-cube-rows.ts` — extract the `/load` fetch + cache logic from
  `preview-cube-query.ts` into a reusable `loadCubeRows(query, ctx, { maxRows })` returning rows.
  Refactor `preview-cube-query.ts` to call it (no behavior change; keep its 50-row cap + empty-result
  no-cache rule).
- Create: `chat-service/src/services/derive-chart-spec.ts` — pure `deriveChartSpec(query, rows, meta)`:
  - has `timeDimensions[0].granularity` → `'line'` (or `'multi-line'` when a non-time dimension also
    present), `encoding.category` = the time dim member, `value` = first measure.
  - exactly one non-time dimension, ≥1 measure → `'bar'` (`category` = dimension, `value` = first
    measure); if a 2nd grouping dimension → `'stacked-bar'` with `series`.
  - measures-only, no dimension → `'bar'` single row (or omit — see decision below).
  - ≥2 measures, single category → keep first measure as `value`, optionally set `series` to the 2nd
    so the FE dual-axis can engage. Returns `null` when it can't form a sensible spec (e.g. 0 rows) —
    caller then ships chart-less (documented residual edge).
  - Builds rows in the `{memberRef: value}` shape ChartSpec expects, bounded to `MAX_ROWS`.
- Modify: `chat-service/src/tools/emit-query-artifact.ts` — in step 4, when `!args.chart` OR the
  try/catch fails: `const rows = await loadCubeRows(normalizedQuery, ctx, {maxRows: MAX_ROWS}); const spec = deriveChartSpec(normalizedQuery, rows, meta); if (spec) chart = buildChartArtifact(spec, {artifactRef});`
  then resolve `columns` exactly as the existing path. Wrap in try/catch so a fallback failure still
  emits the artifact (never throw). Log when fallback fires (telemetry).
- Read for contract: `chat-service/src/services/chart-spec.ts` (`ChartSpecSchema`, `buildChartArtifact`,
  `MAX_ROWS`), `chat-service/src/core/cube-meta-capability.ts` (`resolveMemberMeta`),
  `chat-service/src/tools/preview-cube-query.ts` (the `/load` call being extracted),
  `chat-service/src/types.ts` (`ToolContext`).

## Decisions to confirm during cook (do not guess silently)

- **measures-only queries:** chart it as a 1-bar/number, or legitimately skip? Recommendation: skip
  (a single bar adds no insight) and rely on the prompt to prefer time/dimension queries. Confirm.
- **Always-execute vs only-on-missing:** only execute when chart missing/failed (keeps latency off the
  common path where the LLM already supplied a chart). Locked: only-on-missing.
- **Validate the LLM-supplied chart, then fallback?** If `args.chart` is present but invalid (current
  catch), the fallback should still run (derive from rows) instead of shipping chart-less. Yes — run
  fallback on BOTH absence and build failure.

## Implementation Steps

1. Extract `loadCubeRows`; refactor `preview-cube-query` to use it; run its existing tests.
2. Write `derive-chart-spec.ts` + `derive-chart-spec.test.ts` (pure, table-driven over query shapes).
3. Wire the fallback into `emit-query-artifact.ts` (only-on-missing/failure; never throw).
4. Add/extend an integration test: emit a query artifact WITHOUT a chart → assert the emitted artifact
   has a non-null `chart` with a spec matching the query shape (time→line, dim→bar).

## Success Criteria

- [ ] `loadCubeRows` extracted; `preview-cube-query` behavior unchanged (its tests pass).
- [ ] `deriveChartSpec` covers time/dimension/series/measures-only; unit-tested.
- [ ] `emit_query_artifact` attaches a chart when the LLM omits/breaks one (integration-tested), and
      still ships the artifact if the fallback itself fails.
- [ ] No latency added to the path where the LLM already supplied a valid chart.
- [ ] chat-service `tsc`/build + tests pass.

## Risk Assessment

- Extra `/load` per chartless turn → mitigated by cache reuse + only-on-missing.
- Deriving a wrong-but-valid chart is better than none, but avoid misleading defaults (e.g. don't
  stacked-bar a high-cardinality dimension — cap to top-N via existing `truncateTopN`).
