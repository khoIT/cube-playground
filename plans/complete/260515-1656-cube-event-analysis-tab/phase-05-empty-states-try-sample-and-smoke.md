---
phase: 5
title: "Empty states Try sample and smoke"
status: pending
priority: P1
effort: "4h"
dependencies: [2, 3, 4]
---

# Phase 5: Empty states, Try sample, and smoke

## Context Links
- D4 (locked 2026-05-15): "Empty-state per mode with one-line description + 'Try sample' button"
- `context.meta` exposed via `hooks/query-builder.ts:176`
- `context.usedCubes` exposed via `hooks/query-builder.ts:214`

## Overview

Wire intuitive first-run experience: each mode shows an empty state with a 1-line description + "Try sample" button. Clicking auto-fills the mode's inputs against the first usable cube — Breakdown picks 2 dims + 1 measure, Distribution picks the first numeric measure, Funnel picks the first event-style dim + the first 3 distinct values. Final phase: full manual smoke across all 3 modes + build verification.

## Key Insights

- "Sample" must work on any cube the user has loaded — we cannot ship a hardcoded sample cube name.
- Detection: pick the first cube in `usedCubes` (or `meta.cubes[0]` if none used yet). Inspect its members.
- Event-dim heuristic: string dimension named `event_name | event_type | event | action`; fallback = first string dimension.
- For Funnel's 3 sample values, we need 3 distinct values of the event-dim. v1: fire a small distinct-values query (`{ dimensions: [eventDim], limit: 3 }`) and use the result. If empty, surface "No event values found in this cube" instead of failing.

## Requirements

**Functional**
- Each mode component checks "is configured?" and renders `<EmptyState mode=… onTrySample=…/>` when not.
- Empty state contains:
  - antd `<Empty image=…/>` style chrome.
  - One-line description (per mode).
  - Primary button "Try sample" — fills inputs + triggers run.
  - Secondary link "What does this do?" — opens an inline `<Drawer/>` or `<Popover/>` with a 3-bullet explanation (no external docs).
- "Try sample" button is disabled (with tooltip) if no usable cube/meta is loaded.

**Non-functional**
- `sample-detector.ts` < 200 LOC.
- No new deps.
- Smoke checklist runs end-to-end with at least one real cube.

## Architecture

```
analysis/sample-detector.ts          (~150 LOC)
  ├── detectSampleCube(meta, usedCubes) → cubeName
  ├── detectBreakdownInputs(cubeMeta) → { dimensions[2], measure }
  ├── detectDistributionInputs(cubeMeta) → { measure }
  ├── detectEventDim(cubeMeta) → dimName | null
  └── fetchEventSamples(cubeApi, eventDim, limit=3) → Promise<string[]>

analysis/empty-state.tsx             (~120 LOC) — shared empty-state component
  └── props: { title, description, onTrySample, canTrySample, helpBullets[] }
```

Each mode wires `EmptyState` when inputs incomplete + a tiny adapter calling its detector.

## Related Code Files

**Modify**
- `src/QueryBuilderV2/analysis/breakdown-mode.tsx` — show `<EmptyState/>` when `query.dimensions.length === 0 || !query.measures[0]`. Try-sample calls `context.updateQuery({...detectBreakdownInputs(meta)})`.
- `src/QueryBuilderV2/analysis/distribution-mode.tsx` — show `<EmptyState/>` when no measure selected. Try-sample sets local measure state via detector.
- `src/QueryBuilderV2/analysis/funnel-mode.tsx` — show `<EmptyState/>` when steps.length < 2. Try-sample picks event-dim, fetches 3 sample values, sets local state.

**Create**
- `src/QueryBuilderV2/analysis/sample-detector.ts`
- `src/QueryBuilderV2/analysis/empty-state.tsx`

## Implementation Steps

1. Read `meta.cubes` structure (probably `meta.cubes[].dimensions[]` + `measures[]` from `@cubejs-client/core` MetaResponse type).
2. Build `sample-detector.ts`:
   - `detectSampleCube`: prefer first in `usedCubes`, else `meta.cubes[0]?.name`.
   - `detectBreakdownInputs`: first 2 string/categorical dims + first numeric measure → return `{dimensions, measures}` in Cube `Query` shape.
   - `detectDistributionInputs`: first numeric measure.
   - `detectEventDim`: first dim whose name matches `/event/i` else first string dim.
   - `fetchEventSamples`: small async query to grab 3 distinct values.
3. Build `empty-state.tsx`:
   - antd `Empty` + description + primary "Try sample" button + popover/drawer for help bullets.
4. Wire into each mode:
   - Breakdown: try-sample → `context.updateQuery({...sample, measures: [sample.measure]})` then `context.runQuery()`.
   - Distribution: try-sample → set local measure → auto-run.
   - Funnel: try-sample → resolve event-dim + samples → set state → auto-run.
5. Test on dev server with the real `:4000` Cube backend. Confirm sample fires for each of the three modes against `active_daily` (or first cube).
6. Manual smoke per `Todo List` below.
7. `npx vite build`.

## Todo List

- [ ] `sample-detector.ts` covers all 3 modes
- [ ] `empty-state.tsx` shared component
- [ ] Breakdown empty state + try-sample wired
- [ ] Distribution empty state + try-sample wired
- [ ] Funnel empty state + try-sample wired (+ async event-sample fetch)
- [ ] "What does this do?" inline help on each mode
- [ ] Manual smoke all 3 modes against real cube
- [ ] `npx vite build` passes

## Success Criteria

- [ ] Empty Analysis tab on first visit shows actionable cues, not blank chrome.
- [ ] One click on "Try sample" produces a real chart/table in each mode.
- [ ] No console errors during smoke.
- [ ] Build green.
- [ ] Phase statuses updated → completed across the plan.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Detectors misfire on cubes without expected member shapes | Medium | Low | Defensive: if detector returns null, disable "Try sample" with tooltip |
| Funnel sample fetch returns < 3 distinct values | Medium | Low | Use whatever count returned; surface message if < 2 |
| Detector picks an unsuitable measure (e.g. ID-typed numeric) | Medium | Low | Heuristic: skip measures whose name ends in `_id`. Otherwise document limitation |
| Updating context.query mid-render causes loop | Low | Medium | Trigger only on button click, not in render |
| Sample query against large cube blocks UI | Low | Medium | Default `limit: 3` on the distinct-values query |

## Security Considerations

None. Uses authorised cubeApi from context.

## Definition of Done (Project)

- All 3 analysis modes render real data within 2 clicks on a stock cube.
- No backend changes required.
- Empty states are self-documenting.
- Plan statuses updated to completed.
- Build green.

## Next Steps (Post-merge)

- v2: Cohort retention mode (requires pre-aggregated retention cube).
- v2: True ordered-sequence funnel (requires SQL-mode integration).
- v2: Drag-to-reorder steps in Funnel mode.
- v2: Median/mean overlay lines on Distribution chart.
- v2: Drill-down to raw events (architectural — needs separate raw-event query surface).

## Unresolved Questions

- Should "Try sample" persist its choice across reloads, or always re-detect? Default: re-detect (safer if cube schema changes).
- Should the help drawer link to a real docs URL (none exists)? v1 = inline bullets only.
- For Funnel sample, do we want to filter to *frequent* values (top-3 by count) instead of any 3? Top-3 is a better UX but adds one more query — defer until smoke shows actual UX gap.
