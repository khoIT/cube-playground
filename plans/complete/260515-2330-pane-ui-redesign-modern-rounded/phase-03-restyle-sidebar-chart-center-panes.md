---
phase: 3
title: "Restyle sidebar + chart + center panes"
status: complete
priority: P2
effort: "3-5h"
dependencies: [2]
---

# Phase 3: Restyle sidebar + chart + center panes

## Overview

Bring the inner content of all three panes to match the Figma Make reference: uppercase section labels in `--text-muted`, pill-style search input, hairline section dividers, Geist typography, ~12-14px padding, and inner cards with `--radius-card`/`--shadow-xs`.

## Requirements

**Functional**
- Sidebar: SCHEMA header + search input + cube/view tree as today, but restyled
- Chart pane: pane header ("Chart") + pane body with chart, restyled
- Center pane: subtle padding around top bands + results tabs area
- Brand orange (`#f05a22`) preserved on logos, primary buttons, brand chips

**Non-functional**
- Zero functional regressions in cube/member selection, drag interactions, scroll behavior
- All existing tasty/styled-components tokens preserved (no global theme break)

## Architecture

```
AppPane (rounded outer shell — from Phase 1)
  +-- pane header (optional) — title + actions, padding 14px, border-bottom hairline
  +-- pane body — scrollable inner, padding 8-14px
```

Decompose into reusable inner pieces:

- `PaneHeader` styled-component (title + optional right slot)
- `PaneBody` styled-component (overflow:auto, padding)
- `SectionLabel` (uppercase, 11-12px, letter-spacing 0.06em, `--text-muted`)

These can live in `src/components/AppPanes/PaneParts.tsx` (or co-located in the pane files).

## Related Code Files

- **Create:** `src/components/AppPanes/PaneParts.tsx` (PaneHeader, PaneTitle, PaneBody, SectionLabel, Card)
  <!-- Updated: Validation Session 1 - Card export added; Phase 4 RunBand + Filters wrappers depend on it -->
- **Modify:** `src/QueryBuilderV2/QueryBuilderSidePanel.tsx` — wrap content with PaneHeader/PaneBody, replace ad-hoc `Title preset="h6"` with SectionLabel
- **Modify:** `src/QueryBuilderV2/components/ChartSidePane.tsx` — restyle the expanded-state header/body to use PaneParts
- **Modify:** `src/QueryBuilderV2/QueryBuilderInternals.tsx` — center pane gets PaneBody-style padding
- **Modify (light):** `src/QueryBuilderV2/components/SidePanelCubeItem.tsx` — only if hover/border tokens drift from `--neutral-200`
- **Modify (light):** `src/QueryBuilderV2/QueryBuilderSidePanel.tsx` search input — verify `<SearchInput>` from ui-kit reads `--radius-input`; if not, wrap in styled container

## Implementation Steps

1. **Build `PaneParts.tsx`** (≤110 lines):
   ```tsx
   /* Card — shared rounded white container used by RunBand, PillBar wrapper,
    * Filters wrapper. Replaces the inline `<Card>` previously local to
    * QueryStatePillBar.tsx. Phase 4 imports this. */
   export const Card = styled.section`
     background: var(--bg-card);
     border: 1px solid var(--border-card);
     border-radius: var(--radius-card);
     box-shadow: var(--shadow-xs);
     overflow: hidden;
     font-family: var(--font-sans);
   `;

   export const PaneHeader = styled.header`
     display: flex;
     align-items: center;
     justify-content: space-between;
     padding: 12px 14px;
     border-bottom: 1px solid var(--border-card);
     flex-shrink: 0;
   `;

   export const PaneTitle = styled.h2`
     margin: 0;
     font-size: 11px;
     font-weight: 600;
     letter-spacing: 0.06em;
     text-transform: uppercase;
     color: var(--text-muted);
   `;

   export const PaneBody = styled.div`
     flex: 1 1 auto;
     min-height: 0;
     overflow: auto;
     padding: 10px 12px;
   `;

   export const SectionLabel = styled.div`
     font-size: 11px;
     font-weight: 600;
     letter-spacing: 0.06em;
     text-transform: uppercase;
     color: var(--text-muted);
     padding: 8px 4px 6px;
   `;
   ```
   <!-- Updated: Validation Session 1 - `Card` added; QueryStatePillBar's existing local `<Card>` styled-component (currently lines 11-19) is replaced with this shared import in Phase 4. -->

   Also update `QueryStatePillBar.tsx` in this phase to import `Card` from `PaneParts` instead of its current local definition (lines 11-19). This eliminates duplication and gives Phase 4 a single source of truth.

