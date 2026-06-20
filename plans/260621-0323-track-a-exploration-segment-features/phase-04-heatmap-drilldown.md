# Phase 04 — Heatmap drill-down

## Context links

- Plan: [plan.md](plan.md)
- Mockup: feature 4 (clickable cell → popover: value, mini trend, top contributors, save-as-segment).
- Heatmap: `src/pages/Chat/components/chart-heatmap.tsx`
- Members API: `server/src/routes/segments.ts:657`
- Save-as-segment hand-off: `src/pages/Chat/components/segment-proposal-card.tsx` + `src/pages/Segments/editor/editor-prefill-store.ts`

## Overview

- **Priority:** P2 (small, high reuse).
- **Status:** done.
- **Description:** Make existing heatmap cells clickable → popover showing the
  cell value, a mini trend, top contributors, and a "save these as a segment"
  hand-off. Build order #2 (after Phase 01) because it reuses hand-offs.

## Key insights (verified)

- `ChartHeatmap` (`chart-heatmap.tsx`) renders a CSS-grid; cells currently set
  `cursor:'default'`, `userSelect:'none'`, NO `onClick`. The drill-down adds
  `cursor:'pointer'` + `onClick` + a selected-outline (`var(--brand)` per mockup).
- Heatmap is used ONLY in chat: `assistant-chart-section.tsx` (`:255` ChartBody,
  `:584` fallback). Grep confirms NO heatmap in `src/pages/Segments`. So the
  drill-down scopes to chat only — do NOT plan a Segments/Monitor-tab variant
  (the mockup's "Monitor / Movement tab" mention does not match the codebase).
- The popover needs: cell coords (y=series value, x=category value), cell value,
  and a way to fetch "top contributors". The heatmap data rows only carry the
  aggregated cell value — they do NOT carry member-level contributors. Top
  contributors require an identity-level query for that (y, x) slice.
- Save-as-segment hand-off pattern: `segment-proposal-card.tsx` stashes prefill
  via `stashEditorPrefill` (`editor-prefill-store.ts`) then navigates to the
  segment editor, which calls `consumeEditorPrefill`. Reuse this — no new write
  path. The cell's (y, x) becomes a predicate prefill (the two heatmap dims =
  two filter values).
- The HEX `STOPS` ramp in `chart-heatmap.tsx` is in the lint HEX_ALLOWLIST — the
  popover and outline must use design tokens (`--brand`, `--bg-card`,
  `--border-strong`, `--shadow-lg`), NOT new hex.

## Requirements

Functional:
- Clicking a (non-empty) cell opens a popover anchored to that cell with a brand
  outline; clicking elsewhere / another cell closes/moves it.
- Popover shows: cell coords label, formatted value, % of total + a count line
  (per mockup), a mini trend sparkline, top-N contributors, and a "Save … as
  segment" button.
