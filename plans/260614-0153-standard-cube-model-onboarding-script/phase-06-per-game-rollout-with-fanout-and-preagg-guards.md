# Phase 06 — Per-game rollout w/ fan-out + pre-agg guards

## Context links
- Fan-out guard: `cube-dev/cube/model/cubes/cfm/user_roles.yml:16-18` (many_to_one),
  `server/src/presets/bundles/mf-users-hub.yml:25` (reachableCubes: [mf_users])
- Pre-agg / refresh mechanics: `cube.js:292-293` (per-game preagg schema), memory
  "Cube serving instance needs restart for new rollups" + "Cube pre-agg build mechanics + harness"
- Rollout order: phase 02

## Overview
- Priority: P2. Status: pending. Depends on 03, 04, 05.
- Run the generator per game in value-ranked order, applying anomaly decisions, with explicit fan-out and
  pre-agg guards at each step. Each game = its own reviewable PR (cube-dev submodule + any L2 edit in main).

## Key insights
- Rollout is repetitive but NOT batchable blindly: every game gets a re-grep (matrix may drift — concurrent
  sessions edit cube dirs, per memory) + a generator dry-run + agent review of flags BEFORE writing.
- Fan-out guard is the headline risk: adding `user_roles` to ballistar/muaw/pubg reintroduces the
  one-to-many join. The guard is structural — user_roles stays `many_to_one`, member name stays
  `mf_users.ingame_name` (inline CTE), user_roles NEVER enters a bundle's reachableCubes.
- New rollups don't serve until the serving instance restarts (DEV_MODE=false = no hot-reload, memory). Any
  pre-agg-bearing cube (ptg) needs a restart + readiness probe asserting `usedPreAggregations`.

## Rollout order (value-ranked from phase 02)
Scope is the FULL 33-table canonical set per game (locked). The cubes named per game below are the
HIGHEST-VALUE wave (what unlocks the most metrics first); each game is then filled to the complete
canonical set (all std_role_*/cons_* marts) in the same rollout.
1. **cros** → add game_key_metrics, retention, new_user_retention, marketing_cost (clean; +24 metrics).
2. **tf** → same set as cros, BUT mf_users already intentionally omits ingame_name (role-name-absent anomaly) —
   leave mf_users as-is; only add the 4 marts. Agent confirms tf's role-name flag = "keep omitted".
3. **ballistar** → add user_roles (FAN-OUT GUARD), user_active_monthly, user_recharge_monthly, user_devices, user_ips.
4. **muaw** → same as ballistar.
5. **pubg** → same as ballistar (note: pubg lacked etl_ingame_register in 7/8 finding — affects funnel/session L3 only, not canonical marts).
6. **jus** → fill remaining gaps to the FULL canonical set; mf_users dual-identity already hand-tuned — do NOT regenerate it (--only excludes mf_users). Add user_active_monthly/user_recharge_monthly/devices/ips + all std_role_*/cons_* marts.
7. **ptg** (LAST, isolated — IN SCOPE, locked) → onboard the full canonical set INCLUDING mf_users/active_daily.
   High-scale anomaly: emit mf_users (and any large cube) WITH mandatory pre-agg from day one, restart serving,
   probe usedPreAggregations. ptg is the special case, not an optional one.

## Requirements
Functional (per game):
1. Re-grep current cube dir (refresh phase-02 matrix for this game).
2. `--dry-run` the generator; agent reviews emitted + flagged lists.
3. Apply anomaly decisions (jus/tf/ptg).
4. Write canonical cube files (cube-dev submodule).
5. Run phase-07 validation (compile + load) for that game.
6. Phase-05 availability check: confirm predicted metrics flipped available.
7. Open PR: cube-dev branch + (if any) main-repo L2 edit. PR body states both repos.

Per-game guards (checklist, every game):
- [ ] Any `user_roles` added stays `relationship: many_to_one`.
- [ ] No bundle/dashboard reachableCubes gains user_roles.
- [ ] Member name still resolves from `mf_users.ingame_name`, not user_roles.last_role_name.
- [ ] PII cubes (devices/ips) keep `public: false`.
- [ ] Pre-agg-bearing cube → serving restart + usedPreAggregations probe.

## Related code files
Write (cube-dev submodule): `cube-dev/cube/model/cubes/<game>/<newcube>.yml` per game.
Edit (main repo, only if phase-05 found a needed edit): metric `required_cubes` / bundle.
Read: phase 02 matrix, phase 04 decisions, `cube.js`.

## Implementation steps
1. For each game in rollout order: re-grep → dry-run → agent review → decisions → write → validate → availability check → PR.
2. Treat each game PR independently (file ownership = that game's subdir; no two parallel game PRs touch the
   same file since dirs are disjoint — safe to parallelize across games if desired, BUT shared L2 edits
   (cros+tf both touch nothing shared; metric files are per-metric) must be serialized if they touch the same metric yaml).
3. ptg last, behind its own decision + pre-agg + restart.

## Todo
- [ ] cros rollout + PR
- [ ] tf rollout (role-name-absent confirmed) + PR
- [ ] ballistar rollout (fan-out guard) + PR
- [ ] muaw rollout + PR
- [ ] pubg rollout + PR
- [ ] jus gap-fill (exclude mf_users) + PR
- [ ] ptg decision + (if onboarded) pre-agg + restart + probe

## Success criteria
- Each game reaches the canonical Tier-1/2 set (per scope decision 2) with all per-game guards green.
- Fan-out guard verified: a measure on user_roles joined to mf_users does NOT inflate user counts (spot-check
  a count vs mf_users.user_count on a game that gained user_roles).
- ptg (if onboarded) serves its cube from a pre-agg (usedPreAggregations true) post-restart.
- Phase-05 availability delta matches prediction per game.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| user_roles rollout reintroduces fan-out double-count | Med×High | Structural guard checklist + spot-check measure; user_roles many_to_one + excluded from reachableCubes. |
| Regenerating jus mf_users clobbers the hand-tuned merge CTE | Med×High | `--only` excludes mf_users for jus; phase-04 flags it anyway. |
| ptg pre-agg never seals (year-queue starvation / future-seal bug, memory) | Med×Med | Use the documented build-range patterns; verify with `cube-dev/scripts/measure-preagg-build.sh`; probe usedPreAggregations. |
| New rollup not served (no hot-reload) | Med×Med | Restart cube_api + worker (memory: restart both); readiness probe. |
| Concurrent-session edits race the rollout (no git stash, memory) | Med×Med | Re-grep per game at start; commit frequently on the game branch; verify pre-existing failures via git show. |

## Security considerations
- PII spoke cubes keep `public: false`; obs sidecar hashes user_ips filter values (`user_ips.yml:7-9`).
- Cross-tenant isolation unchanged — per-game subdir model loading (`cube.js:335-355`); generator only writes
  inside the target game's dir.

## Next steps
- Phase 07 validates each rollout; phase 05 confirms availability.