2. **Sidebar restyle** (`QueryBuilderSidePanel.tsx`):
   - Wrap the entire inner content in `<PaneBody>`.
   - Add `<PaneHeader><PaneTitle>Schema</PaneTitle>{right slot: edit button or new-query button}</PaneHeader>` at the top.
   - The existing `Title preset="h6">All members</Title>` / "Used only" toggle stays inside the body but visually steps down (no longer competes with the pane title).
   - Cube section labels (Players → MEASURES, DIMENSIONS, TIME) — those live in `SidePanelCubeItem`; verify they already render small-cap muted. If not, swap to `<SectionLabel>`.
   - Search input: keep `<SearchInput>` but wrap with `styled.div` that sets `--radius-input: 10px` and `border: 1px solid var(--border-card)` if the default ui-kit input doesn't match.

3. **Chart pane restyle** (`ChartSidePane.tsx`):
   - Replace `PaneHeader` (tasty) with the new styled-component `PaneHeader`/`PaneTitle`.
   - Replace `PaneBody` (tasty) with the new styled-component `PaneBody`.
   - Keep the collapse-button on the right.
   - The collapsed rail (vertical "Chart" label) — restyle border-radius to match `AppPane`'s outer, render as a slim `AppPane`-shaped element 36px wide instead of a bare `<ContainerCollapsed>`. (Could be a `<AppPane id="chart-rail" defaultSize={3}>` with custom inner.)

4. **Center pane**:
   - In `QueryBuilderInternals`, the center column is a column of children (toolbar, pillbar, filters, results-tabs). Wrap each top band's container so they sit as ~10px gap-separated inner cards inside the center pane — OR — keep them as continuous bands inside one center pane card (decided in Phase 4).
   - For Phase 3, just ensure the center pane outer (the `AppPane`) has correct `min-width: 0` and `overflow: hidden`, no extra padding above/below the existing bands.

5. **Verify section labels match across panes**:
   - "SCHEMA" header (sidebar) and "PENDING REQUESTS" / "SAVED QUERIES" headers (chart pane area in reference) use the same SectionLabel style.
   - Reference also has small section descriptions ("What you're measuring") under labels — these are part of QueryStatePillBar; already in place.

6. **Compile + visual diff**: `npm run dev`, navigate to `/playground`, side-by-side compare with reference screenshot. Iterate on padding/radius/border until match.

## Todo List

- [ ] `PaneParts.tsx` written with Card, PaneHeader, PaneTitle, PaneBody, SectionLabel
- [ ] `QueryStatePillBar.tsx` imports `Card` from PaneParts; local `<Card>` styled-component removed
- [ ] Sidebar wraps in PaneBody with PaneHeader("SCHEMA"); search input radius matches
- [ ] Chart pane uses new PaneParts; collapse button retained on right
- [ ] Chart pane collapsed rail visually consistent with reference (rounded outer, vertical label)
- [ ] Center pane has correct overflow & min-width-0
- [ ] No visual regression on `SidePanelCubeItem` / `MemberLabel`
- [ ] Dev server renders without console errors

## Success Criteria

- [ ] Visual comparison vs reference: pane corners, gaps, header style, label color/case match within ~2px tolerance
- [ ] Sidebar search input has rounded pill shape (`--radius-input: 10px`)
- [ ] Section labels use `--text-muted` uppercase 11px with letter-spacing
- [ ] No regression in cube selection / drag / scroll
- [ ] `npm run typecheck` clean

## Risk Assessment

- **tasty vs styled-components mix**: child tasty components inside a styled-components parent works — both produce real DOM. Watch for color-token name mismatches (`#border` in tasty maps to ui-kit theme, `var(--border-card)` is our CSS var — they happen to both be neutral-200 today, but verify in `src/theme/ui-kit-theme.ts`).
- **antd inputs**: `SearchInput` is from ui-kit (not antd). antd's input lives in QueryBuilderResults table and is out of scope.
- **Scroll containers**: existing code relies on specific `overflow` boundaries; ensure `PaneBody` doesn't double-scroll.

## Security Considerations

None. Pure styling.

## Next Steps

→ Phase 4 decides whether top bands (toolbar/pillbar/filters) sit as inner cards inside the center pane, or as continuous bands. Decision impacts visual rhythm.
