---
phase: 5
title: "Header right cluster (search/help/bell/avatar) + user dropdown"
status: completed
priority: P1
effort: "5h"
dependencies: [1, 2, 4]
---

# Phase 5: Header right cluster + user dropdown

## Overview

Add the right-edge cluster from Image #3: **Search** (cmd+K stub), **Help** (icon, tooltip), **Notifications** (bell + red unread dot, empty popover), **User avatar** ("JN" initials, dropdown). The user dropdown is the new home for **Theme toggle**, **Language toggle**, and the three Settings items currently inside `QueryBuilderContainer` (Security Context, Add Rollup, Legacy New-Metric modal).

## Requirements
- Functional:
  - Search: visible cmd+K-styled input; clicking focuses; no real search backend this round. Pressing `⌘K` / `Ctrl+K` from anywhere focuses it (global listener). Placeholder text translated.
  - Help: circular icon button, tooltip "Help & docs" (i18n). No popover required (left for future).
  - Notifications: bell button with absolute-positioned red dot. Click opens a small popover showing "No notifications" empty state (i18n). Dot is hardcoded `true` for this round.
  - User avatar: 32 px circle showing initials "JN" (placeholder pulled from `useAppContext().identifier` or `gds-cube:user` LS — fall back to "JN" if absent). Click opens a dropdown with: theme submenu (light/dark), language submenu (EN/VN), divider, the three Settings actions (Security Context, Add Rollup, Legacy New-Metric — gated by `useCloud().isAddRollupButtonVisible` for the rollup item, matching current logic), divider, "Sign out" stub (no-op).
  - All dropdown labels translated via i18n.
- Non-functional: a11y — bell + help have `aria-label`; dropdown is keyboard navigable (antd `Dropdown` or `@cube-dev/ui-kit MenuTrigger`).

## Architecture
- `src/components/Header/right-cluster.tsx` — composes Search + Help + Bell + UserMenu.
- `src/components/Header/search-box.tsx` — controlled input with kbd shortcut hint (`⌘K`). Global `keydown` listener registered in a `useEffect`.
- `src/components/Header/help-button.tsx` — antd `Tooltip` wrap.
- `src/components/Header/notification-bell.tsx` — antd `Popover` with bell button + unread-dot overlay.
- `src/components/Header/user-menu.tsx` — uses `@cube-dev/ui-kit MenuTrigger` (matches existing playground pattern). Subcomponents: `theme-toggle.tsx`, `language-toggle.tsx`.
- Actions previously inside `QueryBuilderContainer.handleSettingsAction` (security context modal, rollup, legacy event) lift into a small action surface that the user menu invokes. Pattern by action:
  - `dispatch(new Event(LEGACY_NEW_METRIC_EVENT))` — already a window event, callable from anywhere. Unchanged.
  - **Rollup modal — window-event pattern.** <!-- Updated: Validation Session 1 - rollup via window event instead of provider hoist --> Add a new constant `OPEN_ROLLUP_DESIGNER_EVENT = 'open-rollup-designer'` colocated with the rollup-designer module. `QueryBuilderContainer` keeps the existing `RollupDesignerContext` provider in place AND adds a `useEffect` listening for this event → calls the existing `toggleModal()`. User menu dispatches the event. Mirrors the legacy-modal pattern already in the codebase and keeps rollup-designer code lazy-loaded to /build users only. **No provider hoist.**
  - Security context modal — hoist `SecurityContextProvider` from `src/index.tsx`'s `<KeepAliveRoute key="build">` to wrap the whole app inside `<AppContextProvider>`. Justification: `SecurityContextProvider` is `memo`'d, holds only context + a single `<SecurityContext />` modal child (modal renders nothing when `isModalOpen=false`), uses `useLocalStorage('cubejsToken')` which already has singleton semantics, and its sole consumer outside `/build` (`ExplorePage`) is itself reached via `/build`. Hoist cost ≈ 0; no double-mount risk verified. The user menu calls `useSecurityContext().setIsModalOpen(true)` directly.

## Related Code Files
- Create:
  - `src/components/Header/right-cluster.tsx`
  - `src/components/Header/search-box.tsx`
  - `src/components/Header/help-button.tsx`
  - `src/components/Header/notification-bell.tsx`
  - `src/components/Header/user-menu.tsx`
  - `src/components/Header/theme-toggle.tsx`
  - `src/components/Header/language-toggle.tsx`
