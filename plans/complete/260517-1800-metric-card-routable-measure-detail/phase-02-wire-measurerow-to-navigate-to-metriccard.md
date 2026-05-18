---
phase: 2
title: "Wire MeasureRow to navigate to MetricCard"
status: completed
priority: P1
effort: "0.25d"
dependencies: [1]
---

# Phase 2: Wire MeasureRow to navigate to MetricCard

## Context Links

- Current row component: `src/pages/Catalog/measure-row.tsx`
- Parent that owns expand state: `src/pages/Catalog/detail-panel-measures.tsx`
- CDP projection (currently shown via inline expand): `src/pages/Catalog/cdp-projection/cdp-projection-card.tsx`
- Phase 1 output: `MetricCardPage` at `/metric/:cube/:member`

## Overview

Make every measure in the Catalog DetailPanel clickable, navigating to `/metric/:cube/:member` on click. Today `MeasureRow` has two modes: non-expandable (plain row) and expandable (inline CDP projection expand). After this phase: BOTH modes navigate to the MetricCard on click. CDP projection content moves into the card's "Where it lives" section in Phase 3 (until then, the inline expand is retired and CDP info is reachable only inside the card).

## Priority

P1 — turns the catalog into the natural entry point for the card. Without this, the card is reachable only by direct URL.

## Key Insights

- `MeasureRow` already accepts an `onToggle` callback — replace its semantic from "expand" to "navigate" for the click-handler path.
- `expandable` prop is currently used to differentiate cubes WITH CDP projection (clickable, opens accordion) vs WITHOUT (plain row). After P2, every row is clickable to navigate; the `expandable` flag becomes obsolete and can be removed, OR kept for a future "hover preview" surface (defer the decision).
- `DetailPanelMeasures` owns `expandedMeasureName` state for the inline expand. This state becomes dead code after P2 — remove it (and the CDP projection inline render) cleanly.
- Keyboard semantics: Enter/Space navigate to the card. Escape exits keyboard focus (no special handler needed).
- Recommended UX: keep the cube DetailPanel slid open after navigation back — react-router-dom v5 `history.goBack()` from the card returns to `/catalog` with the previous state preserved (assuming `useCatalogMeta` cache holds).

## Requirements

### Functional
- Clicking any `MeasureRow` navigates to `/metric/<measure.name>` via `history.push(...)`.
- Keyboard activation (Enter / Space) does the same.
- `MeasureRow` visually indicates clickability (hover state, cursor: pointer, focus-visible outline) for ALL rows — same affordance as today's expandable rows.
- The inline CDP projection expand path is REMOVED from `DetailPanelMeasures`. CDP content is reachable only inside the card (P3 will integrate it there).
- "Back to Catalog" link inside MetricCardPage (P1) routes to `/catalog` — covered by Phase 1's 404 panel link; verify it works for the happy-path "back" button too if any.

### Non-functional
- No new dependencies.
- `MeasureRow` stays under 200 LOC after the simplification (removing accordion state should reduce LOC).

## Architecture

```
Catalog page
  └─ DetailPanel (cube focus)
       └─ DetailPanelMeasures
            └─ MeasureRow (clickable nav surface)
                 onClick → history.push(`/metric/${measure.name}`)
                                      │
                                      ▼
                              KeepAliveRoute /metric/:cube/:member
                                      │
                                      ▼
                              MetricCardPage → MetricCard
```

## Related Code Files

- **Modify:**
  - `src/pages/Catalog/measure-row.tsx` — change click handler from `onToggle` to history-navigate (or accept a new `onClick` prop, simpler)
  - `src/pages/Catalog/detail-panel-measures.tsx` — remove `expandedMeasureName` state, remove inline `CdpProjectionCard` render, replace `onToggle` callback with navigation
- **Delete (optional, defer to P3 decision):**
  - Direct usage of `CdpProjectionCard` from `DetailPanelMeasures` — keep the file itself; usage moves into `MetricCard` in P3
