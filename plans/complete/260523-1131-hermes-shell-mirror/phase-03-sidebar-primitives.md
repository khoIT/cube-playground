---
phase: 3
title: "Sidebar Primitives"
status: pending
priority: P1
effort: "90 min"
dependencies: [1, 2]
---

# Phase 3: Sidebar Primitives

## Context Links

- Spec: [`phase-00-spec/pixel-spec.md`](./phase-00-spec/pixel-spec.md) § SidebarItem / WorkspacePill / SidebarSection / SidebarSubheader / BottomRow / CollapseToggle
- Spec: [`phase-00-spec/port-manifest.md`](./phase-00-spec/port-manifest.md) § "Shell — sidebar"
- Visual baseline: [`phase-00-spec/huashu-prototype.html`](./phase-00-spec/huashu-prototype.html)

## Overview

Port 7 atomic sidebar components from Hermes into `src/shell/sidebar/*`. Most are 🟢 verbatim copies; only `workspace-pill.tsx` and `bottom-row.tsx` need cube-specific adaptations. Apply RR6→RR5 API swaps from port-manifest.

## Key Insights

- `NavLink` API identical between RR5 and RR6 — no code changes.
- `useNavigate()` → `useHistory()` swap: 3 call sites (`workspace-pill`, `bottom-row`).
- `useT()` → `useTranslation()` swap: 2 call sites (`bottom-row`, `recent-items`).
- Drop `ChatContextMenu` from `recent-items.tsx` (chat is placeholder, no per-thread actions).
- Drop Hermes-specific localizers (`localizedSegmentNameById`/etc) — cube passes titles verbatim.
- BottomRow rewritten for cube: drop Data/Settings/Account rows; render **API Settings trigger** + **Theme toggle**. No user-row (cube has no `/account` page).

## Requirements

### Functional
- Each primitive renders correctly in both expanded (260px parent) and collapsed (60px parent) modes.
- Active route highlighting via 3px brand left bar (top-level) or box highlight (indent).
- Hover bg `rgba(0,0,0,0.04)` on idle rows, `rgba(0,0,0,0.05)` on active+indent rows.
- Collapsed mode: hover shows fixed-position tooltip at `r.right + 8px`.
- Tree-line guide at `left: 23, width: 1, rgba(0,0,0,0.08)` under expanded sections.
- CollapseToggle reveals on seam hover (16px hit strip), 28px circle button at `top: 50vh sticky`.

### Non-functional
- Each file ≤ 220 lines.
- Uses only `T` from `src/shell/theme` + `react-router-dom@5` + `lucide-react` + local stores.
- No AntD imports.

## Architecture

```
src/shell/sidebar/
  sidebar-item.tsx         (~210 lines)  ← atomic row + collapsed variant + tooltip
  sidebar-section.tsx      (~90 lines)   ← wraps SidebarItem header + children + tree-line
  sidebar-subheader.tsx    (~20 lines)   ← uppercase mono group label
  workspace-pill.tsx       (~80 lines)   ← GDS glyph + Cube Playground title/subtitle
  recent-items.tsx         (~70 lines)   ← LRU-rendered indent sub-rows
  bottom-row.tsx           (~100 lines)  ← API Settings + Theme toggle (cube-specific)
  collapse-toggle.tsx      (~85 lines)   ← seam-hover round button
```

## Related Code Files

### Create
- `src/shell/sidebar/sidebar-item.tsx`
- `src/shell/sidebar/sidebar-section.tsx`
- `src/shell/sidebar/sidebar-subheader.tsx`
- `src/shell/sidebar/workspace-pill.tsx`
- `src/shell/sidebar/recent-items.tsx`
- `src/shell/sidebar/bottom-row.tsx`
- `src/shell/sidebar/collapse-toggle.tsx`

### Modify
- None

### Delete
- None

## Implementation Steps

1. **`sidebar-item.tsx`** — 🟢 copy verbatim from `hermes/apps/web/src/components/sidebar/sidebar-item.tsx`. No edits. RR5 `NavLink` compatible.

2. **`sidebar-section.tsx`** — 🟢 copy verbatim. Adjust imports: `recent-items-store` → `./sidebar-section-store` (`getSectionExpanded` / `setSectionExpanded` live there now). Adjust event name: `hermes:sidebar-expand-changed` → `gds-cube:sidebar-expand-changed`.

3. **`sidebar-subheader.tsx`** — 🟢 copy verbatim from `hermes/apps/web/src/components/sidebar/sidebar-subheader.tsx`.

4. **`workspace-pill.tsx`** — 🟡 cube-specific:
   - Replace `useNavigate` import with `useHistory` from `react-router-dom`
   - `const navigate = useNavigate()` → `const history = useHistory()`
   - `navigate('/welcome')` → `history.push('/build')`
   - Glyph text: `VG` → `GDS`
   - Title: `Hermes` → `Cube Playground`
   - Subtitle: `Thinking → Actionable Data` → `Self-serve data exploration`
   - All other styles verbatim per `pixel-spec.md` § WorkspacePill.

