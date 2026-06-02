---
phase: 6
title: "Funnel builder"
status: completed
priority: P2
effort: "3-4d"
dependencies: []
---

# Phase 6: Funnel builder

## Overview

3-step funnel builder UI on top of Segments: pick events → pick window → see drop-off bars. Saveable as a Segment (existing CRUD). Detects the `ordered_event_funnel` cube from `docs/ordered-funnel-cube-template.md` and uses single-query path; falls back to multi-query against an events cube if the ordered cube is absent. Zero regression either way.

## Requirements

**Functional**
- Wizard at `/segments/new/funnel` (or modal from Segments page):
  - **Step 1 — Events:** ordered list (2–6 events) chosen from a typeahead populated from meta (`step_name` filter-only dim if available, else event names from events cube).
  - **Step 2 — Window:** "users complete all steps within: 1h / 24h / 7d / 30d / custom" — translated into Cube filter.
  - **Step 3 — Result:** horizontal bar list of step counts + drop-off % between steps; line chart of cumulative completion over time.
- Save as Segment: stores funnel definition in `funnel_definition_json` (extends segments table or sibling table).
- Re-open saved funnel reproduces wizard state.
- Detection contract matches the doc: cube exposes `step_count` measure + `step_index` dim + `step_name` filter-only dim → single-query path; else multi-query fallback.
- Game-scoped via existing token bootstrap.

**Non-functional**
- Result render ≤2s after Run for ≤7-day windows on preagg'd data.
- Wizard is keyboard-navigable (TAB through steps, ENTER to advance).
- No new viz deps — reuse `<BarList>` + `<LineChart>`.

## Architecture

```
Detection (one-time on meta load):
  hasOrderedFunnel = meta.cubes.some(c =>
    c.measures.find(m => m.name.endsWith('.step_count')) &&
    c.dimensions.find(d => d.name.endsWith('.step_index')) &&
    c.dimensions.find(d => d.name.endsWith('.step_name'))
  )

Single-query path (preferred):
  cube.load({
    measures: ['ordered_event_funnel.step_count'],
    dimensions: ['ordered_event_funnel.step_index'],
    filters: [
      { member: 'ordered_event_funnel.step_name', operator: 'equals', values: [...orderedEvents] },
      ...gameFilter,
      ...windowFilter,
    ],
    order: { 'ordered_event_funnel.step_index': 'asc' },
  })

Fallback (multi-query):
  for each step in events:
    cube.load({
      measures: ['events.distinctUsers'],
      filters: [
        { member: 'events.eventName', operator: 'equals', values: [step] },
        ...gameFilter,
        ...windowFilter,
      ],
    })
  → returns parallel counts (no order enforcement, document the limitation in header badge)

Storage:
  Extend existing segments table OR add segments.funnel_json TEXT NULL.
  funnel_json = { orderedEvents: string[], windowMs: number, ... }
  Segments with non-null funnel_json render the funnel view instead of the predicate view.
```

Header badge on result panel: `Ordered · single query` (green) vs `Unordered · multi query` (amber) — communicates the limitation.

## Related Code Files

- **Create**
  - `src/pages/Segments/funnel-builder/index.tsx` — wizard
  - `src/pages/Segments/funnel-builder/step-events.tsx`
  - `src/pages/Segments/funnel-builder/step-window.tsx`
  - `src/pages/Segments/funnel-builder/step-result.tsx`
  - `src/pages/Segments/funnel-builder/use-funnel-detection.ts` — meta-based contract check
  - `src/pages/Segments/funnel-builder/run-funnel.ts` — single-query / fallback dispatcher
  - `src/pages/Segments/funnel-builder/funnel-bar-list.tsx`
  - `src/pages/Segments/funnel-builder/run-funnel.test.ts`
- **Modify**
  - `server/src/db/migrations/01X-segments-funnel.sql` — add `funnel_json` column to segments
  - `server/src/routes/segments.ts` — accept + return `funnel_json`
  - `src/pages/Segments/...` segment list/detail to render funnel view when `funnel_json` present
  - `src/App.tsx` — route `/segments/new/funnel`
- **Reuse (no edit)**
  - `src/pages/Segments/visuals/bar-list.tsx`
  - `src/pages/Segments/visuals/line-chart.tsx`
  - `src/shared/game-scoping/apply-game-filter.ts`
  - `docs/ordered-funnel-cube-template.md` (reference only; not modified)

## Implementation Steps

1. `use-funnel-detection.ts`: derive `hasOrderedFunnel` from meta; memoize per meta version.
2. `run-funnel.ts`: dispatch to single-query or fallback; normalize output shape `{ steps: [{ name, count, dropFromPrev }] }`.
3. Wizard skeleton: 3 steps, advance-on-valid, back nav.
4. Step 1: typeahead from `step_name` values (single-query path) or distinct event names (fallback). Drag-reorder.
5. Step 2: presets + custom range; translate to Cube `dateRange` or window filter.
6. Step 3: `<FunnelBarList>` (custom thin wrapper over `<BarList>`) — counts + drop-off %; small `<LineChart>` of cumulative step1→stepN over time.
7. Save flow: POST to segments with `funnel_json`; redirect to segment detail.
8. Segment detail render path: branch on `funnel_json` presence — show funnel view (re-runs `run-funnel` on each open).
9. Header badge component: ordered/unordered hint.
10. Tests: detection contract; single-query vs fallback path selection; window filter translation; save round-trip.

## Success Criteria

- [ ] When ordered cube is present, wizard runs single-query; badge shows "Ordered".
- [ ] When absent, wizard runs multi-query fallback; badge shows "Unordered" with tooltip explaining limitation.
- [ ] Save persists funnel definition; reload reproduces wizard state + result.
- [ ] Drop-off % computed correctly between consecutive steps.
- [ ] Drag-reorder of step list re-runs.
- [ ] Game switch refetches.

## Risk Assessment

- **Risk:** ordered cube not deployed in any target Cube backend.
  **Mitigation:** fallback path always works; document deployment steps (already exist in `docs/ordered-funnel-cube-template.md`).
- **Risk:** fallback's "all events without order" produces wrong intuition for users (looks like a funnel, isn't).
  **Mitigation:** badge + tooltip; bar chart label says "Users who did step" not "Users who reached step"; show inequality "drop-off (unordered, sequence not guaranteed)".
- **Risk:** typeahead populated from cardinality-heavy event tables.
  **Mitigation:** limit to top-100 events by frequency; allow free text for power users.
- **Risk:** saving funnel into segments table mixes two concepts.
  **Mitigation:** acceptable for demo (single sidecar column); long-term refactor to `analyses` table can happen separately.
