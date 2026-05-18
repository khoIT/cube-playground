---
phase: 3
title: "Resizable columns"
status: pending
priority: P2
effort: "2h 30m"
dependencies: [2]
---

# Phase 3: Resizable columns

## Overview

Let users drag column boundaries in the results table to resize. Persist widths per column name to localStorage. ui-kit's `Grid` is plain CSS Grid — no native resize — so we build it: track widths in state, override `gridTemplateColumns`, render thin drag handles on the right edge of each column header.

## Requirements

- Each column header gets a 6px-wide vertical drag handle on its right edge. Hover → visible cursor `col-resize` and accent stripe on the handle. Drag → live update of column width.
- Min width per column: 80px. Max: 800px.
- Widths persist in localStorage under key `QueryBuilder:Results:columnWidths` as `{ [columnName: string]: number }`.
- New columns (not in storage) default to `auto` / `min-content` — they auto-size from content until the user drags.
- Reorder via existing `ReorderableMemberList` must not break: widths are keyed by column name, not index, so reordering rebinds widths correctly.
- Resize handle must not steal pointer from the column header drag-to-reorder. Handle does `stopPropagation` on pointerdown.
- ESC during a drag → cancel (restore pre-drag width).

## Architecture

```
QueryBuilderResults.tsx
├── useColumnWidths()  ← new hook (in same file or a sibling module)
│     ├── widths: Record<string, number>
│     ├── setWidth(name, w): persisted to localStorage
│     └── columnTemplate: string for gridTemplateColumns
├── GridTable
│     ├── columns prop computed from columnTemplate (dimensions + time + measures order)
│     └── ColumnHeader gets <ColumnResizeHandle name={name} /> child
└── ColumnResizeHandle  ← new component, absolutely positioned right edge of header
```

The trick: GridTable receives `columns` prop already. We compute the template by walking `dimensions` + `timeDimensions` + `measures` in order, looking up `widths[name]` or falling back to `minmax(140px, auto)`.

The handle is absolutely positioned at `right: 0; width: 6px; top: 0; bottom: 0`. ColumnHeader is `position: sticky` not `relative`, but `position: sticky` establishes a positioning context for absolute children — works.

## Related Code Files

- Modify: `src/QueryBuilderV2/QueryBuilderResults.tsx`
  - Add `useColumnWidths` hook (or import from new file)
  - Compute `columns` prop dynamically from the order of `[dimensions, timeDimensions, measures]`
  - Wrap or inject `<ColumnResizeHandle>` inside each `ColumnHeader` rendered cell
  - Keep `min 140px` floor on cells unchanged (acts as a sanity check if user sets a tiny width)
- Create: `src/QueryBuilderV2/components/column-resize-handle.tsx`
  - `<ColumnResizeHandle name onResize onCommit />`
  - Pointer events, ESC cancel, body cursor lock during drag
- Create: `src/QueryBuilderV2/hooks/use-column-widths.ts`
  - `useColumnWidths(storageKey)` returns `{ widths, setWidth, getColumnTemplate(orderedNames, fallback) }`

## Implementation Steps

1. **Create the hook** `src/QueryBuilderV2/hooks/use-column-widths.ts`:
   ```ts
   import { useCallback, useState } from 'react';
   import { useLocalStorage } from '../hooks';

   export function useColumnWidths(storageKey: string) {
     const [widths, setWidths] = useLocalStorage<Record<string, number>>(storageKey, {});

     const setWidth = useCallback((name: string, w: number) => {
       setWidths((prev) => ({ ...prev, [name]: Math.max(80, Math.min(800, w)) }));
     }, [setWidths]);

     const getColumnTemplate = useCallback(
       (names: string[], fallback = 'minmax(140px, auto)') =>
         names.map((n) => (widths[n] ? `${widths[n]}px` : fallback)).join(' '),
       [widths]
     );

     return { widths, setWidth, getColumnTemplate };
   }
   ```