5. **`recent-items.tsx`** — 🟡:
   - Replace `useI18n` import with: nothing (drop localizers)
   - Drop `localizedSegmentNameById`/`localizedCampaignNameById`/`localizedThreadTitleById` calls
   - `const localize = (id, title) => title;` (passthrough)
   - Drop `ChatContextMenu` import + `trailing={…}` prop on chat rows
   - Event listener: `hermes:recent-changed` → `gds-cube:recent-changed`
   - `getRecent` from `./recent-items-store`
   - `RecentModule` from `./recent-items-store`

6. **`bottom-row.tsx`** — 🔴 rewrite:
   ```tsx
   import { Settings2, Sun, Moon } from 'lucide-react';
   import { SidebarItem } from './sidebar-item';
   import { useTheme } from '../../theme/use-theme';                  // cube hook
   import { useSecurityContext } from '../../components/SecurityContext/...';  // verify path
   import { T } from '../theme';

   export function BottomRow({ collapsed }: { collapsed?: boolean }) {
     const { theme, toggle } = useTheme();
     const security = useSecurityContext();  // exposes openModal() — verify or add

     return (
       <div style={{ borderTop: '1px solid rgba(0,0,0,0.06)', padding: '6px 0 8px' }}>
         <SidebarItem
           icon={Settings2}
           label="API Settings"
           collapsed={collapsed}
           onClick={() => security.openModal()}
         />
         <SidebarItem
           icon={theme === 'dark' ? Sun : Moon}
           label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
           collapsed={collapsed}
           onClick={toggle}
         />
       </div>
     );
   }
   ```
   - If `useSecurityContext` doesn't expose `openModal()`, defer to Phase 6 to add an event-dispatch workaround (`window.dispatchEvent(new Event('gds-cube:open-api-settings'))` + listener in the modal component). Document in code comment.

7. **`collapse-toggle.tsx`** — 🟢 copy verbatim. Imports `setCollapsed` from `./sidebar-collapsed-store` (already cube-prefixed).

8. **`npm run typecheck`** — must pass.

9. **Smoke render** — temporarily mount `<SidebarItem icon={Users} label="Test" to="/segments" />` in any page during dev → verify hover + active states.

## Todo List

- [ ] Create `sidebar-item.tsx` (verbatim port)
- [ ] Create `sidebar-section.tsx` (verbatim port + import + event-name fix)
- [ ] Create `sidebar-subheader.tsx` (verbatim port)
- [ ] Create `workspace-pill.tsx` (cube-branded, RR5 swap)
- [ ] Create `recent-items.tsx` (drop localizers + ChatContextMenu)
- [ ] Create `bottom-row.tsx` (API Settings + Theme toggle)
- [ ] Create `collapse-toggle.tsx` (verbatim port)
- [ ] `npm run typecheck` passes
- [ ] Smoke: SidebarItem renders w/ correct hover + active

## Success Criteria

- [ ] All 7 files compile cleanly.
- [ ] `SidebarItem` renders top-level row: 7px 12px padding, 13px Inter, gap 8, icon size 16, color flips on active.
- [ ] `SidebarItem` indent variant: 5/28 padding, 12px icon, no left-bar on active.
- [ ] `SidebarItem` collapsed variant: 32px height, hover tooltip at `r.right + 8`.
- [ ] `SidebarSection` tree-line guide visible under expanded children.
- [ ] `WorkspacePill` shows GDS glyph + "Cube Playground" + subtitle in expanded mode; glyph-only in collapsed.
- [ ] `BottomRow` API Settings click opens cube's API Settings modal.
- [ ] `BottomRow` Theme toggle flips cube's `data-theme` attribute AND `--hermes-*` vars.
- [ ] `CollapseToggle` button appears on seam hover, hidden otherwise.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `useSecurityContext` doesn't expose `openModal()` | Fallback to window event pattern (documented in step 6) |
| RR5 NavLink mismatched API | Already verified compatible in port-manifest §"RR6 → RR5 API delta" |
| Tooltip flickers because `r.right + 8` falls offscreen at narrow viewports | Hermes pattern works at ≥768px; viewport responsive deferred (cube is desktop tool) |
| useTheme hook signature mismatch | Read cube `src/theme/use-theme.ts` first; adapt destructure pattern |

## Security Considerations

- API Settings modal already gated by existing `SecurityContextProvider`. No new surface.
- Theme toggle writes to `localStorage` key cube already uses (`gds-cube:theme`).

## Status as of 2026-05-23

✅ DONE. All 7 sidebar primitive components created:
- `sidebar-item.tsx` (verbatim port, RR5-compatible).
- `sidebar-section.tsx` (verbatim port, event names updated to `gds-cube:*`).
- `sidebar-subheader.tsx` (verbatim port).
- `workspace-pill.tsx` (cube-branded: GDS glyph, "Cube Playground" title, RR5 `useHistory()` swap).
- `recent-items.tsx` (drop localizers + ChatContextMenu, event names updated).
- `bottom-row.tsx` (API Settings trigger + Theme toggle; uses cube `useTheme` hook).
- `collapse-toggle.tsx` (verbatim port).

All components render correctly in expanded/collapsed modes with proper active/hover states.

## Next Steps

Phase 4 builds topbar primitives. Phase 5 assembles these primitives into `sidebar.tsx`.
