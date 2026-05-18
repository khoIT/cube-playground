---
phase: 3
title: "Filter Strip (Separate Collapsible Pane)"
status: pending
priority: P2
effort: "2-3h"
dependencies: []
---

# Phase 3: Filter Strip (Separate Collapsible Pane)

## Overview

Add a NEW collapsible filter strip directly BELOW the `QueryStatePillBar` card (shared visual border). Industry pattern: Metabase / Looker keep filters in a separate pane, not inline with measure pickers. Backward compat — keep the iteration-1 filter row inside the pill bar (D2 decision).

**Priority:** P2 · **Status:** Pending · **Risk:** Low-Medium (intentional duplication).

## Key Insights

- D2 locked: filters appear in BOTH places (pill-bar row AND new strip). Not a defect — accepted trade-off for backward compat.
- Strip visual: shared border with pill bar above (looks unified vertically), own toggle (independent collapse).
- Collapse state persisted to localStorage so user's preference survives reloads (resolves report's open question Q2).

## Requirements

**Functional:**
- New collapsible strip below pill-bar card.
- Header: "Filters" label + chevron + count badge (number of active filters).
- Body: existing filter pills + "+ Add filter" affordance — reuse current `QueryBuilderFilters.tsx` internals.
- Toggle persists to `localStorage["gds-cube:filter-strip-collapsed"]` (boolean).
- Default state: expanded (`false`).
- Pill-bar filter row (iteration-1) untouched — both surfaces remain.

**Non-functional:**
- No new state for filter values themselves (still driven by existing query-builder state).
- Visual: top-border-radius = 0 to fuse with pill bar above; shared horizontal padding.
- Mobile: not in scope.

## Architecture

**Data flow:**
- Filter state continues to flow from existing query-builder context. No state migration.
- Only NEW state: `isCollapsed: boolean` persisted to localStorage.

**Component tree (after phase):**
```
QueryBuilderInternals
└── main column
    ├── QueryStatePillBar (Title + LIVE badge + existing 4 pill rows incl. filter row)
    ├── QueryBuilderFilters  ← restyled as strip, fused border above
    │   ├── header (collapse toggle + filter count)
    │   └── body (filter pills, +Add filter)  ← shown when !collapsed
    └── QueryBuilderResults
```

**Visual contract:**
- Pill bar bottom: border-bottom removed when filter strip is rendered immediately below.
- Filter strip: shares left/right border with pill bar; own bottom border.
- Spacing: zero gap between pill-bar card and filter strip.

## Related Code Files

**Modify:**
- `src/QueryBuilderV2/QueryBuilderFilters.tsx` — restyle from "row above pill bar" to "strip below pill bar"; add collapse header + localStorage persistence.
- `src/QueryBuilderV2/QueryBuilderInternals.tsx` — verify render order (filter component rendered AFTER pill bar). Update if currently rendered before.
- `src/QueryBuilderV2/QueryStatePillBar.tsx` — minor: conditional border-bottom (remove when filter strip mounted directly below). Pass a `connectedBelow` prop OR rely on CSS sibling selector.

**No new files.** Local component for the collapse header lives in `QueryBuilderFilters.tsx` (keep file < 200 LOC).

## Implementation Steps

1. Open `QueryBuilderFilters.tsx`. Audit current structure: where it mounts in DOM, what props it consumes.
2. Open `QueryBuilderInternals.tsx`. Confirm `QueryBuilderFilters` renders immediately after `QueryStatePillBar`. If not, reorder so it does.
3. In `QueryBuilderFilters.tsx`:
   - Add local state: `const [collapsed, setCollapsed] = useState(() => readLocalStorageBool(KEY, false))`.
   - Wrap return in a card-like container styled to fuse with pill bar (top border-radius 0, no top border).
   - Header row: chevron icon (rotates 90deg when collapsed), label "Filters", count badge from `filters.length`.
   - Click header → toggle collapsed → write to localStorage.
   - Body: existing filter rendering, conditional on `!collapsed`.
4. In `QueryStatePillBar.tsx`: drop bottom border-radius and bottom border when used in this layout. Simplest: CSS `:has(+ .filter-strip)` if browser support OK; otherwise add `connectedBelow` boolean prop set from parent.
5. Constant + helper: `STORAGE_KEY = 'gds-cube:filter-strip-collapsed'`; small `readLocalStorageBool(key, default)` helper inside file (or reuse if equivalent already exists — grep first).
6. Type-check.
7. Visual smoke: toggle a filter → verify it appears in BOTH the pill-bar row and the new strip (intentional). Collapse strip → reload → verify state restored.

## Todo List

- [ ] Audit current `QueryBuilderFilters` mount point & props
- [ ] Reorder to render below pill bar (if needed)
- [ ] Add collapse header with chevron + count badge
- [ ] Persist collapse state to localStorage
- [ ] Restyle for fused border with pill bar above
- [ ] Conditional pill-bar bottom border
- [ ] Type-check + visual smoke
- [ ] Document duplication in PR description (D2)

## Success Criteria

- [ ] Filter strip renders directly below pill bar with shared border (no gap, no double border).
- [ ] Header toggle expands/collapses body.
- [ ] Collapse state persists across reloads.
- [ ] Adding/removing a filter updates both pill-bar row AND new strip count badge.
- [ ] Default state on first visit = expanded.
- [ ] File remains < 200 LOC.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Visual duplication confuses users | Medium | Low | Accepted per D2. Document in PR; iteration-3 may unify. |
| `:has()` selector unsupported in target browsers | Low | Low | Fallback: pass `connectedBelow` prop from parent. |
| Reordering `QueryBuilderFilters` breaks existing layout assumptions | Low | Medium | Read `QueryBuilderInternals.tsx` carefully. Pre-flight grep for other consumers. |
| File grows past 200 LOC | Medium | Low | Extract collapse header to local subcomponent in same file or split helper out. |

**Rollback:** Revert the three modified files. localStorage key harmless if hook absent.

## Next Steps

Independent of Phases 1/2. Should land BEFORE Phase 4 — chart pane phase needs filter strip's final vertical footprint to size results correctly.
