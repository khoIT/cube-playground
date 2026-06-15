---
title: Revamp Left Nav Bar — Mirror Actioneer edge + arrow behavior
description: >-
  Flush sidebar↔main seam with a mouse-tracking collapse circle, and a split
  section header (label navigates / separate arrow toggles children).
status: completed
priority: P2
branch: main
tags:
  - ui
  - sidebar
  - shell
blockedBy: []
blocks: []
created: '2026-06-15T08:09:11.592Z'
createdBy: 'ck:plan'
source: skill
---

# Revamp Left Nav Bar — Mirror Actioneer edge + arrow behavior

## Overview

Mirror two Actioneer left-nav interactions into cube-playground's sidebar:

1. **Close/expand arrow** — replace the fixed round chevron at the seam with a
   **mouse-Y-tracking circle** that slides along a flush 1px edge between sidebar
   and main. Tooltip ("Collapse/Expand sidebar", 400ms delay). `ChevronLeft` when
   expanded, `ChevronRight` when collapsed. Clicking anywhere along the edge toggles.
2. **Menu-item arrow** — split each section header into two hit targets: the
   icon+label **navigates** to the section page; a **separate arrow button**
   toggles the child list only (rotates `-90°`→`0°`, two-level hover background).
   Child rows lose their hover-background (text-color change only).

**Confirmed decisions (user, 2026-06-15):**
- **Full flush-edge conversion** — sidebar↔main seam goes flush (1px edge button,
  no 8px gap, squared seam corners). See Phase 1 §"Frame treatment" for the exact
  interpretation + the one open question.
- **Adopt split header** — label navigates, separate arrow toggles. Route-change
  auto-expand still fires on navigate (existing effect in `sidebar.tsx`).
- **Do NOT add a "+ New chat" CTA** (spec §5 mentions it; cube-playground omits it).

Source spec: `plans/260615-1456-revamp-left-nav-bar/specs.md`.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Flush shell + edge collapse](./phase-01-flush-shell-edge-collapse.md) | Completed |
| 2 | [Split header + child hover](./phase-02-split-header-child-hover.md) | Completed |
| 3 | [Tests + docs](./phase-03-tests-docs.md) | Completed |

## Key files

- `src/App.tsx` (`ShellLayout`, ~L203-248) — flush seam, insert edge button between `<Sidebar />` and `<main>`.
- `src/shell/sidebar/sidebar.tsx` — square seam corners; drop the in-aside `CollapseToggle`.
- `src/shell/sidebar/collapse-toggle.tsx` → rewrite as the mouse-tracking **edge** button.
- `src/shell/sidebar/sidebar-section.tsx` — split header into link + toggle-arrow.
- `src/shell/sidebar/sidebar-item.tsx` — header link variant; child-row text-only hover; chevron rotation.
- `src/shell/theme.tsx` — tokens (`T.sidebar`, `T.surface`, `T.n200`, `T.brand`, `T.fSans`).

## Dependencies

- No cross-plan blockers. Sibling spec dir `260615-1456-revamp-left-nav-bar/` holds the source spec only (no plan frontmatter).
- Design system: `docs/design-guidelines.md` is MANDATORY. The flush conversion is a deliberate, user-confirmed departure from the floating-card seam; Phase 1 keeps every token and the outer frame intact to minimize drift.
