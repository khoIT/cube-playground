---
phase: 1
title: Reusable chart renderer + ops adapter
status: completed
effort: ''
---

# Phase 1: Reusable chart renderer + ops adapter

## Overview

Make chat-service's `AssistantChartSection` reusable on `/ops` and build a pure adapter that turns the
Ops Overview's existing data shapes into `ChartArtifact`s the renderer consumes. No `/ops` wiring yet
(Phase 2) — this phase produces the building blocks + their unit tests.

## Key Insight

`AssistantChartSection` is already a pure presentational component (`artifact: ChartArtifact`), so the
only change it needs is an **optional** header-action slot for the per-chart "Open in Playground" link
(rendered in Phase 2). Everything else is a new adapter module. Reuse > fork (DRY).

## Related Code Files

- Modify: `src/pages/Chat/components/assistant-chart-section.tsx` — add optional
  `headerAction?: React.ReactNode` prop, rendered in the standalone header next to `ChartSectionMenu`.
  Default undefined → chat surface visually unchanged.
- Create: `src/pages/OpsConsole/ops-chart-artifact.ts` — pure adapter (no React). Builds a
  `ChartArtifact` from ops inputs:
  - `lineArtifact({ id, title, caption, dates, label, valueKey, values, columnLabel, unitHint })` →
    type `'line'`, rows `[{ date, [valueKey]: v }]`, `encoding {category:'date', value:valueKey}`,
    `columns` with a synthetic label + `dataType` so axis/table headers read nicely.
  - `dualMeasureArtifact(...)` → for payers-vs-cash: wide rows `[{ date, cash, payers }]`,
    `encoding {category:'date', value:'cash', series:'payers'}`. Default render leans on
    `preferDualAxis`/`toDualAxisSpec`; verify via test that two visibly-different-scale columns trigger
    dual-axis. (If `preferDualAxis` won't auto-fire for this shape, set the artifact up so Phase 2 can
    pass it through with the menu defaulting correctly — decide from the unit test, do not guess.)
  - `stackedArtifact({ id, title, dates, categories, days })` → converts the wide per-day records
    (`Record<gatewayKey, number>[]`) into long rows `[{ date, gateway, cash }]`,
    `encoding {category:'date', value:'cash', series:'gateway'}`, type `'stacked-bar'`.
  - All emit `ChartArtifact` with `id`, `spec`, `truncated:false`, `originalRowCount`, `columns`.
- Read for contract: `src/api/chat-sse-client.ts` (FE `ChartSpec`/`ChartArtifact`/`ChartColumn` types),
  `src/pages/Chat/components/chart-section-menu.tsx` (`preferDualAxis`, `toDualAxisSpec`, `isNumericColumn`),
  `src/pages/Chat/components/chart-column-labels.ts` (`buildLabelMap` consumes `columns`).

## Architecture / Data Flow

```
ops-overview data (series + dates / stacked days)
        │  ops-chart-artifact.ts (pure)
        ▼
   ChartArtifact { spec, columns }
        │  <AssistantChartSection artifact headerAction? />
        ▼
   recharts render + ChartSectionMenu (type switch / table / CSV)
```

## Implementation Steps

1. Add `headerAction?: React.ReactNode` to `AssistantChartSectionProps`; render it in the standalone
   header row, right of `ChartSectionMenu` (e.g. `<div style={{display:'flex',gap:8}}>{headerAction}<ChartSectionMenu/></div>`).
   Do NOT render it in `embedded` mode. Keep all existing behavior intact.
2. Create `ops-chart-artifact.ts` with the three builders above. Keep it pure + side-effect-free.
   Stable `id`s (caller-provided) so React keys don't churn across renders.
3. Set `columns` on each artifact so `buildLabelMap` renders friendly axis/table labels (e.g.
   `cash → "Cash collected (₫)"`, `payers → "Paying users"`, `gateway → "Gateway"`). `dataType`:
   `'time'` for date, `'number'` for measures, `'string'` for the gateway series.
4. Decide the payers-vs-cash representation empirically: write the unit test FIRST asserting the built
   artifact opens as dual-axis (or carries the right default), then shape the builder to satisfy it.
5. Create `src/__tests__/ops-chart-artifact.test.ts`: assert row shapes, encodings, types, columns, and
   the dual-axis behavior; assert stacked long-format conversion preserves per-day per-gateway sums.

## Success Criteria

- [ ] `AssistantChartSection` accepts `headerAction`; chat rendering unchanged (existing chat chart
      tests still pass).
- [ ] `ops-chart-artifact.ts` builds valid `ChartArtifact`s for line / dual-measure / stacked.
- [ ] New unit tests pass; payers-vs-cash dual-axis behavior verified by test, not assumption.
- [ ] `tsc` clean for changed/new files.

## Risk Assessment

- If `AssistantChartSection` transitively imports a Chat-only context/hook, importing on `/ops` could
  break. Mitigation: it currently takes only `artifact` + override props — confirm no `useContext` of a
  chat provider before wiring (Phase 2). If found, lift the renderer into a shared path.
