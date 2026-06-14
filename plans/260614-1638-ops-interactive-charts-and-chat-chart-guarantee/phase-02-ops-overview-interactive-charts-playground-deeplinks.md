---
phase: 2
title: Ops Overview interactive charts + Playground deeplinks
status: completed
effort: ''
---

# Phase 2: Ops Overview interactive charts + Playground deeplinks

## Overview

Wire the Phase-1 building blocks into the Ops Overview tab: replace the three `OpsLineTrend`/
`OpsStackedTrend` charts with `AssistantChartSection`, each driven by an `ops-chart-artifact` built from
the live `useOpsOverview` data, and each carrying an "Open in Playground" header action that deeplinks
to the underlying Cube query.

## Related Code Files

- Modify: `src/pages/OpsConsole/overview-tab.tsx` — swap the three chart JSX blocks for
  `<AssistantChartSection artifact={...} headerAction={<OpenInPlayground query={...} />} />`. Keep the
  surrounding grid/layout + the rest of the panels untouched.
- Modify: `src/pages/OpsConsole/use-ops-overview.ts` — expose the per-chart Cube queries already built
  in `ops-overview-queries.ts` (or rebuild them in the tab) so the deeplink targets the exact query
  feeding each chart: cash-daily → `billingDailyTrendQuery`; payers-vs-cash → same daily query
  (cash+payers measures); gateway-mix → `gatewayTrendQuery`.
- Create: `src/pages/OpsConsole/open-in-playground.tsx` — small link/button using
  `buildPlaygroundDeeplink` (`src/utils/playground-deeplink.ts:140`) → `#/build?query=…`; matches design
  tokens; opens the playground with that query. Reuse existing playground-deeplink semantics (inline vs
  session-storage handoff) — do not hand-roll URL encoding.
- Delete/retire: `OpsLineTrend`/`OpsStackedTrend` usage in overview-tab. Keep `ops-trend-chart.tsx`
  only if still referenced elsewhere (grep first); if nothing else uses it, remove the file.
- Read for contract: `src/utils/playground-deeplink.ts` (`DeeplinkInput`/`buildPlaygroundDeeplink`),
  `src/pages/OpsConsole/ops-overview-queries.ts`.

## Implementation Steps

1. Grep for other `OpsLineTrend`/`OpsStackedTrend` consumers. If none beyond overview-tab, plan to
   delete `ops-trend-chart.tsx` after the swap; otherwise leave it.
2. Build `OpenInPlayground` — props `{ query: CubeQuery; label?: string }`. Render a subtle
   token-styled link ("Open in Playground ↗"). On click, build the deeplink and navigate
   (`window.location.hash = deeplink.url` or `<a href>`); for session-storage `via`, write payload first
   exactly as the existing helper expects.
3. In overview-tab, construct the three artifacts from `d.daily` / `d.gatewayDays` + `d.gatewayDates`
   via the Phase-1 builders, memoized on the data. Pass the matching Cube query into `headerAction`.
4. Confirm the dual-axis chart (payers-vs-cash) defaults to the dual-axis view (per Phase-1 result).
5. Keep loading/empty/error states coherent: while `d.loading`, render the existing skeleton (don't
   mount the artifact with empty data — the renderer needs ≥1 row); on empty window, show the chart's
   own empty state or skip.
6. Visual cross-check against an adjacent page (Dashboards) per design-guidelines — header pattern,
   tokens, radius, spacing. Charts must look native to the console.

## Success Criteria

- [ ] All three Overview charts render via `AssistantChartSection` with working chart-type switch,
      table view, and CSV export.
- [ ] Each chart has an "Open in Playground" action that opens `/build` with the correct query.
- [ ] Loading/empty/error states behave (no crash when a window has no rows).
- [ ] Design parity with adjacent console pages (tokens only).
- [ ] `tsc` clean; `vite build` succeeds; no console errors on `/ops` for cfm_vn + jus_vn.

## Risk Assessment

- Renderer needs ≥1 data row (ChartSpec `data.min(1)`). Guard: only build/mount artifacts when data is
  present; otherwise skeleton/empty. 
- Deeplink for the dual-measure chart should carry BOTH measures so the Playground reproduces it.
