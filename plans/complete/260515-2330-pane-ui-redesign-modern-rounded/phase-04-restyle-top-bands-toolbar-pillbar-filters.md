---
phase: 4
title: "Restyle top bands (toolbar/pillbar/filters)"
status: complete
priority: P2
effort: "2-3h"
dependencies: [3]
---

# Phase 4: Restyle top bands (toolbar / pill bar / filters)

## Overview

Bring `QueryBuilderToolBar`, `QueryStatePillBar`, and `QueryBuilderFilters` to the same card aesthetic as the rest of the layout. Each piece sits as its own gap-separated rounded card inside the center pane.

<!-- Updated: Validation Session 1 - layout decision flipped from "Run inside PillBar header" to "Run as its own slim band card" -->

## Requirements

**Functional**
- Toolbar: Run button + status + alerts stays
- Pill bar: 4 member rows (dimensions/measures/time/filters) + date-range strip stays
- Filters strip: existing collapse/expand behavior stays
- Each piece is a separate rounded card with `var(--pane-gap)` between them

**Non-functional**
- `QueryStatePillBar` already has the right pattern (`<Card>` styled-component with `--bg-card`, `--border-card`, `--radius-card`, `--shadow-xs`). Reuse its container; extend the pattern to the Run band and Filters strip.
- Component ownership boundaries preserved (no state lifted across PillBar/Toolbar/Filters).

## Architecture

**Decision (Validation Session 1): Option C — Run band as its own slim card.**

- Considered Option A (single "Query" supercard with everything): rejected. Would require lifting state across three components that today have separate ownership.
- Considered Option B (Run button inside PillBar header right-slot): rejected by user during validation. Diverges less from reference but couples Run-control state to PillBar's container.
- **Chosen Option C:** Each band is a stand-alone card. Cleanest separation of concerns.

Center column layout (inside center `AppPane`):

```
RunBand card        — slim, height ~52px, holds <QueryBuilderRunControl/>
QueryStatePillBar   — existing card, no headerRight slot
ToolBarAlerts       — PreAggregationAlerts + QueryBuilderError (no card, plain row)
QueryBuilderFilters — card-wrapped (uses shared Card from PaneParts)
ResultsTabs         — no card, fills remaining height
```

Each card-bearing band reuses a shared `<Card>` styled-component (extracted to `src/components/AppPanes/PaneParts.tsx` in Phase 3). Gap between bands is `var(--pane-gap)`.

## Related Code Files

- **Modify:** `src/QueryBuilderV2/QueryBuilderToolBar.tsx` — split into two exported pieces:
  - `QueryBuilderRunControl` — Run/Stop button + `RequestStatusComponent` row
  - `QueryBuilderToolBarAlerts` — `<PreAggregationAlerts/>` + `<QueryBuilderError/>`
- **Modify:** `src/QueryBuilderV2/QueryStatePillBar.tsx` — no `headerRight` prop needed (decision flipped). Keep `<LiveBadge>` next to the title.
- **Modify:** `src/QueryBuilderV2/QueryBuilderInternals.tsx` — center column mounts: RunBand → PillBar → Alerts → Filters → Tabs, each separated by `var(--pane-gap)`.
- **Modify:** `src/QueryBuilderV2/QueryBuilderFilters.tsx` — wrap outer in the shared `<Card>` styled-component (extracted in Phase 3 to `src/components/AppPanes/PaneParts.tsx`).

## Implementation Steps

1. **Split `QueryBuilderToolBar`**:
   - Extract Run/Stop button block (lines 71-93 of current toolbar) into a new exported component `QueryBuilderRunControl`. Internal layout: `<Card><Space>{Run/Stop button}{RequestStatusComponent}</Space></Card>` using the shared Card.
   - Keep `<PreAggregationAlerts/>` + `<QueryBuilderError/>` inside the existing file, renamed export `QueryBuilderToolBarAlerts`. No card wrap — they remain plain inline rows so they collapse when empty.

2. **`QueryStatePillBar`** (no API change):
   - Keep existing `<Card>` wrapper unchanged.
   - Keep existing `<Header>` with `<Title>Query</Title>` + `<LiveBadge>Live</LiveBadge>`.
   - Do NOT add a `headerRight` slot — Run button lives in its own band card above (decision flipped in Validation Session 1).

3. **`QueryBuilderInternals` center column layout** (inside center `AppPane`):
   ```tsx
   <CenterColumn>
     <QueryBuilderRunControl />     {/* own slim card band */}
     <QueryStatePillBar />          {/* existing card, untouched API */}
     <QueryBuilderToolBarAlerts />  {/* alerts + error, no card */}
     <QueryBuilderFilters onToggle={onToggle} />  {/* card-wrapped */}
     <ResultsTabs ... />            {/* fills remaining height, no card */}
   </CenterColumn>
   ```
   `CenterColumn` is a styled flex column with `gap: var(--pane-gap)` so each band sits 10px apart.

4. **`QueryBuilderFilters` strip restyle**:
   - Wrap its outer in a card matching `QueryStatePillBar`'s `<Card>` styled-component (or extract that styled-component to a shared `Card` in `src/components/AppPanes/PaneParts.tsx`).
   - The collapse chevron stays on the right of the card header.

5. **Results tabs container**:
   - The tabs strip should *not* be wrapped in a card — it should sit inside the center `AppPane` directly so the table/chart fills the bottom space. Reference shows: outer "Query" card on top, then tabs+table directly inside the larger work area.
   - Reuse existing `<Tabs>` from `QueryBuilderV2/components/Tabs`; just ensure no extra background on the outer.

6. **Compile + visual diff** against reference screenshot. Check that:
   - Each top band is its own ~12px-radius white card with hairline border
   - Gaps between bands are uniform (`var(--pane-gap)`)
   - Run button is in the pill-bar header right slot, primary brand orange
   - Section labels (MEASURES, DIMENSIONS, TIME, FILTERS) match reference

## Todo List

- [ ] Split `QueryBuilderToolBar` into `QueryBuilderRunControl` + `QueryBuilderToolBarAlerts`
- [ ] Wrap `QueryBuilderRunControl` in the shared `<Card>` (slim band)
- [ ] Wrap `QueryBuilderFilters` outer in the shared `<Card>`
- [ ] Refactor `QueryBuilderInternals` to mount: RunBand → PillBar → Alerts → Filters → Tabs
- [ ] Confirm `--pane-gap` (10px) drives the gap between bands
- [ ] Run button uses brand orange (`--brand`); already true via ui-kit `type="primary"` + theme override
- [ ] Visual diff vs reference passes

## Success Criteria

- [ ] Center column has uniform 10px gaps between cards
- [ ] Run band is its own slim rounded card above the PillBar (NOT inside PillBar header)
- [ ] PillBar API unchanged — no `headerRight` prop introduced
- [ ] Filters strip is a rounded card matching the pill bar
- [ ] Results tabs flow directly under the cards without their own card wrap
- [ ] No regression in Run, Stop, filter add/remove, date-range select
- [ ] `npm run typecheck` clean

## Risk Assessment

- **Toolbar consumers**: `QueryBuilderToolBar` is only used in `QueryBuilderInternals.tsx` (verify via grep). Safe to split.
- **PreAggregationAlerts ownership**: stays inside the alerts piece; no behavior change.
- **Filters expand/collapse interaction**: `onToggle` callback used by `useAutoSize` in `QueryBuilderInternals` — keep wiring.

## Security Considerations

None. Pure styling/refactor.

## Next Steps

→ Phase 5 verifies the whole thing end-to-end: drag interactions, persistence, accessibility, type safety, build.
