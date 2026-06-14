---
phase: 4
title: chart-adapters-overview-layout
status: completed
effort: 2h
---

# Phase 4: Chart adapters + Overview layout redesign

## Overview

**Priority:** P2 · **Status:** pending · **Depends on:** P3 (shaped data). Heatmap cell only
populates after P1 deploys.

Add new artifact adapters to `ops-chart-artifact.ts`, then rewrite `overview-tab.tsx`'s trend
grid to MAX 2/row per the locked layout. Reuse `dualMeasureArtifact` where possible (DRY) —
two of the new charts are dual-axis and already covered by the existing adapter.

## Locked layout (from approved mock `_temp/design-demos/ops-redesign-mock.html`)

```
R1: [Cash daily (existing) ] [ Paying users vs cash (existing dual) ]
R2: [Gateway mix (existing) ] [ Ad spend vs cash (NEW dual)        ]
R3: [ARPPU & conversion (NEW dual)] [ Support volume & sentiment (NEW dual) ]
R4: [ Purchase hour×DOW heatmap (NEW, full-width)                  ]
R5: [ Revenue concentration / payer tiers (NEW, full-width)        ]
--- existing 5 analysis panels below (unchanged) ---
```

Grid: change the trend container from `gridTemplateColumns: 'repeat(3, 1fr)'`
(overview-tab.tsx:198) to `'repeat(2, 1fr)'`. R4/R5 full-width rows = separate
`gridColumn: '1 / -1'` items or their own single-col containers.

## Adapter reuse / additions (in `ops-chart-artifact.ts`)

| Chart | Adapter | New or reuse |
|-------|---------|-------------|
| Ad spend vs cash | `dualMeasureArtifact` (left=cash_vnd, right=spend_vnd) | **REUSE** |
| ARPPU & conversion | `dualMeasureArtifact` (left=arppu_vnd, right=conversion %) | **REUSE** (note: conversion is a %, not _vnd — label only, no unit suffix) |
| Support volume & sentiment | `dualMeasureArtifact` (left=tickets, right=negative) | **REUSE** |
| Purchase heatmap | `heatmapArtifact` (NEW) | **NEW** — renderer already supports `type:'heatmap'` |
| Payer-tier concentration | `concentrationBarArtifact` (NEW) OR reuse `stackedArtifact` | **NEW** (simple bar; see below) |

- **`heatmapArtifact`** (NEW): build `ChartSpec{ type:'heatmap', encoding:{ category: hour,
  series: dow, value: cash_vnd } }` from `heatmap[]`. Columns: hour (number/dimension), dow
  (number/dimension), cash_vnd (measure). Confirm the renderer's exact heatmap encoding keys
  by reading how `type:'heatmap'` is consumed in the chat renderer before finalizing
  category/series axis assignment. Label dow axis ISO 1=Mon..7=Sun (per P1).
- **`concentrationBarArtifact`** (NEW): one bar per payer_tier with value = ltvPct (or ltv).
  KISS: a single-category bar (`type:'bar'`, category=tier, value=ltv_vnd). If a bar spec
  isn't already supported the same way as `line`, reuse `stackedArtifact` with a single date
  bucket — but prefer a clean small `barArtifact`. Decide by checking renderer support.

Keep money keys `_vnd`-suffixed so the renderer formats VND (existing convention, file header).

## Empty-state handling (mirror existing)

`overview-tab.tsx` already gates each chart behind a `hasX` boolean → `TrendPlaceholder`.
Add `hasSpend`, `hasArppuConv`, `hasCs`, `hasHeatmap`, `hasPayerTiers`. **Heatmap MUST show
`TrendPlaceholder empty` (not error) when `heatmap.length === 0`** — this is the expected
pre-deploy state. Add a small note on the heatmap card: "populates after billing timing dims
deploy" — phrased as a data-availability note, NO plan refs.

## Related code files

- Modify: `src/pages/OpsConsole/ops-chart-artifact.ts` (add `heatmapArtifact`,
  `barArtifact`/`concentrationBarArtifact`; currently 129 LOC — watch the 200 limit).
- Modify: `src/pages/OpsConsole/overview-tab.tsx` (grid 3→2/row; add 5 chart blocks + R4/R5
  full-width; new `useMemo` artifacts; deeplinks via new `d.queries.*`). 293 LOC today — adding
  5 charts will cross 200; **modularize**: extract the trend grid into `overview-trends.tsx`
  (consumes `d`), leave the panels + hero in `overview-tab.tsx`.

## Implementation Steps

1. Read the chat renderer's heatmap + bar handling (`src/pages/Chat/components/...` /
   `api/chat-sse-client` ChartSpec) to confirm `type:'heatmap'`/`'bar'` encoding keys.
2. Add `heatmapArtifact` + bar adapter to `ops-chart-artifact.ts` (pure, no React).
3. In overview-tab, add `useMemo` artifacts for spend-vs-cash, arppu/conversion, cs, heatmap,
   payer-tiers using P3's shaped data.
4. Rewrite the trend `<div>` grid to `repeat(2,1fr)`; place charts per locked layout; R4/R5
   as full-width (`gridColumn:'1 / -1'`).
5. Each chart: `AssistantChartSection` + `OpenInPlayground query={d.queries.<x>}` +
   `TrendPlaceholder` empty-state. Heatmap empty-state is the pre-deploy norm.
6. Tokens only, `var(--font-sans)`; cross-check padding/radius vs existing panels.
7. Modularize overview-tab if >200 LOC (extract `overview-trends.tsx`).

## Todo

- [ ] heatmapArtifact + bar/concentration adapter added (pure)
- [ ] trend grid changed to repeat(2,1fr); R4/R5 full-width
- [ ] 5 new charts mounted with deeplinks + empty-states
- [ ] heatmap empty-state is graceful pre-deploy (note, not error)
- [ ] dual-axis adapters REUSED for spend/arppu/cs (DRY)
- [ ] tokens + font compliant; overview-tab modularized if >200 LOC
- [ ] tsc + vite build clean

## Success Criteria

- Overview renders the locked 5-row layout, 2 charts/row + 2 full-width.
- Existing 5 analysis panels intact below.
- All charts keep type-switch/table/CSV + per-chart OpenInPlayground.
- Heatmap shows a clean placeholder pre-deploy; renders cells post-deploy.
- Visual parity with Dashboards/Cohort (typography, padding, radius, colors).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Heatmap empty post-build because P1 not deployed | HIGH | Looks broken | Explicit empty-state + note; gate only this chart; don't block ship of other 4. |
| Renderer heatmap/bar encoding keys differ from assumption | MED | Chart misrenders | Read renderer source (step 1) before finalizing adapter; verify with a sample row. |
| dualMeasure axis order (left/right) wrong | MED | Axes swapped | Renderer reads first numeric key as left (adapter header note); put cash/arppu/tickets first. |
| overview-tab grows unmaintainable | MED | Tech debt | Extract `overview-trends.tsx`. |

## Next Steps

P5 (date range) + P6 (members) are independent; P7 validates the whole.