2. **Create the resize handle** `src/QueryBuilderV2/components/column-resize-handle.tsx`:
   ```tsx
   import { useEffect, useRef, useState } from 'react';
   import styled from 'styled-components';

   const Handle = styled.div<{ $active: boolean }>`
     position: absolute;
     top: 0;
     right: -3px;            /* sit on the boundary between cells */
     bottom: 0;
     width: 6px;
     cursor: col-resize;
     z-index: 3;
     user-select: none;
     touch-action: none;

     &::after {
       content: '';
       position: absolute;
       top: 4px;
       bottom: 4px;
       left: 2px;
       width: 2px;
       background: ${(p) => (p.$active ? 'var(--brand)' : 'transparent')};
       border-radius: 2px;
       transition: background 0.12s ease;
     }
     &:hover::after {
       background: var(--neutral-300);
     }
   `;

   type Props = {
     name: string;
     getStartWidth: () => number; // measured from DOM at pointerdown
     onResize: (w: number) => void;
     onCommit: (w: number) => void;
   };

   export function ColumnResizeHandle({ name, getStartWidth, onResize, onCommit }: Props) {
     const [active, setActive] = useState(false);
     const startXRef = useRef(0);
     const startWRef = useRef(0);
     const currentWRef = useRef(0);

     useEffect(() => {
       if (!active) return;
       const onMove = (e: PointerEvent) => {
         const next = Math.max(80, Math.min(800, startWRef.current + (e.clientX - startXRef.current)));
         currentWRef.current = next;
         onResize(next);
       };
       const onUp = () => {
         setActive(false);
         onCommit(currentWRef.current);
         document.body.style.cursor = '';
       };
       const onKey = (e: KeyboardEvent) => {
         if (e.key === 'Escape') {
           setActive(false);
           onResize(startWRef.current); // restore
           document.body.style.cursor = '';
         }
       };
       window.addEventListener('pointermove', onMove);
       window.addEventListener('pointerup', onUp);
       window.addEventListener('keydown', onKey);
       return () => {
         window.removeEventListener('pointermove', onMove);
         window.removeEventListener('pointerup', onUp);
         window.removeEventListener('keydown', onKey);
       };
     }, [active, onResize, onCommit]);

     return (
       <Handle
         $active={active}
         data-column={name}
         onPointerDown={(e) => {
           e.stopPropagation(); // prevent reorder-drag pickup
           e.preventDefault();
           startXRef.current = e.clientX;
           startWRef.current = getStartWidth();
           currentWRef.current = startWRef.current;
           document.body.style.cursor = 'col-resize';
           setActive(true);
         }}
       />
     );
   }
   ```

3. **Wire into QueryBuilderResults.tsx**:
   - Import hook + handle.
   - Inside `QueryBuilderResults`, after destructuring context:
     ```ts
     const { widths, setWidth, getColumnTemplate } = useColumnWidths('QueryBuilder:Results:columnWidths');
     const orderedColumnNames = useMemo(() => [
       ...dimensions,
       ...timeDimensions.map((td) => td.dimension),
       ...measures,
     ], [dimensions, timeDimensions, measures]);
     const columnsTemplate = getColumnTemplate(orderedColumnNames);
     const [livePreview, setLivePreview] = useState<Record<string, number>>({});
     // during drag, livePreview overrides; commit moves into storage
     const liveTemplate = useMemo(() => {
       if (!Object.keys(livePreview).length) return columnsTemplate;
       return orderedColumnNames.map((n) => `${livePreview[n] ?? widths[n] ?? null}px`.replace('nullpx', 'minmax(140px, auto)')).join(' ');
     }, [orderedColumnNames, livePreview, widths, columnsTemplate]);
     ```
   - Replace `<GridTable columns={\`repeat(${totalColumns}, auto)\`}>` with `<GridTable columns={liveTemplate}>`.

