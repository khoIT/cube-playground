# Phase 03 — Coverage data layer (hybrid signal)

## Overview
- Priority: P2
- Status: not started
- Depends on: phase-00 (workspace-readiness reuse), phase-02 (a 2nd game proves the matrix)
- Repo: cube-playground (server + FE hook)

## Concept
For each game and each required 360 view/panel, classify status from two probes:
1. **Modeled?** Diff the panel's required members against the game's Cube `/meta` (reuse the
   `/meta` fetch already in `workspace-readiness`). Members present → modeled; absent → not modeled.
2. **Has data?** Fire a single bounded probe query per view (no identity filter, `limit 1`,
   measures/dimensions the panel needs). Rows → has data; empty → modeled-but-empty.

## Status model
- `ready` — all members modeled + probe returns rows → charts compute.
- `partial` — some members modeled (subset of panels/charts compute); list missing members.
- `modeled-empty` — modeled but probe returns no rows (data not landed yet upstream).
- `blocked` — view/members not modeled → "needs more Trino data / semantic-layer modeling".

`/meta` blind spot: it cannot see Trino columns not yet in a YAML. `blocked` therefore means
"not modeled" and carries a hint that upstream Trino+YAML work is required; the probe distinguishes
modeled-empty from genuinely-missing.

## Tasks
1. Define `MEMBER360_REQUIRED_MEMBERS_BY_VIEW` derived from the panel registry (single source — derive,
   don't re-hardcode) so coverage stays in sync with `member360-panel-registry.ts`.
2. Server: `member360-coverage.ts` service + `GET /api/member360/coverage?game=<id>` (and an all-games
   variant for the Settings matrix). Reuse resolver `physicalizeQuery` for prefix workspaces and the
   workspace-readiness `/meta` cache. Cache results (short TTL) — probes hit live Cube.
3. FE hook `use-member360-coverage.ts` mirroring `use-metric-coverage.ts` contract.

## Related files
- Reuse: `server/src/services/workspace-readiness.ts`, `cube-member-resolver.ts`,
  `member360-panel-registry.ts`
- Create: `server/src/services/member360-coverage.ts`, route in `routes/`,
  `src/pages/Settings/use-member360-coverage.ts`

## Success criteria
- Endpoint returns correct status per game: ballistar/cfm_vn `ready`, jus_vn `ready` locally /
  `blocked` on prod (until upstream), muaw/pubg `blocked` (no view), ptg/cros `blocked`.
- Classification unit-tested with fixture `/meta` + probe responses.
