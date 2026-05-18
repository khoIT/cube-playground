---
phase: 4
title: "Funnel mode"
status: pending
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 4: Funnel mode

## Context Links
- Research §2 "Funnel Analysis"
- Research §3 "Funnel — Workaround feasible, not native"
- Research §4.A "Funnel Analysis" — medium implementation effort
- Cube load API: `hooks/query-builder.ts:269` (`cubeApi.load(query, {...})`)
- PostHog funnel docs: https://posthog.com/docs/product-analytics/funnels

## Overview

Funnel mode lets a user pick an **event-type dimension** + N ordered event values (e.g. `event_name in ['signup', 'add_to_cart', 'purchase']`) and renders a step-by-step drop-off chart. Implementation is the client-side multi-query workaround from research: one `cubeApi.load()` per cumulative step, computed in parallel, drop-off % calculated in JS. v1 ships **Sequential mode only** (filters AND on later steps reuse all earlier-step filters); Strict / Any deferred to v2.

## Key Insights

- Funnel = N queries, each `{ measures: [primary], filters: [step_1_filter, step_2_filter, …step_k_filter] }`.
- "Primary measure" defaults to `count` measure if cube exposes one, else `count_distinct(user_id)` if `user_id` dimension exists, else user picks.
- Cube does NOT enforce event-sequence ordering (timestamp `step_1 < step_2 < …`) in a single query. v1 accepts this fidelity loss and documents: "v1 Sequential treats unique-users-having-all-events as the conversion definition; true ordered sequence requires SQL mode."
- Render: bar chart (one bar per step, height = count) + table (Step | Count | Conversion % from step 1 | Drop-off % from previous).

## Requirements

**Functional**
- Inputs:
  - **Event dimension** picker — single-select from `usedCubes`' string/categorical dimensions. Auto-suggest the first dim named `event_name`/`event_type` if present.
  - **Primary measure** picker — defaults to `count`-typed measure on the same cube.
  - **Steps** — ordered list of values (string entries), `+ Add step`, drag-to-reorder, X-to-remove. Each step = a value the event dim must equal.
  - Inherit `query.filters` from pill bar as global filters across all queries.
- Run flow:
  - Build N queries: for step `k`, `filters = [{member: eventDim, operator: 'equals', values: [steps[k]]}, ...pillBarFilters]`.
  - Fire `Promise.all([cubeApi.load(q1), cubeApi.load(q2), ...])`.
  - Extract scalar from each result (`resultSet.totalRow()` or `rawData()[0][measureKey]`).
  - Compute drop-off table.
- Render:
  - **Chart:** vertical bar chart (x=step label, y=count).
  - **Table below:** Step | Label | Count | % of step 1 | Drop-off vs prev.
- Loading state: spinner + "Running N parallel queries…"
- Error state: if any query fails, show the error + which step failed; do not silently render partial data.
- Empty state: < 2 steps configured → "Add at least 2 steps to compute a funnel."

**Non-functional**
- Each file < 200 LOC. Hook + component + helpers split.
- Concurrent query cap: 8 parallel (`Promise.all` is fine but document trade-off if user adds 20 steps).
- Build green.

## Architecture

```
<FunnelMode/>
├── <FunnelInputs/>
│   ├── event-dim picker
│   ├── measure picker
│   └── <StepList/> (ordered values, +Add, X-remove)
├── useFunnelQueries(eventDim, measure, steps, pillBarFilters)
│       └── returns { isLoading, error, results: {step, label, count, conversionPct, dropOffPct}[] }
├── <FunnelChart results=…/> (recharts BarChart)
└── <FunnelTable results=…/>
```

Files:

```
analysis/
├── funnel-mode.tsx                  (~150 LOC) — orchestrator + render
├── use-funnel-queries.ts            (~120 LOC) — multi-load hook + drop-off math
├── funnel-inputs.tsx                (~150 LOC) — pickers + StepList
```

## Related Code Files

**Modify**
- `src/QueryBuilderV2/analysis/analysis-panel.tsx` — swap funnel placeholder.

**Create**
- `src/QueryBuilderV2/analysis/funnel-mode.tsx`
- `src/QueryBuilderV2/analysis/use-funnel-queries.ts`
- `src/QueryBuilderV2/analysis/funnel-inputs.tsx`

## Implementation Steps

1. Confirm `cubeApi.load(query, opts)` resolves to a `ResultSet` (read `hooks/query-builder.ts:269`).
2. Confirm `meta` shape exposes dimension `type` field (need to filter event-dim candidates to string types).
3. Build `use-funnel-queries.ts`:
   - Hook signature: `(eventDim, measure, steps, globalFilters) => { isLoading, error, results }`.
   - Memo queries array.
   - `useEffect` fires `Promise.all(queries.map(q => cubeApi.load(q)))` when inputs change.
   - On resolve: extract counts, compute `conversionPct = count / count_step_1`, `dropOffPct = 1 - count / count_step_(k-1)`.
   - On reject: surface error and which step index failed.
4. Build `funnel-inputs.tsx`:
   - antd Selects for eventDim + measure.
   - StepList: array of strings, `+ Add step` button, X per row, drag handle (defer drag if HTML5 drag too expensive — use up/down arrows v1).
5. Build `funnel-mode.tsx`:
   - Wire inputs + hook + render.
   - Use recharts BarChart with `<Cell fill={var(--chart-N)}/>` per step (graded shades).
   - Render table below.
6. Mount in `analysis-panel.tsx`.
7. Smoke: pick event dim, add 3 step values, see bars + table.
8. `npx vite build`.

## Todo List

- [ ] Build `use-funnel-queries` hook with parallel `cubeApi.load`
- [ ] Drop-off math (conversion %, drop-off %)
- [ ] StepList (add/remove/reorder)
- [ ] Render BarChart + drop-off table
- [ ] Loading + error states
- [ ] Empty state (< 2 steps)
- [ ] Globally inherit `query.filters` from pill bar
- [ ] `npx vite build` passes

## Success Criteria

- [ ] Picking event dim + N steps renders a funnel.
- [ ] Drop-off math matches manual calculation on a sample dataset.
- [ ] Error in any step query is surfaced clearly.
- [ ] No regression on other modes.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `cubeApi.load` rate-limits when fired in parallel | Medium | Medium | Document `Promise.all` cap of 8; if user adds 20 steps, chunk + sequence with `p-limit`-style helper (~10 LOC, no new dep) |
| Cube returns no rows for a step → undefined count | High | Low | Treat as 0; surface in table as 0 with grey row |
| Event-dim auto-suggest misses if cube uses `event` not `event_name` | Medium | Low | Fallback: pick the first string-typed dimension; surface picker so user can correct |
| User picks non-string event dim (e.g. numeric event ID) | Low | Low | Accept; equals-filter still works |
| Ordered-sequence semantics expectation gap | High | Medium | Default empty-state copy: "Measures unique users having ALL chosen events." Phase 6 adds opt-in ordered semantics via a template cube + UI auto-detect; when active, copy flips to "Ordered · single query." |

## Security Considerations

None. Uses authorised cubeApi from context.

## Next Steps

- Phase 5 wires empty-states + sample auto-fill across all three modes.
- Phase 6 layers an opt-in ordered-funnel path: ships a template YAML cube + auto-detects it via `meta.cubes`, switches funnel-mode.tsx to a single-query ordered hook when present, falls back to this phase's multi-query implementation otherwise.
