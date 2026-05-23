# Phase 3 — v1 entry-point deprecation

## Overview

- **Priority:** P1
- **Status:** pending
- Keep `NewMetricButton`, `NewMetricDialog`, `legacy-new-metric-dialog-mount` files for one release as a safety net. Unmount only the entry points.

## Entry points to remove

- `src/QueryBuilderV2/QueryStatePillBar.tsx` (line ~228) — `<LegacyNewMetricDialogMount />` JSX + import.
- `src/components/Header/user-menu.tsx` (line ~146) — `data-testid="user-menu-legacy-new-metric"` menu item + handler.

## Required changes

1. Delete the `<LegacyNewMetricDialogMount />` mount + import in `QueryStatePillBar.tsx`.
2. Delete the menu item dispatching `LEGACY_NEW_METRIC_EVENT` from `user-menu.tsx`.
3. Add a deprecation banner comment at the top of:
   - `NewMetricButton.tsx`
   - `NewMetricDialog.tsx`
   - `legacy-new-metric-dialog-mount.tsx`
   - `NewMetric/index.ts`
4. Update `src/components/Header/__tests__/user-menu.test.tsx` — remove or update the legacy-new-metric test branch.

## Files to modify

- `src/QueryBuilderV2/QueryStatePillBar.tsx`
- `src/components/Header/user-menu.tsx`
- `src/components/Header/__tests__/user-menu.test.tsx`
- `src/QueryBuilderV2/NewMetric/NewMetricButton.tsx`
- `src/QueryBuilderV2/NewMetric/NewMetricDialog.tsx`
- `src/QueryBuilderV2/NewMetric/legacy-new-metric-dialog-mount.tsx`
- `src/QueryBuilderV2/NewMetric/index.ts`

## Todo

- [ ] Remove pill-bar legacy mount
- [ ] Remove user-menu legacy link
- [ ] Add deprecation comments
- [ ] Update user-menu test
- [ ] typecheck + targeted vitest

## Success criteria

- No way to open the v1 dialog from the UI.
- v1 files still compile (kept for grace period).
- All tests pass.

## Risks

- A consumer outside the repo expects the global event `open-legacy-new-metric-dialog` — none found in scout. Confirm before deletion in a later PR.

## Security

None.
