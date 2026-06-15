---
phase: 1
title: Flush shell + edge collapse
status: completed
priority: P1
effort: 4-6h
dependencies: []
---

# Phase 1: Flush shell + edge collapse

## Overview

Convert the sidebar↔main seam from a floating-card gap to a flush 1px edge, and
replace the fixed round chevron with a mouse-Y-tracking collapse circle that
slides along that edge. This is the "close/expand arrow" half of the request.

## Requirements

- Functional:
  - A single, full-height clickable edge sits between sidebar and main. Clicking
    anywhere along it toggles collapse (260↔60px), reusing `setCollapsed`.
  - At rest the edge is a 1px transparent line (invisible). On hover the 1px line
    tints (`T.n200`-equivalent) and a 36×36 circle appears, centered on the edge.
  - The circle's vertical position tracks the cursor (`clientY - edgeRect.top`)
    and slides as the mouse moves; on mouse-leave it eases back to a default Y.
  - Circle icon: `ChevronLeft` when expanded, `ChevronRight` when collapsed.
  - Tooltip to the right of the circle ("Collapse sidebar" / "Expand sidebar"),
    400ms appear delay. Hand-rolled (no Radix — match `CollapsedRow` pattern in
    `sidebar-item.tsx`).
  - Collapse state still persists via `sidebar-collapsed-store` (unchanged).
- Non-functional:
  - Use only existing tokens (`T.sidebar`, `T.surface`, `T.n200`, `T.n700`,
    `T.fSans`). No raw hex, no new font stacks (design-guidelines §1-2).
  - Width transition preserved (`width 0.16s ease`, already in `sidebar.tsx`).
  - `aria-label` flips with state; tooltip text matches.

## Architecture

### Frame treatment (the one design call)

cube-playground's `ShellLayout` frames everything in a `padding: 10`, `gap: 8`,
`T.shell` background with `borderRadius: 18` cards. The user chose "full flush-edge
conversion (no gap, no rounded sidebar card)". Recommended honest interpretation
that mirrors Actioneer **without** detonating the whole shell (topbar rounding,
ChatPanel sibling, CubeApiBanner all depend on the main card):

- Make the **sidebar↔main seam flush**: remove the `gap: 8` *between those two*,
  square the sidebar's **right** corners (`borderRadius: '18px 0 0 18px'`) and the
  main card's **left** corners (`'0 18px 18px 0'`). Insert the edge button as the
  flex child between them.
- **Keep** the outer `padding: 10` + `T.shell` frame and all outer rounding —
  this preserves cube-playground's framed identity and leaves the ChatPanel /
  Topbar untouched (smallest blast radius).
- The 36×36 circle straddles the 1px seam (`right: -18` relative to the edge).

> OPEN QUESTION (confirm at review): keep the outer 10px frame (recommended), or
> go truly edge-to-edge (`padding: 0`, sidebar full-height to viewport, all
> rounding removed)? Truly edge-to-edge also requires reworking the main card +
> ChatPanel corners and is a larger change. Default = keep outer frame.

### Edge button component

