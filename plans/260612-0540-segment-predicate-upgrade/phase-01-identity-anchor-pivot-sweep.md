---
phase: 1
title: "Identity-anchor pivot sweep"
status: pending
priority: P2
effort: "3h"
dependencies: []
---

# Phase 1: Identity-anchor pivot sweep

## Overview
Seed `cube_identity_map` rows anchoring every jus_vn cube that joins `mf_users` (but lacks a curated preset) onto `mf_users.user_id`. Activates the existing pivot-preset path (`resolvePivotPreset`, `src/pages/Segments/presets/registry.ts:39`) → "via mf_users" chip, member enrichment, 360 — zero new UI code.

## Requirements
- Functional: segments on `active_daily` (and siblings) resolve the mf-users-hub preset via pivot; Members tab enriches; "Auto preset" chip replaced by "via mf_users".
- Non-functional: existing segment b7a6cae9 re-cohorts cleanly on next refresh (uid space changes from `uid@channel` to bare `mf_users.user_id`); no orphan mappings for cubes without a working join.

## Architecture
`resolveIdentityDetailed` (`server/src/services/resolve-identity-field.ts:110`) checks `cube_identity_map` FIRST — a seeded row short-circuits the auto-suggester, so the refresh job and FE pivot agree on the same anchor. FE pivot (`use-preset.ts:96`) reads the map via `useIdentityMap` and activates `resolvePivotPreset` only when `identity_field` is anchored on another cube (`mf_users.user_id`).

## Related Code Files
- Modify: none expected (data seed via API) — unless audit shows a cube needs a join fix in `cube-dev/cube/model/cubes/jus/*.yml`
- Read: `server/src/services/resolve-identity-field.ts`, `src/pages/Segments/detail/use-preset.ts`, identity-map route in `server/src/routes/`

## Implementation Steps
0. **[RED-TEAM C1 — gate before any seeding]** `cube_identity_map.cube` is a GLOBAL primary key (`001-init.sql:42`) — `active_daily` exists in jus, cfm, muaw, ballistar, pubg, tf, cros. For EVERY cube name about to be seeded, audit the same-named cube in ALL game dirs: does each have an mf_users join with compatible identity semantics (beware cfm vopenid namespace)? If yes for all → seed globally. If ANY differs → add a game-scoped identity-map migration first (`cube_identity_map(game_id, cube)` composite key + resolver/`useIdentityMap` updates) and seed per-game. Record the audit table in this file.
1. Audit `cube-dev/cube/model/cubes/jus/*.yml` for cubes with an `mf_users` join. Expected hits: `active_daily`, `user_roles`, `user_active_rolling`, `user_recharge_daily`, event `etl_*` cubes — list the actual set.
2. For each hit, prove the join compiles with one Cube query: `{dimensions:['mf_users.user_id'], filters:[{member:'<cube>.<any-dim>', operator:'set'}], limit:1}` (workspace `local`).
3. Seed through the Identity Map surface/API (NOT raw SQL — preserves `source`/`updated_at` semantics): rows `{cube:'<cube>', identity_field:'mf_users.user_id'}`. Confirm the PUT route shape in `server/src/routes/` first.
4. Reload b7a6cae9 detail: chip reads "via mf_users"; trigger refresh; verify uid_list is bare uids and Members tab enriches.
5. Compare cohort size pre/post; delta beyond namespace dedup expectations → investigate `split_part` collisions before accepting.

## Success Criteria
- [ ] Every jus_vn cube with a verified mf_users join has a `cube_identity_map` row; none seeded where the join probe failed
- [ ] b7a6cae9 shows "via mf_users" + enriched Members tab after refresh
- [ ] uid_count delta documented and explained

## Risk Assessment
- **Uid-space break for downstream holders** of the old `uid@channel` list (CDP pushes, exports). Mitigation: refresh rewrites all server-side artifacts; flag in PR; only b7a6cae9 lives on these cubes today.
- **Join fan-out**: `many_to_one` to mf_users is safe for identity grouping; cross-check against the jus dual-row mf_users history (fixed 77b3982) — the bridge dedup must hold.
