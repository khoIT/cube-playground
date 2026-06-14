# Phase 02 — Product layer: enable jus_vn core 360

## Overview
- Priority: P1
- Status: not started
- Depends on: phase-01 (jus views live in local Cube)
- Repo: cube-playground

## Tasks
1. **FE panels.** In `src/pages/Segments/member360/member360-panels.ts`: add jus core panels. If jus's
   view shape matches ballistar's exactly, reuse `BALLISTAR_PANELS` (alias) rather than duplicating;
   else define `JUS_PANELS` from the phase-00 field list. Register `jus_vn: <panels>` (and bare `jus`
   for prefix workspaces) in `PANELS_BY_GAME`.
2. **FE sections.** In `member360-sections.ts`: register `jus_vn` in `SECTIONS_BY_GAME` (alias ballistar
   sections, dropping any field jus lacks). Ensure `sectionsForGame('jus_vn')` returns non-null.
3. **Server mirror.** In `server/src/services/member360-panel-registry.ts`: add jus core panels to
   `CORE_PANELS_BY_GAME` (keeps FE↔server drift test green; enables precompute + cache-status).
4. **Verify gate.** `hasMember360('jus_vn')` → true → 360 link renders in `sample-users-tab.tsx` and
   `tiered-members-view.tsx`; opening a jus_vn member loads the dashboard with real data locally.

## Related files
- `src/pages/Segments/member360/member360-panels.ts` (PANELS_BY_GAME)
- `src/pages/Segments/member360/member360-sections.ts` (SECTIONS_BY_GAME, sectionsForGame)
- `server/src/services/member360-panel-registry.ts` (CORE_PANELS_BY_GAME)
- Verify only: `member-360-view.tsx`, `sample-users-tab.tsx`, `tiered-members-view.tsx`

## Success criteria
- `npm run build` (FE + server) clean; FE↔server registry drift test passes.
- jus_vn segment → Members tab shows clickable 360 links → 360 page renders profile + activity +
  recharge + transactions with data from local Cube.
- No regression for ballistar/cfm_vn (snapshot/visual check on an adjacent game).

## Notes
- Prod will show jus_vn 360 as **blocked** until prod-side `jus_*` views exist (phase-01 risk). Local
  enablement is independently shippable and testable.
