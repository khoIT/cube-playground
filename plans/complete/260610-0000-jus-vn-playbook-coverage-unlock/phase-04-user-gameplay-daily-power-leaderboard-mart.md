# Phase 04 — jus user_gameplay_daily power-leaderboard mart → unlocks 06, 09

**Priority:** P2 · **Status:** ☐ not started

## Context Links
- Template (structure): `cube-dev/cube/model/cubes/cfm/user_gameplay_daily.yml`
- Registry: `playbook-registry.ts:132-141` (06 ladder_rank <= 10), `:165-174` (09 ladder_rank == 1)
- cfm build note: plan `260609-1515/plan.md` "Build note — Phase 04" (partition-prune scalar subquery, 15s timeout).

## Overview
jus has **no FPS ladder**. Honest map (user-confirmed): build jus `user_gameplay_daily` exposing member `ladder_rank` = global RANK by **fighting_power** (战力 = the MMO leaderboard). Unlocks 06 (top-N) + 09 (top-1) via the SAME registry member `user_gameplay_daily.ladder_rank` cfm uses for its score-rank — a **cross-game logical member**, documented in the YAML.

## Key Insights
- This is NOT a 1:1 port — cfm's mart carries `ladder_rank_drop_48h` + clan signals (08/10/17) that jus **cannot** support. jus mart is the **reduced** form: only `ladder_rank` (by fighting_power). 08/11 deferred; 10/17/12 stay unavailable (no source). Do NOT emit clan/drop members for jus (would falsely flip 08/10/17 to available on garbage).
- Ranking dimension = fighting_power. Discovery sources: `std_ingame_user_active_daily.ingame_max_active_fighting_power` (per-user-day, no role join needed — simplest), or `mf_ingame_roles.fighting_power` (role-grain, needs role_id↔user_id fold). **Prefer the std table** — already per-user, avoids the identity-fold + the raw-match partition-prune timeout cfm hit. Confirm column name live before authoring.
- Grain = one row per user as of the active-data anchor; `ladder_rank` = `RANK() OVER (ORDER BY fighting_power DESC NULLS LAST)`. Non-additive window fn → no pre-agg.
- Member name MUST be `user_gameplay_daily.ladder_rank` (matches registry). `user_id` `public: true`.

## Data flow
`std_ingame_user_active_daily` (anchor day) → per-user MAX fighting_power as of anchor → `RANK()` → `user_gameplay_daily.ladder_rank` in jus /meta → 06/09 flip `available` → sweep cohort filter (06: rank<=10; 09: rank==1).

## Requirements
- Functional: `user_gameplay_daily` in jus /meta exposing `user_id` (public PK), `log_date` (time), `ladder_rank` (number), optionally `fighting_power` (for the watched metric / drill-down). NO clan/drop members.
- 06 (`ladder_rank <= 10`) and 09 (`ladder_rank == 1`) flip `available`.

## Architecture
Author a fresh, minimal jus mart (do not copy cfm's clan/season machinery):
```
WITH anchor AS (SELECT MAX(CAST(log_date AS DATE)) AS d FROM std_ingame_user_active_daily),
 per_user AS (
   SELECT ad.user_id, a.d AS anchor_d,
          MAX(ad.ingame_max_active_fighting_power) AS fighting_power  -- confirm col name
   FROM std_ingame_user_active_daily ad CROSS JOIN anchor a
   WHERE CAST(ad.log_date AS DATE) = a.d
   GROUP BY ad.user_id, a.d)
 SELECT per_user.*, RANK() OVER (ORDER BY fighting_power DESC NULLS LAST) AS ladder_rank FROM per_user
```
Dimensions: `user_id` (public PK), `log_date` (TIMESTAMP-wrapped from anchor_d), `ladder_rank` (number), `fighting_power` (number). `refresh_key.every: 30 minute`. No pre-agg.
- **Document** in the YAML header: "ladder_rank here = global rank by fighting_power (战力), jus's MMO leaderboard — a cross-game reuse of the registry's `user_gameplay_daily.ladder_rank` logical member, which on cfm ranks by PvP ladder score."

## Related Code Files
- Create: `cube-dev/cube/model/cubes/jus/user_gameplay_daily.yml`
- Read: cfm template (structure only), jus `active_daily.yml` + `mf_users.yml` (fighting_power column names), discovery report.
- Modify: none.

## Implementation Steps
1. Confirm the fighting_power column on `std_ingame_user_active_daily` (discovery cites `fighting_power`/`ingame_max_active_fighting_power`) via jus /meta or a `/load` probe.
2. Author the minimal jus `user_gameplay_daily.yml` (above). Anchor on the active table (same anchor as Phase 03 → consistent as-of date).
3. Restart `cube_api` (+ worker).
4. `/meta` jus: `user_gameplay_daily.ladder_rank` present, `user_id` public; verify NO clan/drop members leaked.
5. `/load`: confirm `ladder_rank` is dense 1..N over a plausible population (no ties-collapse anomaly; RANK leaves gaps after ties — acceptable for <=10 / ==1).
6. `/api/care/playbooks?game=jus_vn` → 06, 09 = `available`; confirm 08, 10, 17 stay `unavailable` (no member emitted).
7. Sweep → 06 small cohort (top-N), 09 = 1 (top-1) like cfm's 06=9/09=1.

## Todo
- [ ] confirm fighting_power column name live
- [ ] author minimal jus user_gameplay_daily.yml (ladder_rank only, no clan/drop)
- [ ] restart cube serving instance
- [ ] /meta: ladder_rank present, user_id public, NO clan/drop members
- [ ] /load: ladder_rank dense + plausible
- [ ] availability flips 06, 09 → available; 08/10/17 stay unavailable
- [ ] sweep: 06 top-N cohort, 09 top-1 cohort

## Success Criteria
- 06, 09 = `available` for jus on fighting-power rank; 08/10/17 remain `unavailable` (no fabricated members).
- Cross-game-member reuse documented in the YAML header.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Accidentally emit clan/drop members → falsely flip 08/10/17 | Med×High | Mart deliberately omits them; verify /meta in step 4 |
| fighting_power column name wrong | Med×Med | Confirm live before authoring (step 1) |
| Ties make ladder_rank<=10 cohort huge (mass-tied top power) | Low×Med | Inspect /load distribution; if tied, switch to ROW_NUMBER or add tiebreak (role_level) — calibrate in 06 |
| Raw-match partition timeout (cfm's 15s) | Low×Med | Avoided by sourcing the per-user std table, not raw matches |

## Backwards Compatibility
New cube `user_gameplay_daily` in the jus dir — distinct from cfm's same-name mart (different dir, different members). Shared registry member `ladder_rank` resolves per-game from /meta. cfm gameplay verdicts unaffected.

## Security
Read-only mart; user_id only.

## Next
Independent. 06/09 cohort sizes calibrated in Phase 06 (tie handling, rank cutoff).
