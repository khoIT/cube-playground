# Phase 01 — Baseline verify + registry member reconciliation (jus)

**Priority:** P1 (gate) · **Status:** ☐ not started

## Context Links
- Discovery: `plans/reports/from-scout-to-planner-jus-vn-playbook-unlock-discovery-report.md`
- Resolver: `server/src/care/availability.ts:75-89`, `extractLogicalMembers:53`
- jus master: `cube-dev/cube/model/cubes/jus/mf_users.yml`

## Overview
Before building any mart, confirm the **already-available** jus playbooks really resolve `available` (not silently failing closed on a member-name mismatch), and that the per-game anchor probe works against jus source tables. This is pure verification + at most a registry/YAML reconciliation — no new marts.

## Key Insights
- The registry is shared; verdict is per-game from `/meta`. A naming mismatch fails CLOSED → `unavailable` (safe, never wrong cohort) — so a "missing" baseline playbook is almost always a member-name gap, not absent data.
- jus `mf_users.yml` already exposes the four baseline members the registry needs:
  - `01` → `mf_users.first_recharge_date` (jus `mf_users.yml:101`) ✅
  - `02` → `mf_users.ltv_total_vnd` (jus measure `ltv_total_vnd` `:209`) ✅
  - `14` → `mf_users.days_since_last_active` (jus `:164`) ✅
  - `18` → `mf_users.first_active_date` (jus `:79`) ✅
- `19/20` are `opsDriven` → always `partial` regardless of game (`availability.ts:77`).

## Data flow
`GET /api/care/playbooks?game=jus_vn` → `resolveGameScope` (`game-scope.ts:27`) → `getGameMembers` fetches jus `/meta` → `extractLogicalMembers` → `resolveAvailability` per playbook → verdict array.

## Requirements
- Functional: `/api/care/playbooks?game=jus_vn` returns 01,02,14,18 = `available`; 19,20 = `partial`; all others `unavailable`.
- Non-functional: no registry edit that changes any **cfm** verdict (shared registry).

## Related Code Files
- Read: `server/src/care/playbook-registry.ts`, `availability.ts`, `game-scope.ts`, `resolve-data-anchor.ts`, jus `mf_users.yml`.
- Modify (only if a mismatch is found): the jus YAML member name to match the registry (preferred), OR the registry only if the same change is safe for cfm.
- Create: none.

## Implementation Steps
1. With local stack up, `curl -s 'http://localhost:<server>/api/care/playbooks?game=jus_vn'` (use the running server port; auth disabled = bootstrap admin). Capture verdict per id.
2. For any of 01/02/14/18 that is NOT `available`: diff its `dataRequirements` member against jus `/meta` (`curl .../cubejs-api/v1/meta` with `x-cube-workspace: local` + jus game scope). Reconcile by renaming the jus YAML member to the registry name (DRY: keep the registry stable so cfm is untouched).
3. Confirm the anchor probe resolves a sane jus date: it will run in later phases against `std_ingame_user_recharge_daily` etc.; here just sanity-check `mf_users` time members return a MAX date via a 1-row desc `/load`.
4. Record the baseline verdict table (expected 6/21 enabled: 4 available + 2 ops-partial).

## Todo
- [ ] curl jus playbooks verdict, capture table
- [ ] confirm 01,02,14,18 = available
- [ ] confirm 19,20 = partial, rest unavailable
- [ ] reconcile any member-name mismatch in jus YAML (not registry, unless cfm-safe)
- [ ] sanity-check anchor MAX-date probe on a jus time member

## Success Criteria
- Baseline 6/21 confirmed live for jus_vn before any mart is built.
- Zero change to any cfm verdict.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Registry member name mismatches jus YAML | Med×Low | Fail-closed makes it safe; fix in jus YAML, re-probe |
| Editing registry breaks cfm | Low×High | Do NOT edit registry here; rename jus YAML instead |

## Backwards Compatibility
No schema change; verification + at most a jus YAML member rename. cfm verdicts unaffected (per-game /meta).

## Security
Read-only `/meta` + `/load` probes; `?game` validated by `resolveGameScope` charset + allow-list (`game-scope.ts:21,32-40`).

## Next
Unblocks 02-05 (marts). Anchor confirmed working → relative windows will resolve to jus data extent.
