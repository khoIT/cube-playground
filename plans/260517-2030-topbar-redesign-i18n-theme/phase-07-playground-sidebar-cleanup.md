---
phase: 7
title: "Playground sidebar cleanup"
status: completed
priority: P2
effort: "1h"
dependencies: [5]
---

# Phase 7: Playground sidebar cleanup

## Overview

Remove `NewMetricButton` and the `Settings` dropdown from `QueryBuilderContainer.tsx` sidebar — their entry points now live in the global header (New Metric pill) and user-avatar menu (Security Context / Add Rollup / Legacy New-Metric / Theme / Lang). `LegacyNewMetricDialogMount` keeps listening for the window event, so the legacy modal still opens.

## Requirements
- Functional: `/build` page no longer renders the inline Settings button or New Metric CTA in the QueryTabs sidebar. All previous actions remain reachable via the header user menu. The active-dot indicator (security context applied) moves to the user-avatar trigger.
- Non-functional: no regressions in QueryBuilder behavior or styling — only the sidebar `<Space gap="1x">` shrinks / disappears.

## Architecture
- `QueryBuilderContainer.tsx` strips its `settingsItems` + `handleSettingsAction` + `<NewMetricButton/>` + `<SettingsButton>` block. The `sidebar` prop of `<QueryTabs>` either receives a smaller right-side panel or `undefined`.
- Active-dot logic (`securityContextToken ? <ActiveDot/> : null`) moves to the user-menu avatar (computed by `useSecurityContext()` inside `user-menu.tsx`).
- `LEGACY_NEW_METRIC_EVENT` listener remains where it is (`LegacyNewMetricDialogMount`).
- Imports cleaned: drop `NewMetricButton`, `LEGACY_NEW_METRIC_EVENT`, `LockIcon`, `ThunderboltIcon`, `MoreIcon`, `MenuTrigger`, `Menu`, `Button`, `tasty`, `Sparkles` if unused.

## Related Code Files
- Modify: `src/components/PlaygroundQueryBuilder/QueryBuilderContainer.tsx`
- Modify (avatar dot): `src/components/Header/user-menu.tsx`

## Implementation Steps
1. In `QueryBuilderContainer.tsx`:
   - Delete `settingsItems`, `handleSettingsAction`, `SettingsButton`, `ActiveDot`, `rollupVisible` logic that's now in `user-menu`.
   - Remove the `sidebar={<Space>…</Space>}` block from `<QueryTabs>` (or replace with `sidebar={null}` if the prop is required).
   - Drop unused imports.
2. In `user-menu.tsx`:
   - Use `useSecurityContext()` to read `securityContextToken`.
   - When non-null, render a tiny green dot overlay on the avatar trigger (mirrors the previous SettingsButton dot).
   - Pass `isAddRollupButtonVisible` from `useCloud()` (already global) to conditionally render Add Rollup item.
3. Manual sanity: open `/build`, verify the QueryTabs row no longer shows the right-side button cluster; confirm header user menu still drives Security Context modal, rollup drawer, legacy modal.
4. `npm run typecheck` + `npm run build`.

## Success Criteria
- [ ] No "New metric" or "Settings" button visible on `/build` outside the header.
- [ ] Header user menu fully replaces the removed actions.
- [ ] Active-dot indicator appears on the avatar when a security context token is set.
- [ ] No TS / lint errors. No console regressions.

## Risk Assessment
- The `QueryTabs sidebar` prop may be required (TS-wise). If so, pass `null` or a minimal spacer fragment.
- If something else inside `QueryBuilderContainer` still depended on those imports (low likelihood), TS picks it up immediately.

## Security Considerations
- No change in attack surface — entry points just moved.

## Next Steps
- Phase 8 verifies end-to-end.
