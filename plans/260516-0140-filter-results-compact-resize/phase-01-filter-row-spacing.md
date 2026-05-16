---
phase: 1
title: "Filter row spacing"
status: pending
priority: P2
effort: "45m"
dependencies: []
---

# Phase 1: Filter row spacing

## Overview

Image #4 shows the FILTERS row with proper vertical breathing room around the filter chip, a clear visual gap above the `+ Add` / `× Remove all` row, and a subtle dashed divider when multiple filters stack. Current code has the right structure but chip wrappers collapse their margins, leaving chips cramped against row borders.

## Requirements

- Filter chip (DateRangeFilter / FilterMember / SegmentFilter wrappers) has 6px vertical, 8px horizontal internal padding so the inner controls aren't flush to the chip edge.
- Stacked filter chips separated by a subtle 1px dashed `var(--neutral-100)` divider (matches `.qrow` divider language).
- Vertical gap between the chips column and the footer row (`+ Add` / `× Remove all`) is 10-12px (`InlineWrapper` gap raised from 8px → 12px).
- Filter row outer padding inside `FilterRow` (in `QueryStatePillBar.tsx`) bumps vertical padding from `--qrow-padding-y` to a slightly looser variant — keep compact but breathable.
- `+ Add` button stays left, `× Remove all` stays right (already correct).

## Architecture

Three files touched:
- `src/QueryBuilderV2/QueryBuilderFilters.tsx` — `InlineWrapper` gap, optional `ChipDivider` between chips
- `src/QueryBuilderV2/components/DateRangeFilter.tsx` — `DateRangeFilterWrapper` padding
- `src/QueryBuilderV2/components/FilterMember.tsx` — equivalent wrapper padding
- `src/QueryBuilderV2/components/SegmentFilter.tsx` — equivalent wrapper padding

Optional: add 2 tokens in `src/theme/tokens.css`:
- `--filter-chip-padding: 6px 8px;`
- `--filter-chip-divider: 1px dashed var(--neutral-100);`

## Related Code Files

- Modify: `src/QueryBuilderV2/QueryBuilderFilters.tsx`
  - `InlineWrapper` gap 8px → 12px
  - Optionally: wrap each chip in a `<ChipShell>` with bottom dashed border; suppress on last child
- Modify: `src/QueryBuilderV2/components/DateRangeFilter.tsx` — `DateRangeFilterWrapper`: remove `margin: -.5x`, change `padding: .5x` → `padding: 6px 8px` (or `0`, see step 2)
- Modify: `src/QueryBuilderV2/components/FilterMember.tsx` — same pattern as DateRangeFilter
- Modify: `src/QueryBuilderV2/components/SegmentFilter.tsx` — same pattern
- Modify (optional): `src/theme/tokens.css` — add 2 chip tokens

## Implementation Steps

1. **Inspect chip wrappers** to confirm the `margin: -.5x; padding: .5x` pattern across DateRangeFilter, FilterMember, SegmentFilter. Decide: keep padding (add breathing) OR pull padding up into the parent chips column (one canonical wrapper).

2. **Adjust chip wrappers**: in each chip styled wrapper, replace `margin: -.5x` + `padding: .5x` with `padding: 6px 8px` and remove the negative margin. This makes the white-card chip have visible padding around its inner controls (drag handle, member pill, operator dropdown, value editor, X close).

3. **InlineWrapper** in `QueryBuilderFilters.tsx`:
   ```tsx
   const InlineWrapper = styled.div`
     display: flex;
     flex-direction: column;
     gap: 12px;
   `;
   ```

4. **Chip divider** (multi-filter case). Inside `chipsColumn`, after each chip except the last, render a `<ChipDivider />`. Two options — pick the cleanest:
   - **A (CSS)**: target every chip wrapper with `:not(:last-child) { border-bottom: 1px dashed var(--neutral-100); padding-bottom: 8px; }` on the parent `Flex flow="column"`.
   - **B (explicit)**: render `<ChipDivider />` styled-component between siblings (`React.Children.toArray(...).flatMap((c, i, arr) => i < arr.length - 1 ? [c, <ChipDivider key={\`d${i}\`} />] : [c])`).
   - Recommended: **A**. It's terser and the parent `Flex` is already in our control.

5. **Footer vertical gap**: already covered by `InlineWrapper` step 3 (gap 12px).

6. **No-chip state**: when `hasAnyChips` is false, chipsColumn isn't rendered → just the footer row sits in the FilterRow. Visual check: the footer alone should still have the row's `--qrow-padding-y` breathing room around it (no change needed; FilterRow already applies it).

7. **typecheck + build**: `npm run typecheck` + `npx vite build`. Build is source of truth.

8. **Visual diff vs Image #4**:
   - Single filter: white chip with internal padding, "+Add" + "× Remove all" row below with 12px gap.
   - Two filters: stacked with dashed divider between, then "+Add"/"× Remove all" row.

## Success Criteria

- [ ] Filter chip wrappers have `padding: 6px 8px` (or equivalent) — inner controls no longer flush to chip edge
- [ ] Multi-filter stacks render a 1px dashed `var(--neutral-100)` divider between chips
- [ ] 12px vertical gap between last chip and the `+ Add` / `× Remove all` row
- [ ] `+ Add` left, `× Remove all` right — unchanged
- [ ] No regression on no-filter state (just `+ Add` showing)
- [ ] `npx vite build` clean

## Risk Assessment

- **Filter chip controls misalign with new padding**: the inner Space inside DateRangeFilterWrapper has its own gap; verify visually that the install_date pill / operator dropdown / date pickers still line up cleanly with 6px vertical padding. Mitigation: bump to `4px 8px` if 6px feels heavy.
- **Divider draws inside the chip wrapper if applied wrong**: target the parent `Flex flow="column"` children, not the chip wrappers themselves, to avoid double borders.

## Next Steps

→ Phase 2 (results compaction) is independent — can be parallel with this.
