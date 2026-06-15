---
phase: 2
title: Split header + child hover
status: completed
priority: P1
effort: 4-6h
dependencies:
  - 1
---

# Phase 2: Split header + child hover

## Overview

The "menu-item arrow" half. Split each expandable section header into two hit
targets — icon+label navigates, a separate arrow button toggles the child list —
with the chevron rotation and two-level hover backgrounds from the spec. Child
rows lose their hover-background (text-color change only).

## Requirements

- Functional:
  - Header row: clicking **icon+label** navigates to the section page (`to`) and
    does NOT toggle children directly. Clicking the **arrow button** toggles
    children and does NOT navigate.
  - The whole header row shares one hover background (`rgba(0,0,0,0.04)`, the
    current value ≈ spec's 6%). On row hover the arrow button picks up the same
    light bg; on **direct** arrow hover it gets a stronger bg (`rgba(0,0,0,0.08)`
    ≈ spec's 12%, must override the row-hover bg).
  - Chevron uses a **single** `ChevronDown` icon rotated `-90deg` (closed) →
    `0deg` (open) via `transition: transform .2s` (replaces the current
    `ChevronRight`↔`ChevronDown` swap).
  - Auto-expand on route change is preserved (effect in `sidebar.tsx` already
    calls `setSectionExpanded` on navigate), so clicking the label still results
    in an expanded section.
  - `flat` sections (Advisor) stay single-link, no arrow.
  - Collapsed (60px) rail: unchanged — no arrow, icon-only, existing tooltip.
- Non-functional:
  - Keep `T.*` tokens; no raw hex beyond the existing `rgba(0,0,0,...)` overlays
    already used in `sidebar-item.tsx` (consistent with current file).
  - Arrow button: `aria-label="Toggle {label} list"`, real `<button>`,
    `stopPropagation` so the click never bubbles to the NavLink.

## Architecture

The header today is ONE `SidebarItem` that is simultaneously a NavLink and an
onClick toggle. Split it inside `SidebarSection`:

```
// sidebar-section.tsx (expanded, non-flat, non-collapsed)
<div style={{ display: 'flex', alignItems: 'center', borderRadius: 0 }}
     onMouseEnter/Leave → rowHovered>
  <SidebarItem                       // link half: navigates only
    icon={icon} label={headerLabel} to={to} matchPrefix={matchPrefix}
    collapsed={false}
    /* expandable=false → renders no chevron, stays a NavLink */
    style flex:1
  />
  <button                            // toggle half: toggles only
    aria-label={`Toggle ${label} list`}
    onClick={e => { e.preventDefault(); e.stopPropagation(); onToggle(); }}
    style={{ width: 28, height: 28, marginRight: 4, borderRadius: 4,
             background: arrowHovered ? 'rgba(0,0,0,0.08)'
                        : rowHovered ? 'rgba(0,0,0,0.04)' : 'transparent',
             transition: 'background .12s' }}
    onMouseEnter/Leave → arrowHovered
  >
    <Icon icon={ChevronDown} size={14} color={T.n400}
          style={{ transition: 'transform .2s',
                   transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)' }} />
  </button>
</div>
```

Implementation choice — keep the split logic **in `SidebarSection`** (it already
owns `expanded`/`onToggle`), and reduce `SidebarItem`'s header role to a pure
navigable row. This avoids overloading `SidebarItem` with two-target logic.

`SidebarItem` changes needed:
- Allow the row hover-bg to be **driven by the parent** (so the shared row hover
  covers both halves). Simplest: wrap the whole flex row (link + arrow) in the
  hover container in `SidebarSection` and let the link half be `background:
  transparent` (parent paints the hover). Move the row-level
  `onMouseEnter/Leave` bg paint out of `SidebarItem` for the header case, OR pass
  a `headerLink` prop that disables `SidebarItem`'s own hover paint. Pick the
  prop approach to keep child/recent rows untouched.
- `Icon` must accept a `style` (for the rotation `transform`/`transition`). Check
  `src/shell/theme.tsx` `Icon` — if it doesn't forward `style`, add it.

Child / sub-item rows (`indent` in `SidebarItem`):
- Remove the `rgba(0,0,0,0.04)` hover background paint for `indent` rows; keep
  only the text-color change (`T.n500`/`T.n800` → `T.n950`/`T.n800` on hover).
  Active indented rows keep their `rgba(0,0,0,0.05)` box highlight (that's
  active-state, not hover — leave it).

## Related Code Files

- Modify: `src/shell/sidebar/sidebar-section.tsx` — render split header (link +
  arrow button), own `rowHovered`/`arrowHovered`, rotation + two-level bg.
- Modify: `src/shell/sidebar/sidebar-item.tsx` — add `headerLink` prop (suppress
  own hover paint + own chevron) for the header-link case; make `indent` rows
  text-color-only on hover.
- Possibly modify: `src/shell/theme.tsx` — `Icon` to forward `style` if missing.
- Read for context: `src/shell/sidebar/sidebar.tsx` (auto-expand effect, `flat`).

## Implementation Steps

1. In `theme.tsx`, confirm `Icon` forwards a `style` prop; add it if absent
   (needed for chevron rotation).
2. In `sidebar-item.tsx`: add `headerLink?: boolean`. When set, the row paints no
   hover bg of its own and renders no chevron (parent handles both). Keep NavLink
   navigation. For `indent` rows, drop the hover-bg paint (text color only).
3. In `sidebar-section.tsx`: for non-flat, non-collapsed sections render the
   flex header wrapper with `rowHovered`; inside it a `headerLink` `SidebarItem`
   (flex:1) + a separate 28×28 toggle `<button>` with `arrowHovered`, rotation,
   and two-level bg. Arrow `onClick` → `e.preventDefault()` + `stopPropagation()`
   + `onToggle()`.
4. Keep `flat` and `collapsed` header paths exactly as they are (single link /
   icon-only). Verify Advisor (`flat`) renders no arrow.
5. `npm run build` / `tsc --noEmit` — no type errors.
6. Manual check: click "Metrics" label → navigates + section auto-expands; click
   arrow alone → toggles without navigating; row hover lights both halves; direct
   arrow hover darkens the arrow; chevron rotates smoothly; child rows change
   text color only (no bg flash).

## Success Criteria

- [ ] Label/icon click navigates (no direct toggle); arrow click toggles (no nav).
- [ ] Row hover paints a shared bg across label + arrow; direct arrow hover is darker.
- [ ] Chevron is one `ChevronDown` rotating `-90°`(closed)→`0°`(open), animated 200ms.
- [ ] Child rows: text color changes on hover, no background change; active box highlight intact.
- [ ] `flat` (Advisor) + collapsed rail unchanged.
- [ ] Arrow button has `aria-label="Toggle {label} list"`; build passes.

## Risk Assessment

- **Click bubbling**: arrow is inside the NavLink's visual row — if not a separate
  flex sibling, the click navigates. Mitigation: render arrow as a sibling of the
  NavLink (not a child) + `preventDefault`/`stopPropagation`.
- **Shared hover paint**: moving hover bg from `SidebarItem` to the wrapper risks
  regressing chat-recents / playground recents that reuse `SidebarItem`. Mitigation:
  gate behind the new `headerLink` prop; default behavior untouched for all other rows.
- **Auto-expand coupling**: clicking the label navigates → route effect expands.
  If a section's `to` doesn't match its `PATH_TO_SECTION` prefix the auto-expand
  won't fire (header looks like it "did nothing"). Verify each section's `to`
  maps in `sidebar-section-store.ts` (`liveops`, `dashboards`, etc. — all present).
