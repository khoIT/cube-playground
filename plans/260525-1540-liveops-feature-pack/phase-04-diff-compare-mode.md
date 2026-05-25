---
phase: 4
title: "Diff compare mode"
status: pending
priority: P2
effort: "1-2d"
dependencies: []
---

# Phase 4: Diff / compare mode

## Overview

A single toggle on the playground result toolbar that re-runs the current query against a comparison axis and renders side-by-side with a delta column. Two axes: **time** (this 7d vs prior 7d) and **game** (game A vs game B). Pure frontend — no schema or server work.

## Requirements

**Functional**
- Toolbar control: `Compare: [Off] [Prev period] [Other game]`.
- **Prev period**: derive prior window from current `dateRange` (e.g. `last 7d` → prior 7d ending at start of current).
- **Other game**: dropdown to pick from available games (excluding active); re-run with that game's Cube token + filter.
- Result table renders columns: `<dim cols> | Current | Comparison | Δ | Δ%`.
- Charts (line/bar) overlay both series with distinct colors + legend.
- Compare state survives URL — adds `compare=prev|game:<id>` to the existing `query=` param.

**Non-functional**
- Comparison query runs in parallel with current (no UI block).
- Falls back gracefully when comparison set has fewer rows (left-join on dim tuple).
- No new deps.

## Architecture

```
Playground result pipeline:
  current ─┐
           ├─→ joinByDimensions(current, comparison) → augmented rows
  compare ─┘

deriveCompareQuery(currentQuery, compareMode):
  mode='prev':
    timeDim.dateRange = shiftBackward(current.dateRange)
  mode='game:<id>':
    rerun against that game's Cube token (use-cube-token-bootstrap pattern)
    + applyGameFilter(<id>) instead of active

useCompareResults(query, mode):
  Promise.all([loadCurrent, loadCompare])
  → mergeByDimKey(currentRows, compareRows, measures)
  → emit { rows, deltas }
```

Delta math per measure:
- `Δ = current - comparison`
- `Δ% = comparison ? (current - comparison) / comparison : null`

For chart overlays: re-use `<LineChart>` and `<BarList>` with a second series — both already accept multi-series via recharts under the hood.

## Related Code Files

- **Create**
  - `src/QueryBuilder/compare/compare-toggle.tsx` (or `QueryBuilderV2/compare/`, match active builder)
  - `src/QueryBuilder/compare/derive-compare-query.ts`
  - `src/QueryBuilder/compare/merge-by-dim-key.ts`
  - `src/QueryBuilder/compare/use-compare-results.ts`
  - `src/QueryBuilder/compare/derive-compare-query.test.ts`
  - `src/QueryBuilder/compare/merge-by-dim-key.test.ts`
- **Modify**
  - Playground result-tabs / result-table component — render extra columns when compare is on
  - Playground chart components (line/bar) — accept second series
  - URL state codec — encode/decode `compare` param alongside `query`
- **Reuse (no edit)**
  - `src/shared/game-scoping/apply-game-filter.ts`
  - `src/hooks/use-cube-token-bootstrap.ts` (already supports per-game token swap)

## Implementation Steps

1. `derive-compare-query.ts`: pure fn — shift `dateRange` for `prev`, swap game filter for `game:<id>`. Cover all `dateRange` shapes (literal, named, `inDateRange`).
2. `merge-by-dim-key.ts`: pure fn — left-join on tuple of dimension values; compute deltas per measure.
3. `use-compare-results.ts`: run current + comparison in parallel; for `game:<id>` mint a per-game token via existing bootstrap.
4. `<CompareToggle>`: 3-way segmented control in toolbar; emits to query-state store.
5. URL codec: extend the existing playground query-string format with optional `compare=...`.
6. Result table: when `compare !== off`, render `Current | Comparison | Δ | Δ%`. Format Δ% with color cue (green/red, invertable per measure config — but default to neutral).
7. Charts: pass second series when present; legend labels current vs comparison.
8. Tests: prev-period date shifts (7d, 14d, 30d, QTD); merge on multi-dim key; game compare uses correct token.

## Success Criteria

- [ ] Toggling "Prev period" reruns and shows Δ column for every measure.
- [ ] Toggling "Other game" picks game from list, reruns under that game's token, results merged.
- [ ] URL contains `compare=prev` / `compare=game:<id>`; reload preserves state.
- [ ] Chart overlay shows both series with legend.
- [ ] Mismatched dim rows handled (no NaN; missing comparison shows "—").
- [ ] Off toggle reverts to single-result view without losing query.

## Risk Assessment

- **Risk:** date range shapes are heterogeneous (literal pair, named range, `inDateRange` filter).
  **Mitigation:** centralize shift in one util with exhaustive test cases; warn-and-skip on unrecognized shape.
- **Risk:** comparing across games when measure definitions differ (`revenue.arpdau` defined differently per game).
  **Mitigation:** detect via meta — if measure absent in comparison game's meta, show "N/A" with tooltip.
- **Risk:** dim cardinality mismatch (current has 30 rows, comparison has 28).
  **Mitigation:** left-join keeps all current rows; `null` deltas for missing.
