# Phase 00 — Discovery (read-only)

## Overview
- Priority: P0 (gates all later phases)
- Status: not started
- Confirm exact contracts before authoring YAML / product config / coverage service.

## Tasks
1. **jus base-cube field diff.** In `cube-dev-old`, diff `cubes/jus/{mf_users,active_daily,user_recharge_daily,recharge}.yml`
   dimension/measure names against the `includes:` lists in `views/ballistar/user_360.yml`. Produce
   the exact include list for jus's 4 core views (drop any dim jus lacks; note them).
2. **Settings coverage pattern.** Read `src/pages/Settings/use-metric-coverage.ts`,
   `metric-coverage-section.tsx`, `use-workspace-readiness.ts`, `workspace-readiness-section.tsx`
   and server `workspace-readiness.ts`. Document: how a section is registered on the Settings page,
   the hook→endpoint contract, and how per-game `/meta` availability is already computed (reuse for meta-diff).
3. **Server member360 path.** Read `member360-panel-registry.ts` (CORE_PANELS_BY_GAME shape + drift test),
   `member360-panel-query.ts`, `member360-precompute-scheduler.ts`, `member360-runner.ts`,
   `routes/segment-member360.ts`. Note what changes when a game is added (precompute eligibility, cache-status).
4. **FE sections.** Read `member360-sections.ts` — `SECTIONS_BY_GAME`, `sectionsForGame`, how ballistar
   differs from cfm (e.g. `engagement_segment` exclusion). Decide: alias ballistar sections for jus or fork.
5. **Workspace config for jus_vn.** Confirm in `workspaces.config.json` (local, game_id) + `workspaces.prod.config.json`
   (prefix `jus`) + `gds.config.json`. Confirm prod prefix map has `jus_vn: jus`.
6. **Prod 360 view existence.** Probe prod Cube `/meta` (or note as open) for `jus_*` 360 views to know if
   prod is blocked upstream. Records the real prod gate for the coverage surface.

## Success criteria
- Exact jus include lists for 4 views written down (input to phase-01).
- Settings section registration contract + workspace-readiness reuse plan documented (input to phase-03/04).
- Server add-a-game checklist documented (input to phase-02).
- Decision: alias vs fork ballistar sections/panels for jus.

## Output
Append findings to this file or a `reports/discovery-...-report.md`. No code changes.
