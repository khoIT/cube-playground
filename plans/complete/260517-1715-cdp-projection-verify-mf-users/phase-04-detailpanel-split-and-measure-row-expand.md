---
phase: 4
title: "DetailPanel split and measure-row expand"
status: complete
priority: P2
effort: "0.5d"
dependencies: [3]
---

# Phase 4: DetailPanel split and measure-row expand

## Overview

Refactor `detail-panel.tsx` (currently 216 lines, over the 200-line ceiling) by extracting the per-measure row into its own component `<MeasureRow>`. Adds click-to-expand behavior with full keyboard / aria support. Expanded content is a `children` slot in P4 â€” actual `<CdpProjectionCard>` plugs in during P5. TDD: component tests for expansion + keyboard semantics ship before the refactor lands.

## Requirements

### Functional

- `<MeasureRow measure={...} cube={...}>{expandedChildren}</MeasureRow>` renders the existing row visual (Code + chips + optional Wizard chip).
- Click on the row chevron OR row body â†’ toggle expanded.
- `Enter` / `Space` on focused row â†’ toggle expanded.
- `Escape` on focused row â†’ collapse if expanded.
- `aria-expanded` reflects state.
- `<details>` / `<summary>` semantics OR explicit `role="button"` w/ `aria-controls` â€” pick one and lock in tests.
- Only one row expanded at a time within a DetailPanel (controlled state lives in `detail-panel.tsx`).
- DetailPanel passes a `renderExpanded(measure)` slot prop OR conditional render â€” pick the simpler one.
- For cubes without `meta.cdp_source` (everything except `mf_users` this round), rows render in **legacy non-expandable mode** (no chevron, no aria-expanded).

### Non-functional

- `detail-panel.tsx` â‰¤ 200 lines after refactor.
- `measure-row.tsx` â‰¤ 200 lines.
- Existing visual styling preserved exactly â€” same chip arrangement, same spacing, same `WizardChip`.
- No new `dangerouslySetInnerHTML`.
- Component test uses `@testing-library/react` (project's existing test framework â€” vitest).

## Architecture

```
src/pages/Catalog/
  detail-panel.tsx         â—„â”€â”€ modify (orchestration only)
  measure-row.tsx          â—„â”€â”€ new (presentation + expand)
  __tests__/
    measure-row.test.tsx   â—„â”€â”€ new (FIRST)
```

### `<MeasureRow>` props

```ts
interface MeasureRowProps {
  measure: Measure;
  cube: CatalogCube;
  expanded: boolean;
  onToggle: () => void;
  expandable: boolean;       // false for cubes lacking cdp_source
  children?: ReactNode;      // rendered inside expanded region
}
```

### State in `detail-panel.tsx`

```ts
const [expandedMeasureName, setExpandedMeasureName] = useState<string | null>(null);
// onToggle = setExpandedMeasureName(prev => prev === m.name ? null : m.name)
```

## Related Code Files

- **Create:**
  - `src/pages/Catalog/measure-row.tsx`
  - `src/pages/Catalog/__tests__/measure-row.test.tsx`
- **Modify:**
  - `src/pages/Catalog/detail-panel.tsx` â€” replace inline row JSX w/ `<MeasureRow>`; add `expandedMeasureName` state
- **Read (context):**
  - existing `detail-panel.tsx` Measures section (lines 169-181) â€” verbatim styling to preserve
- **Delete:** none

## Implementation Steps (TDD)

1. **Test first** â€” `measure-row.test.tsx`:
   - Renders measure name + chips (aggType, format)
   - When `cube.meta?.source === 'wizard'` â†’ renders WizardChip (existing behavior preserved)
   - `expandable=false` â†’ no chevron, no aria-expanded
   - `expandable=true, expanded=false` â†’ chevron pointing right, `aria-expanded="false"`, children NOT in DOM
   - Click row body â†’ calls `onToggle` once
   - Press Enter on focused row â†’ calls `onToggle`
   - Press Space â†’ calls `onToggle`
   - Press Escape when expanded â†’ calls `onToggle` (collapse)
   - `expanded=true` â†’ children rendered, `aria-expanded="true"`, chevron down
   - Visual snapshot or class-name check confirming legacy styling unchanged for `expandable=false`
2. Run â†’ red.
3. Write `measure-row.tsx`.
4. Refactor `detail-panel.tsx`: import `MeasureRow`, add `expandedMeasureName` state, replace row JSX. Pass `expandable = Boolean(cube.meta?.cdp_source)`. Children slot empty (`null`) â€” gets filled in P5.
5. Verify `detail-panel.tsx` â‰¤ 200 lines (`wc -l`).
6. Manual smoke: `/catalog` â†’ mf_users â†’ click row â†’ expands (empty for now). Other cubes â†’ no chevron, no behavior change.

## Success Criteria

- [ ] â‰¥ 9 component test cases green
- [ ] `detail-panel.tsx` â‰¤ 200 lines
- [ ] `measure-row.tsx` â‰¤ 200 lines
- [ ] Catalog grid + DetailPanel for non-mf_users cubes unchanged (visual + behavior)
- [ ] WizardChip + aggType + format chips still render in same positions
- [ ] Keyboard: tab focus â†’ enter/space toggles â†’ escape collapses
- [ ] `aria-expanded` present and accurate
- [ ] No `dangerouslySetInnerHTML`
- [ ] `npm run typecheck` clean
- [ ] `npm run test` clean

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Styled-components props become unwieldy w/ expansion state | Use a single `$expanded` boolean prop, follow existing transient-prop convention from the file |
| Existing `Row` styled-component reused inline (no class hooks for testing) | Add `data-testid="measure-row"` + `data-measure-name="{m.name}"` to root; selectors stable |
| Accidental layout shift when chevron renders | Reserve chevron column width even when `expandable=false` â€” OR omit and accept visual delta only for mf_users rows. Pick latter for less risk. |
| Multiple cubes selected in fast succession leave stale `expandedMeasureName` | Reset to `null` on `cube` prop change via `useEffect([cube.name])` |
| Test brittle to chip text changes | Test queries by `role="button"` + `aria-expanded`, not text |
