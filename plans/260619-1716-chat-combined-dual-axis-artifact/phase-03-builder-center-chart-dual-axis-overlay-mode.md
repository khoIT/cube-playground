---
phase: 3
title: "Builder center-chart dual-axis (overlay mode)"
status: completed
priority: P1
effort: "2.5d"
dependencies: [2]
---

# Phase 3: Builder center-chart dual-axis (overlay mode)

## Overview

`/build` consumes the combined deeplink: loads the primary into builder state as today, reads the
overlay query into a **dedicated `overlayQuery` builder-state field**, loads it, merges on the date
value, and renders the merged dual-axis in the **center** by reusing `AssistantChartSection`
(embedded) — **no net-new renderer, no compare-engine reuse**.

## Requirements

- Functional: combined deeplink opens with the primary in the builder; center shows bar (primary,
  left) + line (overlay, right) aligned on the date value; editing the primary updates its series.
- Non-functional: when `overlayQuery` is null the center path is byte-unchanged. The Compare tab
  (prev-period / other-game) is untouched and works independently.

## Architecture

- **Deeplink consumption (red-team C4)** — `src/components/PlaygroundQueryBuilder/QueryBuilderContainer.tsx`
  (~line 313 / the `chatPayloadRef` resolution at :454-467): when the URL carries `combined=1`, after
  applying the primary `payload` as today, ALSO read the sibling key
  `gds-cube:pending-chat-deeplink-overlay:<id>` and set `overlayQuery`. Single payloads unchanged.
  Mind the known deeplink-consume guards (stale toast, `lastAppliedQueryKey` skip-path,
  `autoRunTrigger` refire).
- **`overlayQuery` builder state (red-team M13)** — add `overlayQuery: CubeQuery | null` to the
  builder context/state (`src/QueryBuilderV2/context.tsx` / `QueryBuilderInternals.tsx`). It is its
  OWN field, NOT a `CompareSetting` variant; the compare engine is not touched.
- **Overlay load + merge** — load `overlayQuery` (reuse the builder's existing cube `/load` path),
  then merge with the primary result via a shared FE `mergeOnDateValue`
  (`src/charts/merge-on-date-value.ts` — full-outer on the prefix-stripped date value; mirrors the
  chat-service util). Do NOT use `merge-by-dim-key` (keys on cube-prefixed member → no overlap).
- **Center render reuses `AssistantChartSection` embedded (red-team H6)** — it is ResultSet-free,
  zero chat-coupling (`assistant-chart-section.tsx:33-47`), and renders dual-axis from plain rows
  (`1 category + 2 metrics`, :478-516). When `overlayQuery != null` and merged rows exist, the center
  host (`QueryBuilderChart.tsx` / `QueryBuilderChartResults.tsx`) renders `<AssistantChartSection
  embedded>` fed a `dual-axis` ChartSpec built from the merged rows; otherwise the normal
  `PlaygroundChartRenderer`. Shared formatters (`detectColumnUnit`/`formatAxisValue`/`labelOf`) are
  IMPORTED, never re-ported — lift them to `src/charts/` if they currently live under `src/pages/Chat/`.

## Related Code Files

- Create: `src/charts/merge-on-date-value.ts` (shared by builder center + dashboard tile)
- Modify: `src/components/PlaygroundQueryBuilder/QueryBuilderContainer.tsx` (combined consumption → overlayQuery)
- Modify: `src/QueryBuilderV2/context.tsx` + `QueryBuilderInternals.tsx` (`overlayQuery` state + overlay load)
- Modify: `src/QueryBuilderV2/QueryBuilderChart.tsx` (+/QueryBuilderChartResults.tsx) (center branch → embedded AssistantChartSection)
- Possibly move: chart-value formatters from `src/pages/Chat/components/` → `src/charts/` (shared)
- Read: `src/pages/Chat/components/assistant-chart-section.tsx`, `format-chart-value.ts`, `chart-column-labels.ts`

## Implementation Steps

1. `merge-on-date-value.ts` (FE) — date-value full-outer, mirrors chat-service util.
2. Add `overlayQuery` to builder state + an effect that loads it when set.
3. `QueryBuilderContainer`: detect `combined=1` → apply primary + read sibling key → set overlayQuery.
4. Center host: when overlayQuery + merged rows, render embedded `AssistantChartSection` with a
   `dual-axis` spec; else unchanged.
5. Verify Compare tab (prev/other-game) still renders — orthogonal, untouched.

## Success Criteria

- [ ] Combined deeplink → center shows merged bar+line dual-axis on the date axis.
- [ ] Editing the primary updates the bar; overlay line stays pinned to its query.
- [ ] Non-overlay builder sessions render exactly as before (center unchanged).
- [ ] Compare tab prev-period/other-game still works; no formatter duplication (imports only).

## Risk Assessment

- **Hardest integration point:** the `QueryBuilderContainer` deeplink-consume seam (guard traps).
  Mitigation: the sibling-key + `combined=1` flag is purely additive to the existing consume path.
- Reusing `AssistantChartSection` in the builder: confirm `embedded` mode renders chart-body-only
  without chat chrome; if a thin wrapper is needed it carries no formatting logic of its own.
- Estimate raised to 2.5d (red-team M5): five-file change across the consume seam + state + center.