- Modify:
  - `src/components/Header/Header.tsx` (mount `RightCluster`)
  - `src/index.tsx` (move `SecurityContextProvider` out of `<KeepAliveRoute key="build">` and up under `<AppContextProvider>` so it wraps the whole `<App>` subtree)
  - `src/components/PlaygroundQueryBuilder/QueryBuilderContainer.tsx` (add `useEffect` listening for `OPEN_ROLLUP_DESIGNER_EVENT` → invokes `toggleModal()`; provider stays here)
  - `src/rollup-designer/index.ts` or `Context.tsx` (export new `OPEN_ROLLUP_DESIGNER_EVENT` constant)

## Implementation Steps
1. Hoist `SecurityContextProvider` from inside `<KeepAliveRoute key="build">` to wrap the whole `<App>` subtree inside `<AppContextProvider>` in `src/index.tsx`. Keep the existing `onTokenPayloadChange` callback. Re-run typecheck. Verify `useSecurityContext()` still resolves inside `ExplorePage` (it will — same context, broader scope). **Do NOT hoist RollupDesignerContext** — see step 1a.
1a. Export `OPEN_ROLLUP_DESIGNER_EVENT = 'open-rollup-designer'` from `src/rollup-designer/index.ts`. In `QueryBuilderContainer`, after the `useRollupDesignerContext` call, add `useEffect(() => { const h = () => toggleModal(); window.addEventListener(OPEN_ROLLUP_DESIGNER_EVENT, h); return () => window.removeEventListener(OPEN_ROLLUP_DESIGNER_EVENT, h); }, [toggleModal]);`
2. Build `theme-toggle.tsx` — two segmented options (Sun / Moon icons) bound to `useTheme().toggle()`.
3. Build `language-toggle.tsx` — two segmented options (EN / VI) bound to `useLang().setLang()`.
4. Build `user-menu.tsx` — `MenuTrigger` from `@cube-dev/ui-kit` with circular avatar trigger; menu sections: theme block, language block, divider, security context / legacy modal / add rollup (conditional), divider, sign-out stub.
5. Build `notification-bell.tsx` — antd `Popover` content showing empty-state text; dot rendered via styled span.
6. Build `help-button.tsx` — antd `Tooltip` wrap of a `HelpCircle` icon.
7. Build `search-box.tsx` — input with kbd hint; `useEffect` registers `keydown` listener checking `e.key === 'k' && (e.metaKey || e.ctrlKey)` → focus the input.
8. Build `right-cluster.tsx` composing the four pieces with proper gaps. Mount in `Header.tsx` after the centered pill row.
9. Manual eyeball against Image #3 — alignment, spacing, dot color, avatar size.
10. Confirm Settings dropdown removal can happen cleanly in phase 7 (the user menu must already invoke all three actions).

## Success Criteria
- [ ] Right cluster matches Image #3 vertical alignment and order.
- [ ] `⌘K` / `Ctrl+K` focuses the search input from any page.
- [ ] Bell popover renders the i18n empty-state copy in both EN + VN.
- [ ] Theme toggle in user menu actually flips light ↔ dark (and BrandBlock logo swaps).
- [ ] Language toggle flips EN ↔ VI labels across Header + pills + user menu.
- [ ] Security Context action opens the existing modal (existing behavior unchanged).
- [ ] Add Rollup action opens the existing rollup-designer drawer.
- [ ] Legacy New-Metric action dispatches `LEGACY_NEW_METRIC_EVENT` (verified by existing listener firing the legacy dialog).
- [ ] No TS / lint errors. App boots without console errors.

## Risk Assessment
- Rollup access via `OPEN_ROLLUP_DESIGNER_EVENT` window event — symmetric with existing `LEGACY_NEW_METRIC_EVENT` pattern. If user clicks "Add Rollup" while NOT on `/build` (no `QueryBuilderContainer` mounted), the event fires into the void. **Acceptance:** user-menu shows Add Rollup item only when current route starts with `/build` (cheap `useLocation` check inside `user-menu.tsx`). <!-- Updated: Validation Session 1 - rollup event scoped to /build -->
- `SecurityContextProvider` hoist verified safe by scope-audit: only ExplorePage and QueryBuilder children read `useSecurityContext()`; both stay inside the hoisted tree. Login flow untouched (`saveToken` callback unchanged).
- Avatar initials default "JN" matches Image #3 but isn't derived from real auth — note as placeholder.
- Global `⌘K` / `Ctrl+K` listener must not preempt input focus inside QueryBuilder. Listener checks `e.target` is not an input/textarea/contenteditable AND calls `e.preventDefault()` only when claiming the shortcut.

## Security Considerations
- The user dropdown only exposes existing entry points (security-context modal already gated by user input). No new attack surface.
- localStorage writes (theme + lang) are non-sensitive.

## Next Steps
- Phase 7 removes the duplicate Settings dropdown + NewMetricButton from `QueryBuilderContainer`.