- **Read for context:**
  - `src/pages/Catalog/cdp-projection/cdp-projection-card.tsx` + `project-measure.ts` — to confirm they're invokable as pure functions for P3 re-integration

## Implementation Steps

1. **Refactor `measure-row.tsx`:**
   - Replace `onToggle: () => void` prop with `onClick: () => void` (or rename for clarity).
   - Remove the `expanded` + `expandable` accordion state plumbing — every row becomes a uniform clickable surface.
   - Keep the `ClickableRow` styled-component (hover + focus-visible already correct). Remove the Chevron (no longer accordion).
   - Remove the `ExpandedRegion` + `children` slot.
   - Keep the Wizard chip, aggType chip, format chip rendering.
   - Add `role="link"` and `cursor: pointer` styling that applies unconditionally.
2. **Refactor `detail-panel-measures.tsx`:**
   - Remove `useState<expandedMeasureName>` + `useEffect` reset.
   - Remove `CdpProjectionCard` import + render.
   - Add `useHistory` from `react-router-dom`.
   - Two-segment route per Validation Session 1: split `m.name` on the first dot → `[cubeName, ...rest]; const member = rest.join('.');`. Push `/metric/${cubeName}/${member}`.
   - Pass `onClick={() => history.push(metricUrl(m.name))}` on each row, with `metricUrl` as a small local helper.

<!-- Updated: Validation Session 1 - two-segment URL (cube/member), not encoded fqn -->

   - File should drop to ~40 LOC after the simplification.
3. **Visual smoke:**
   - Open catalog, click an `active_daily` measure → URL changes to `/#/metric/active_daily.dau`, MetricCard renders.
   - Browser back button → catalog still loaded, DetailPanel still open (KeepAlive should hold).
   - Tab to a measure row, press Enter → navigates.
   - Confirm hover/focus affordance is present on EVERY measure (not just CDP-projected ones).

## Todo List

- [ ] Simplify `measure-row.tsx`: drop `expandable`/`expanded`/`children`/`onToggle`, replace with `onClick`
- [ ] Refactor `detail-panel-measures.tsx`: remove accordion state, use `history.push` per row
- [ ] Verify CDP projection callsites — `CdpProjectionCard` no longer rendered inline (P3 picks it up inside card)
- [ ] Smoke: click measure → navigates to `/metric/:cube/:member`
- [ ] Smoke: keyboard activation works
- [ ] Smoke: browser back returns to catalog with DetailPanel state intact
- [ ] Update `__tests__/measure-row.test.tsx` if present (drop accordion assertions, add nav assertion)

## Success Criteria

- [ ] Every measure row in the catalog is clickable, with visible hover/focus affordance
- [ ] Click navigates to `/metric/<measure.name>` and renders the card
- [ ] Inline CDP projection accordion is fully removed from `DetailPanelMeasures`
- [ ] No regression on rest of catalog UI (cube card click, dimensions list, joins list, pre-aggs list)
- [ ] Existing measure-row tests still pass (or are updated to reflect new behavior)
- [ ] Both modified files under 200 LOC

## Risk Assessment

- **Risk:** Existing tests in `src/pages/Catalog/__tests__/measure-row.test.tsx` assert accordion behavior. Mitigation: update tests to assert navigation (`history.push` call or rendered link). If tests don't exist, add a minimal one.
- **Risk:** Users who rely on the inline CDP expand for at-a-glance lookup lose context. Mitigation: P3 reintegrates CDP into the card with more space. Time gap is one phase — acceptable for POC. Alternatively, P3 could be sequenced first if leadership wants no-regression continuity.
- **Risk:** Browser-back behavior across `KeepAliveRoute` is untested for the `/metric ↔ /catalog` transition. Mitigation: smoke during step 3. If state is lost, accept the regression (POC) or add a `useEffect` in DetailPanel to re-open the last cube from URL state later.

## Security Considerations

- `encodeURIComponent` on `measure.name` before path interpolation. Cube measure names are alphanumeric + underscore + dot, all URL-safe — encoding is defense-in-depth.
- No new auth surface.