- "Save as segment" hands off to the segment editor prefilled with a predicate
  derived from the two heatmap dimensions (= the clicked cell's y/x values).

Non-functional:
- The contributors fetch must be on-demand (only when a cell is clicked), not
  per-render. Empty/no-data cells stay non-interactive.

## Architecture

```
ChartHeatmap cell onClick(y, x, value)
  → ChartHeatmap raises onCellSelect (new optional prop)
  → HeatmapDrilldownPopover (new) opens anchored to the cell
       - value + %-of-total computed from the spec.data already in hand
       - mini trend: derived from the same series if a time axis exists,
         else omitted (graceful)
       - top contributors: on-demand fetch (see contributors source below)
       - "Save as segment": stashEditorPrefill({ predicate from (y,x) }) → navigate
```
Contributors source: the heatmap's two dims + measure define the slice. Two
options — (a) if the chart artifact carries the originating CubeQuery, issue a
scoped identity+measure top-N query; (b) reuse the tokenless members API only
when the slice already corresponds to a saved segment (it usually does not).
Recommended: derive contributors from a scoped CubeQuery built from the
artifact's query + the (y, x) filter, capped at top-N. If the originating query
is not available to the heatmap component, scope contributors to "save first,
then view members" and show value+trend only pre-save. **Confirm availability of
the originating query at the heatmap render site during implementation** (the
heatmap gets only `spec`, not the artifact — likely needs an added prop).

## Related code files

Create:
- `src/pages/Chat/components/heatmap-drilldown-popover.tsx` — the popover
  (tokens only; matches mockup geometry: 260px, shadow-lg, value/%, sparkline,
  contributors table, save button).
- `src/pages/Chat/components/use-heatmap-cell-contributors.ts` — on-demand
  contributors fetch hook (scoped query for the (y, x) slice).
- `src/pages/Chat/components/heatmap-cell-to-predicate.ts` — maps (seriesDim,
  seriesValue, categoryDim, categoryValue) → editor predicate prefill.

Modify:
- `src/pages/Chat/components/chart-heatmap.tsx` — add `cursor:pointer` +
  `onClick` + selected-cell outline; add optional `onCellSelect` prop and the
  context (dim names) needed to build the predicate. Keep < 200 lines (extract
  cell rendering if it grows).
- `src/pages/Chat/components/assistant-chart-section.tsx` — pass the originating
  artifact/query context down to `ChartHeatmap` so the popover can fetch
  contributors + build the predicate.

Delete: none.

## Implementation steps

1. **Heatmap interactivity** — in `chart-heatmap.tsx`, give value cells
   `cursor:pointer`, an `onClick` that reports `(seriesValue, categoryValue,
   value)`, and a selected-outline when that cell is the active one. Empty slots
   stay inert.
2. **Wire context** — add props for the series/category dimension *names* and the
   originating query so downstream can build predicate + contributors.
3. **Popover** — `heatmap-drilldown-popover.tsx`: anchored, tokens-only, renders
   coords + value + %-of-total (from `spec.data`) + sparkline + contributors +
   save button. Close on outside click / Esc.
4. **Contributors** — `use-heatmap-cell-contributors.ts`: build a scoped top-N
   identity query for the slice; on-demand; loading + empty states.
5. **Predicate map** — `heatmap-cell-to-predicate.ts`: (y, x) → prefill tree.
6. **Save hand-off** — call `stashEditorPrefill` then navigate to the segment
   editor (mirror `segment-proposal-card.tsx`).
7. **Verify** `npx tsc --noEmit` clean; run vitest.

## Todo checklist

- [ ] Cells clickable + selected outline (`chart-heatmap.tsx`)
- [ ] Pass dim names + query context from `assistant-chart-section.tsx`
- [ ] `heatmap-drilldown-popover.tsx`
- [ ] `use-heatmap-cell-contributors.ts` (on-demand)
- [ ] `heatmap-cell-to-predicate.ts`
- [ ] Save-as-segment hand-off via `stashEditorPrefill`
- [ ] Tests + `tsc --noEmit` clean

## Success criteria

- Clicking a non-empty heatmap cell opens the popover with a brand outline on the
  cell; the value + %-of-total match the cell.
- Top contributors load on click (not before) and show top-N for that slice.
- "Save … as segment" lands the user in the segment editor pre-filled with the
  cell's predicate.
- Empty cells are not clickable. No new inline hex (only the allowlisted ramp).

## Tests to write

- `chart-heatmap`: clicking a value cell fires `onCellSelect` with the right
  (y, x, value); empty cells do not; selected cell gets the outline.
- `heatmap-cell-to-predicate`: maps dims+values to the expected prefill tree.
- popover: renders value/%, shows loading then contributors, save button calls
  the prefill stash with the cell's predicate.

## Risks + mitigation

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Originating query not available at heatmap render | M×M | Add a prop from `assistant-chart-section`; if absent, degrade to value+trend and "save first to see members". |
| Popover overflow at grid edges | M×L | Clamp/auto-flip placement; the mockup uses `transform:translateX(-30%)` as a hint. |
| Contributors query cost per click | L×M | On-demand only, top-N cap, abortable. |
| Mockup mentions Monitor/Movement tab (not in code) | — | Scope to chat only (verified); note the discrepancy in plan.md. |

## Security / perf considerations

- Contributors query runs under the chat user's existing auth/game scope (same as
  any chat query) — no new tokenless surface.
- On-demand + abort-on-close so rapid cell clicks don't stack requests.

## Next steps

- Independent of Phases 02/03. Shares the save path with Phase 01 (manual create).