Rewrite `src/shell/sidebar/collapse-toggle.tsx` (keep the filename or rename to
`sidebar-edge-toggle.tsx` — rename preferred for clarity; update the single import
in `App.tsx`/`sidebar.tsx`). It becomes a self-contained flex child rendered in
`ShellLayout` **between** `<Sidebar/>` and `<main>`, not inside `<aside>` (the
current in-aside absolute placement can't host a flush flex divider cleanly).

```
<div                              // the edge: 1px wide flex child, full height
  role="button" tabIndex={0}
  aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
  onMouseMove={e => setMouseY(e.clientY - e.currentTarget.getBoundingClientRect().top)}
  onMouseEnter={() => setHovered(true)}
  onMouseLeave={() => { setHovered(false); setMouseY(null); }}   // null → default Y (50%)
  onClick={() => setCollapsed(!collapsed)}
  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setCollapsed(!collapsed)}
  style={{ position: 'relative', width: 1, flexShrink: 0, cursor: 'pointer', zIndex: 20,
           background: hovered ? T.n200 : 'transparent', transition: 'background .12s' }}
>
  {/* widened hit-strip so a 1px target is hoverable */}
  <div style={{ position: 'absolute', insetBlock: 0, left: -8, right: -8 }} />

  {/* floating circle — appears on hover, tracks cursor Y */}
  <div style={{ position: 'absolute', width: 36, height: 36, right: -18,
                top: mouseY ?? '50%', transform: mouseY == null ? 'translateY(-50%)' : undefined,
                borderRadius: '50%', background: T.surface, border: `1px solid ${T.n200}`,
                boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                opacity: hovered ? 1 : 0, transition: 'opacity .15s ease, top .05s linear' }}>
    <Icon icon={collapsed ? ChevronRight : ChevronLeft} size={18} color={T.n700} />
  </div>

  {/* hand-rolled tooltip, right side, 400ms delay (setTimeout on enter) */}
</div>
```

- Tooltip: replicate the `CollapsedRow` fixed-position pattern — `position: fixed`,
  computed from the circle's `getBoundingClientRect().right + 8`, gated behind a
  400ms `setTimeout` cleared on leave.
- `top` transition kept very short (`.05s linear`) so the circle "slides" smoothly
  with the cursor without lagging; mouse-leave resets to `50%`.

## Related Code Files

- Modify: `src/App.tsx` — `ShellLayout`: flush seam, square inner corners, drop
  `gap` between sidebar/main, render `<SidebarEdgeToggle collapsed={…}/>` between
  `<Sidebar/>` and `<main>`. Needs the collapsed value — read via
  `getCollapsed()` + `onCollapsedChange` (same hook the sidebar uses) so the icon
  direction stays in sync.
- Modify/Rename: `src/shell/sidebar/collapse-toggle.tsx` → `sidebar-edge-toggle.tsx`
  (mouse-tracking edge button + tooltip).
- Modify: `src/shell/sidebar/sidebar.tsx` — remove `<CollapseToggle/>` from inside
  `<aside>`; set `overflow: 'hidden'` stays; square the right corners
  (`borderRadius: '18px 0 0 18px'`); drop `overflow: 'visible'` if no longer
  needed for the seam circle (circle now lives in the edge child).
- Read for context: `src/shell/sidebar/sidebar-collapsed-store.ts`, `src/shell/theme.tsx`.

## Implementation Steps

1. Rename `collapse-toggle.tsx` → `sidebar-edge-toggle.tsx`; rewrite as the
   1px flex-child edge button per the architecture sketch. Export
   `SidebarEdgeToggle({ collapsed }: { collapsed: boolean })`.
2. Add mouse-Y tracking state (`mouseY: number | null`) + hovered state; wire
   `onMouseMove`/`onMouseEnter`/`onMouseLeave`/`onClick`/`onKeyDown`.
3. Implement the floating circle (icon direction by `collapsed`) and the
   400ms-delayed hand-rolled tooltip (fixed-position, right side, sideOffset 8).
4. In `sidebar.tsx`: delete the `<CollapseToggle/>` line + import; square the
   sidebar's right corners; verify the aside no longer needs `overflow: visible`.
5. In `App.tsx` `ShellLayout`: lift collapsed state (`getCollapsed`/`onCollapsedChange`);
   remove the inter-element gap between sidebar and main (keep outer padding);
   square the main card's left corners; insert `<SidebarEdgeToggle collapsed={…}/>`
   between `<Sidebar/>` and `<main>`.
6. `npm run build` (or `tsc --noEmit`) to confirm no type/compile errors.
7. Manual check: hover seam → 1px line tints + circle appears at cursor Y and
   slides; click toggles; collapsed shows `ChevronRight`; tooltip after 400ms.

## Success Criteria

- [ ] Edge is invisible at rest; 1px line tints on hover.
- [ ] Circle appears on hover, tracks/slides with cursor Y, resets to center on leave.
- [ ] Click anywhere on the edge toggles collapse; state persists across reload.
- [ ] Icon = `ChevronLeft` expanded / `ChevronRight` collapsed; `aria-label` flips.
- [ ] Tooltip shows on the right after 400ms with correct text.
- [ ] No raw hex / new fonts; only `T.*` tokens. Build passes.
- [ ] Sidebar↔main seam is flush (no 8px gap); outer frame unchanged.

## Risk Assessment

- **ChatPanel sibling** sits after `<main>` in the same flex row — confirm the
  edge button placement doesn't shift its layout. Mitigation: edge is a 1px
  shrink-0 child only between sidebar and main.
- **Circle z-index / clipping**: aside had `overflow: visible` to let the old
  toggle bleed out. Now the circle lives in the edge child (sibling of aside), so
  aside can clip normally; ensure the edge child has `zIndex: 20` so the circle
  floats over the main card's left padding.
- **Collapsed-state duplication**: both `Sidebar` and `ShellLayout` now read
  collapsed. Both subscribe to the same store event — no divergence, but verify
  initial paint matches (both call `getCollapsed()` synchronously).
