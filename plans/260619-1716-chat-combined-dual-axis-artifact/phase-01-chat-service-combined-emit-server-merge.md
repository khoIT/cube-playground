---
phase: 1
title: "Chat-service combined emit + server merge"
status: completed
priority: P1
effort: "1.5d"
dependencies: []
---

# Phase 1: Chat-service combined emit + server merge

## Overview

New `emit_combined_artifact` tool the LLM calls with two CubeQueries. Server validates they are
mergeable, loads both row sets, **aligns them on the date VALUE** (full-outer over the union of
dates), builds a `dual-axis` ChartSpec using the EXISTING `{category,value,series}` encoding, and
emits ONE `query_artifact` carrying both queries. On rejection it emits the two single artifacts
itself (deterministic fallback). Ships the combined chat card independently.

## Requirements

- Functional: one combined card (bar = primary measure / left axis, line = overlay measure / right)
  when the two queries share grain + resolved range; otherwise the SAME tool emits two normal cards
  server-side (no reliance on the model retrying).
- Non-functional: merge before SSE emit (emission is synchronous/live — no post-process). Reuse
  `loadCubeRowsCovered`. The combined artifact must round-trip through persistence AND the
  cache-replay path without corruption.

## Architecture

- New tool `chat-service/src/tools/emit-combined-artifact.ts`, registered in the tool REGISTRY
  (`chat-service/src/tools/registry.ts`). Turn loop is `chat-service/src/core/claude-runner.ts`
  (NOT `turn.ts` — does not exist).
- Input schema `{ title, summary, primary: CubeQuerySchema, overlay: CubeQuerySchema, source? }`.
- `canMerge(primary, overlay)` guard (new `chat-service/src/tools/can-merge-queries.ts`, shared with
  Phase 5 tests): exactly one `timeDimensions` entry each, identical granularity, disjoint measures.
  Returns typed reason on reject.
- **Merge on date value** — new `chat-service/src/tools/merge-on-date-value.ts`: strip the cube
  prefix from each query's date column, project both row sets onto a synthetic `__date` key, and
  **full-outer** join over the union of dates → `{ __date, <primaryMeasure>, <overlayMeasure> }[]`
  (a missing day in either series renders null, never drops the date). Do NOT use the builder's
  `merge-by-dim-key` (keys on cube-prefixed member name → no overlap across cubes; red-team C1/C2).
- **Coverage-snap guard (H8):** after `loadCubeRowsCovered` on each, compare the two resolved
  `snappedRange`s; if they differ (cubes at different freshness with a relative range), refuse →
  two-card fallback. The pre-load `canMerge` range check is necessary but not sufficient.
- `ChartSpec` (`chat-service/src/services/chart-spec.ts`): add a `dual-axis` member to the Zod
  discriminated union using the existing `SeriesEncoding` (`{ category, value, series }`) — category
  = `__date`, value = primary measure, series = overlay measure. Do NOT invent `{x,left,right}`
  (the FE renderer reads `encoding.value`/`encoding.series`; red-team C3).
- Assemble `QueryArtifact`: `query = primary` (back-compat single-query consumers), add
  `overlay: CubeQuery` + `combined: true`; `chart` = the merged dual-axis ChartArtifact with merged
  `data`. Deeplink/payload handled in Phase 2 (forced session-storage + sibling key).
- **Cache-replay (H10):** `chat-service/src/cache/refresh-cached-artifacts.ts:159` reloads
  `src.query` (primary only) and rebuilds the chart — for a `combined` artifact this drops the
  overlay. Teach the refresh path to reload BOTH (`query` + `overlay`) and re-merge when
  `artifact.combined`, OR skip refresh for combined artifacts (push as-is). Likewise
  `server/src/services/golden-query-seeder.ts:89` must seed `overlay` too.

## Related Code Files

- Create: `chat-service/src/tools/emit-combined-artifact.ts`
- Create: `chat-service/src/tools/can-merge-queries.ts`
- Create: `chat-service/src/tools/merge-on-date-value.ts`
- Modify: `chat-service/src/tools/registry.ts` (register tool)
- Modify: `chat-service/src/types.ts` (`QueryArtifact.overlay`/`combined`)
- Modify: `chat-service/src/services/chart-spec.ts` (`dual-axis` variant, SeriesEncoding)
- Modify: `chat-service/src/cache/refresh-cached-artifacts.ts` (combined-aware reload+merge / skip)
- Modify: `server/src/services/golden-query-seeder.ts` (seed `overlay`)
- Read: `chat-service/src/services/load-cube-rows.ts`, `chat-service/src/core/claude-runner.ts`,
  `chat-service/src/tools/emit-query-artifact.ts` (extract a shared two-card emit helper for the
  fallback — DRY, no behaviour change to the single path)

## Implementation Steps

1. `can-merge-queries.ts` (`canMerge` + reason enum); unit-tested first in Phase 5.
2. `merge-on-date-value.ts` (prefix-strip + full-outer on `__date`).
3. `chart-spec.ts`: add `dual-axis` to the union via `SeriesEncoding`.
4. `types.ts`: `QueryArtifact.overlay` + `combined`.
5. `emit-combined-artifact.ts`: validate → load both → snapped-range guard → merge → build spec →
   emit ONE artifact; on any reject reason → emit two single artifacts via the shared helper.
6. Register in `registry.ts`; tool description tells the model WHEN to combine (two metrics, same
   daily axis, same range) — but correctness never depends on it (server enforces + falls back).
7. Combined-aware `refresh-cached-artifacts.ts` + `golden-query-seeder.ts`.

## Success Criteria

- [ ] "query paying DAU và revenue theo ngày" → ONE combined dual-axis card.
- [ ] Incompatible pair (different grain / divergent snapped range) → exactly TWO cards, no empty
      series, no missing artifact.
- [ ] Persisted artifact carries `overlay` + dual-axis chart; survives a cache-replay refresh
      without dropping the overlay series.
- [ ] `emit_query_artifact` single path unchanged.

## Risk Assessment

- Axis scale mismatch (DAU ~40k vs VND ~8M) — two independent axes; single axis would flatten one.
- Revenue measure may be cfm-only (memory: per-game parity gap) — consider a "measure missing in
  game" reject reason (open question in plan.md).
- Code comments/filenames describe behaviour, not plan/phase labels.
