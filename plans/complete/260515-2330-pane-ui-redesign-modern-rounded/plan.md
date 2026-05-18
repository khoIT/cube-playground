---
title: "Pane UI Redesign: Modern Rounded, Sleek Layout"
description: "Migrate the QueryBuilder pane system to react-resizable-panels and restyle all panes to match the Cube Playground Figma Make reference — gap-separated rounded cards on a neutral background."
status: complete
priority: P2
branch: "main"
tags: [ui, refactor, design-system]
blockedBy: []
blocks: []
created: "2026-05-15T16:29:47.915Z"
createdBy: "ck:plan"
source: skill
---

# Pane UI Redesign: Modern Rounded, Sleek Layout

## Overview

Redesign every pane in the QueryBuilder UI to match the Cube Playground Figma Make reference (captured from `Cube Playground (standalone).html`): white rounded cards on a `#fafafa` background, hairline `#e5e5e5` borders, subtle shadow, ~12-16px gaps between panes, ~12-16px radius. Keep all panes drag-resizable.

Implementation swaps `@cube-dev/ui-kit`'s `ResizablePanel` for `react-resizable-panels` (user-confirmed) and standardises the three primary panes (left sidebar, center work area, right chart pane) plus the top bands (toolbar, pill bar, filters strip) on the existing design tokens in `src/theme/tokens.css` (already aligned with the reference).

**Key finding from scout:** `tokens.css` already defines `--bg-app: #fafafa`, `--bg-card: #fff`, `--border-card: #e5e5e5`, `--radius-card: 12px`, `--shadow-xs`, Geist font, and brand orange `#f05a22` — all matching the reference exactly. `QueryStatePillBar` already uses these tokens as a card. The work is mostly extending this pattern outward, not building a new token system.

## Reference Captured

- File: `C:\Users\CPU12830-local\Downloads\Cube Playground (standalone).html` (Figma Make bundle, 1.7MB)
- Served via `python -m http.server 8765` and rendered at 1440×900 in Chrome
- 3 zoomed corner shots confirm radius ≈ 12px outer / 10px inner, hairline `#e5e5e5` border, subtle shadow ≈ `0 1px 2px rgba(0,0,0,0.04)`, `--bg-app` showing through 8-12px gaps

## Current State (key files)

- `src/QueryBuilderV2/QueryBuilderInternals.tsx` — pane layout root (sidebar + center + chart pane via `<Flex>`)
- `src/QueryBuilderV2/QueryBuilderSidePanel.tsx` — uses `ResizablePanel direction="right"`, localStorage key `QueryBuilder:Sidebar:size`
- `src/QueryBuilderV2/components/ChartSidePane.tsx` — uses `ResizablePanel direction="left"`, localStorage keys `gds-cube:chart-pane-*`
- `src/theme/tokens.css` — design tokens (already matches reference)
- `src/QueryBuilderV2/QueryStatePillBar.tsx` — already uses card tokens; reference for the pattern
- `package.json` — no resize lib dep yet; `@cube-dev/ui-kit ^0.50`, `styled-components 6`, `antd 4.16.13`

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Foundation: tokens & resize lib](./phase-01-foundation-tokens-resize-lib.md) | Complete |
| 2 | [Migrate ResizablePanel call sites](./phase-02-migrate-resizablepanel-call-sites.md) | Complete |
| 3 | [Restyle sidebar + chart + center panes](./phase-03-restyle-sidebar-chart-center-panes.md) | Complete |
| 4 | [Restyle top bands (toolbar/pillbar/filters)](./phase-04-restyle-top-bands-toolbar-pillbar-filters.md) | Complete |
| 5 | [Polish + verification](./phase-05-polish-verification.md) | Complete |

## Dependencies

None. Internal-only refactor. No backend/API change.

## Risk Summary

- **Resize regression**: `react-resizable-panels` works in % by default; existing localStorage keys store px. Mitigate with a percent-to-px shim or migrate keys.
- **ui-kit interplay**: `tasty`-styled inner content must survive the wrapper swap. Mitigate by keeping `tasty` containers inside the new pane (they receive `height:100%` from the new resizer).
- **Min/max constraints**: Current code uses px (`minSize: 280`, `maxSize: '60%'`). Convert via a px-from-container helper.
- **Sidebar disable mode**: `disableSidebarResizing` prop must still render a non-resizable sidebar.

## Unresolved Questions

- None. All clarifying questions resolved up-front (reference capture, scope, resize lib).

## Validation Log

