---
phase: 5
title: "Workspace readiness panel"
status: pending
priority: P3
effort: "1.5d"
dependencies: [1, 2, 3, 4]
---

# Phase 5: Workspace readiness panel

## Overview
Replace the rejected "diff screen" with a **readiness panel**: per-workspace health —
which games have cubes, whether saved artifacts resolve, and coverage of the shared
business-metrics registry against the workspace's live meta (the DA audit).

## Requirements
- Functional: for the active (or any) workspace, show game cube-availability, artifact
  survival count, and registry coverage delta.
- Non-functional: reuse the existing coverage resolver + coverage-section UI patterns;
  shared registry (no duplication).

## Architecture
- **Server**: coverage resolver is now workspace-aware (Phase 1). Add a readiness
  aggregation in `metric-coverage-resolver.ts` (or a sibling `workspace-readiness.ts`):
  per game → `{ hasCubes, cubeCount, brokenRefs, uncoveredMeasures }` using prefix match for
  `prefix` workspaces. Expose `GET /api/workspaces/:id/readiness` (header workspace also ok).
- **Frontend**: new Settings tab "Workspace" (`src/pages/Settings/settings-page.tsx` tab
  list) reusing `metric-coverage-section.tsx` layout (matrix, status chips with semantic
  tokens `--success-soft/--warning-soft/--destructive-soft`).
  - Section A: game readiness grid (✓ N cubes / ✗ no data).
  - Section B: artifact survival — count saved dashboards/segments/aliases that resolve in
    this workspace vs broken (read isolated artifact sets from Phase 4).
  - Section C: registry coverage (shared YAMLs vs workspace meta) — existing coverage view,
    now parameterized by workspace.
- Optional: show a compact readiness summary in the switcher dropdown on hover.

## Related Code Files
- Create: `server/src/services/workspace-readiness.ts` (or extend `metric-coverage-resolver.ts`)
- Create: route `GET /api/workspaces/:id/readiness` (in `business-metrics.ts` or new `workspaces.ts`)
- Create: `src/pages/Settings/workspace-readiness-section.tsx`
- Modify: `src/pages/Settings/settings-page.tsx` (add "Workspace" tab),
  reuse `use-metric-coverage.ts` (workspace param)

## Implementation Steps
1. Add workspace-aware readiness aggregation server-side (game availability via prefix/game_id).
2. Expose readiness route; include coverage (shared registry vs workspace meta).
3. Build Settings "Workspace" tab reusing coverage-section UI + semantic tokens.
4. Wire artifact-survival counts from Phase 4 isolated stores.
5. Verify on prod: cfm shows N cubes, absent games ✗; coverage lists registry refs unmet by prod.

## Success Criteria
- [ ] Readiness tab shows per-game cube availability for the active workspace.
- [ ] Coverage runs shared registry vs prod meta (DA audit) and lists broken/uncovered.
- [ ] Artifact survival counts reflect isolated per-workspace artifacts.
- [ ] UI matches coverage-monitor styling (semantic tokens, header pattern) per design-guidelines.

## Risk Assessment
- **Missing `.meta` on prod** — coverage attribution (source/author) blank; show "n/a", don't error.
- **Overlap with `260527-1257-metric-cube-coverage-sync`** — reuse, don't fork, its resolver;
  confirm that plan's coverage shape before extending.
- **Prod `/load` verified open** — artifact-survival can fully validate query-backed segments
  against prod (no degrade needed). Readiness can run real queries if desired.
