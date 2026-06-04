---
phase: 7
title: Views User360
status: completed
priority: P1
effort: 0.5d
dependencies:
  - 3
  - 4
  - 5
  - 6
---

# Phase 7: Views User360

## Overview
Create `cube-dev/cube/model/views/cfm/user_360.yml` — the full bare-named port of kraken's `views/cfm_vn/user_360.yml` (~26 views). This is the surface the dashboard queries. All backing cubes must exist (Phases 3–6) before views resolve.

## Requirements
- Functional: all views compile; the 6 dashboard views resolve to data for a sample user.
- Non-functional: view names bare (`user_profile`, not `cfm_user_profile`); join_paths bare; PII members inherit `public: false`.

## Architecture
- Mirror `views/ballistar/user_360.yml` structure + naming. Apply Phase 2 rules: `name: cfm_user_profile` → `user_profile`, `join_path: cfm_mf_users` → `mf_users`.
- The dashboard sends PHYSICAL `cfm_user_*`; locally we author LOGICAL bare names. The resolver (`src/lib/cube-member-resolver.ts`) physicalizes `user_profile.*` → `cfm_user_profile.*` only when `workspace.gameModel === 'prefix'`. So local stays bare; prod parity is automatic.
- Dashboard-name reconciliation (extracted members): the dashboard reads `cfm_user_devices.device_id` and `cfm_user_ips.client_ip` (the CUBES), but also `cfm_user_roles_panel.*` (a VIEW). Decide per-surface: expose both the cube (bare `user_devices`) and the panel view (`user_devices_panel`). Keep both names from kraken — they coexist there.

## Related Code Files
- Create: `cube-dev/cube/model/views/cfm/user_360.yml`
- Reference: kraken `views/cfm_vn/user_360.yml`, local `views/ballistar/user_360.yml`

## Implementation Steps
1. Fetch kraken `views/cfm_vn/user_360.yml` → `bare_rename.py` → `views/cfm/user_360.yml`.
2. Drop/adjust any view `includes` whose member was unavailable after Phase 4 reconciliation (e.g. recharge columns cfm lacks). Each drop noted with a comment.
3. Confirm every `join_path` cube exists in `cubes/cfm/` (cross-check against Phases 3–6 outputs); no dangling join_path.
4. Verify behavior-panel views (`user_matches_panel`, `user_money_flow_panel`, etc.) are in the Phase 8 guardrail's BEHAVIOR_VIEWS set under their bare names.
5. Compile via Phase 9 harness.

## Success Criteria
- [ ] `views/cfm/user_360.yml` created, bare-named, all ~26 views compile.
- [ ] The 6 dashboard views (`user_profile`, `user_roles_panel`, `user_devices`, `user_ips`, `user_activity_timeline`, `user_recharge_timeline`) each resolve.
- [ ] No `join_path` points at a missing cube.
- [ ] Behavior-panel views registered in guardrail.

## Risk Assessment
- A view referencing a member dropped in Phase 4 fails compile. Mitigation: step 2 reconciliation pass; compile after each edit.
- Resolver assumes bare↔prefix is a clean `${prefix}_` boundary; a view named `user_profile` physicalizes to `cfm_user_profile` (correct, matches dashboard). But `user_devices` → `cfm_user_devices` and the dashboard's `cfm_user_devices` is the CUBE — confirm the dashboard query targets resolve. Mitigation: validate against the dashboard's actual member list (already extracted this session).
- View-name collisions across the file (cube `user_devices` vs view `user_devices_panel`) — keep distinct, mirror kraken exactly.