4. **Inject `<ColumnResizeHandle>` in each header cell**. Three places: `dimensionColumns`, `timeDimensionsColumns`, `measuresColumns`. Add a `position: relative` to `ColumnHeader` (or rely on the existing `position: sticky` which is a positioning context). Render the handle as a child of `<ColumnHeader>` after the `<OptionsButton>`.
   ```tsx
   <ColumnResizeHandle
     name={dimension}
     getStartWidth={() => {
       const el = document.querySelector(`[data-resize-anchor="${dimension}"]`) as HTMLElement | null;
       return el?.getBoundingClientRect().width ?? 140;
     }}
     onResize={(w) => setLivePreview((p) => ({ ...p, [dimension]: w }))}
     onCommit={(w) => { setWidth(dimension, w); setLivePreview((p) => { const { [dimension]: _, ...rest } = p; return rest; }); }}
   />
   ```
   And add `data-resize-anchor={dimension}` (or measure/timeDimension.dimension) on the `ColumnHeader` element so width measurement is reliable.

5. **No reorder regression**: `ReorderableMember` binds drag via `useDraggableItem`. The handle's `stopPropagation` on `onPointerDown` blocks the reorder hit zone for the rightmost 6px of the header — acceptable trade-off.

6. **Persistence robustness**:
   - On read: localStorage may have stale entries for removed columns. Harmless — they sit in the dict until cleaned. Optionally garbage-collect on mount via `useEffect` if dict has keys not in `orderedColumnNames` AND `Object.keys(widths).length > orderedColumnNames.length * 3` (avoid pathological growth).
   - Schema: simple `{ [name]: number }` JSON. No version key needed for this scope.

7. **typecheck + build**: `npm run typecheck` + `npx vite build`.

8. **Manual QA**:
   - Drag a dimension column right → it widens, neighbors compress (CSS Grid handles flexing).
   - Drag a measure column left below 140px → clamps at 80px (our floor) — verify visually.
   - Refresh page → widths persist.
   - Reorder columns via header drag → widths still attached to correct columns.
   - Press ESC mid-drag → width restores.
   - Cells with `nowrap` truncate cleanly via `text-overflow: ellipsis` when narrow (CELL_STYLES already has this).

## Success Criteria

- [ ] Drag handle visible (or hoverable) on the right edge of each column header
- [ ] Drag updates column width live, neighbors flex accordingly
- [ ] Width clamped to [80, 800] px
- [ ] Widths persist across page reload
- [ ] Widths re-attach to the right column after reordering
- [ ] ESC during drag cancels and restores starting width
- [ ] Reorder-via-header-drag still works (not blocked by resize handle on the rest of the header)
- [ ] `npx vite build` clean

## Risk Assessment

- **ColumnHeader uses `position: sticky` which IS a positioning context** — absolute children resolve against it. If a future refactor changes the header to non-sticky, the handle position breaks. Mitigation: leave a code comment on the handle noting this dependency.
- **CSS Grid + auto + px mixed values**: `gridTemplateColumns: "200px minmax(140px, auto) 300px"` is valid. New columns auto-size; touched ones use px. Verified mentally; verify in browser too.
- **Live drag re-renders the entire grid 60×/sec**: the cells use `useMemo` already; the only thing that changes is the parent `gridTemplateColumns`. Browser GPU-composites grid layout; should be fine on a 100-row × 10-col grid. If laggy, throttle `onResize` via `requestAnimationFrame`.
- **localStorage write on every commit**: only fires on pointerup, not during drag — already cheap.
- **`useLocalStorage` hook semantics**: confirm it accepts an object value and updater function. If it only takes a value (no updater), replace the `setWidths((prev) => ...)` with explicit read-modify-write. Inspect `src/QueryBuilderV2/hooks/index.ts` (or wherever it's exported) during impl.

## Security Considerations

None — purely client-side state and styling.

## Next Steps

→ Phase 4 verification.