### Session 1 — 2026-05-15
**Trigger:** `/ck:plan validate` after initial plan creation
**Questions asked:** 4
**Tier:** Full (5 phases)

#### Verification Results
- Claims checked: 9
- Verified: 8 | Failed: 1 | Unverified: 0
- Tier: Full

##### Failures
1. [Fact Checker] `@/components/AppPanes` import path — `tsconfig.json` has `baseUrl: "."` but no `paths` mapping. Path alias `@/` doesn't resolve.
   - Verified alternative: relative imports already used throughout `src/QueryBuilderV2/` (e.g. `import { useLocalStorage } from '../hooks'`).

##### Verified (sample)
- `ResizablePanel` call sites = 2 (ChartSidePane.tsx, QueryBuilderSidePanel.tsx) ✓
- `disableSidebarResizing` consumers: types.ts:29, QueryBuilder.tsx:36/122, QueryBuilderSidePanel.tsx:90/519/544/545 ✓
- `QueryBuilderToolBar` only consumed by QueryBuilderInternals.tsx ✓
- `useAutoSize` hook exists at hooks/auto-size.ts:86 ✓
- React 18.3.1 in `package.json` (matches `react-resizable-panels` peer) ✓
- `SearchInput` is from `@cube-dev/ui-kit`, not antd ✓
- `tokens.css` defines all referenced tokens (--bg-app, --bg-card, --border-card, --radius-card, --shadow-xs, Geist font, brand orange) ✓

#### Questions & Answers

1. **[Risks]** Phase 1 cites `@/components/AppPanes` but tsconfig has no `paths` alias — imports won't resolve. How to fix?
   - Options: Relative imports | Add `paths` to tsconfig+vite | Use `src/components/AppPanes` with baseUrl
   - **Answer:** Relative imports (Recommended)
   - **Rationale:** Matches existing import style in `src/QueryBuilderV2/`. Zero config change.

2. **[Architecture]** Phase 4 layout — where does the Run button live?
   - Options: Inside PillBar header right-slot | Single 'Query' supercard | Keep Run as its own slim band above PillBar
   - **Answer:** Keep Run as its own slim band above PillBar
   - **Rationale:** Cleanest separation of concerns; diverges slightly from reference but preserves component ownership boundaries. Reverses the plan's draft "Option B" decision.

3. **[Architecture]** `react-resizable-panels` version + min-size strategy:
   - Options: v2 + minSizePixels | v2 + percent only | v0.x legacy
   - **Answer:** v2 + minSizePixels (Recommended)
   - **Rationale:** Preserves existing px-based min (sidebar 280px, chart 280px) regardless of viewport width.

4. **[Scope]** Migration of existing localStorage keys:
   - Options: One-time reset | Read-old-seed-new | Leave orphaned
   - **Answer:** One-time reset — ignore old keys, autoSaveId starts fresh (Recommended)
   - **Rationale:** Simplest. Users see default sizes once after deploy; next drag persists via new key.

#### Confirmed Decisions
- Path imports: relative (`../../components/AppPanes`) — no `@/` alias
- Run button position: own slim band above PillBar — NOT inside PillBar header right-slot
- Resize lib: `react-resizable-panels` v2.x with `minSizePixels` for sidebar (280px) and chart (280px)
- localStorage: one-time reset; do not migrate `gds-cube:chart-pane-width` or `QueryBuilder:Sidebar:size`

#### Action Items
- [x] Update Phase 1 to drop `@/` alias references
- [x] Update Phase 1 to pin `react-resizable-panels@^2`
- [x] Update Phase 2 to use `minSizePixels: 280` for sidebar + chart; document no-migration
- [x] Update Phase 4 to mount RunControl as its own band card above PillBar (drop `headerRight` slot)
- [x] Whole-Plan Consistency Sweep

#### Impact on Phases
- **Phase 1**: import-path examples and Success Criteria mention `@/...` — must drop. Lib version pinned to v2.
- **Phase 2**: Architecture snippet uses `minSize: 18` percent — switch to `minSizePixels: 280`. localStorage section explicitly note "no migration".
- **Phase 4**: Architecture decision flipped from Option B (headerRight slot) to Option C (own band). Implementation steps, todo list, and success criteria updated accordingly.
- **Phase 5**: No direct change; success criteria still hold.

### Whole-Plan Consistency Sweep
- Files reread: plan.md, phase-01, phase-02, phase-03, phase-04, phase-05
- Decision deltas checked: 4
- Reconciled stale references: 4 (import path, lib version, min-size API, Phase 4 layout)
- Unresolved contradictions: 0
