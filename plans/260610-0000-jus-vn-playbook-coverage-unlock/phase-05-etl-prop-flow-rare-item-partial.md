# Phase 05 — jus etl_prop_flow rare-item partial → unlocks 07 (partial)

**Priority:** P3 · **Status:** ☐ not started

## Context Links
- Registry: `playbook-registry.ts:142-152` (07), `dataRequirements: ['etl_prop_flow.prop_id']`, `condition` event on `etl_prop_flow.acquired_at`.
- cfm equivalent cube: `cube-dev/cube/model/cubes/cfm/etl_prop_flow.yml` (`name: etl_prop_flow`, over `etl_ingame_propflow`).
- jus source: `etl_ingame_item_flow` (item_id, reason, place, role_id, log_date) — discovery.

## Overview
Map 07 to jus `etl_ingame_item_flow` as a **partial** (raw event table → per-member drill-down only, like cfm's prop playbooks). The resolver downgrades any `etl_*`-backed requirement to `partial` automatically (`availability.ts:35-38,87`).

## Key Insights — CRITICAL (cross-game registry coupling)
- The registry hard-codes the **logical cube name `etl_prop_flow`** for 07 (`:148`). The resolver matches member name presence in /meta. So to unlock 07 for jus **WITHOUT editing the registry** (which would also change cfm's existing 07 partial), the jus cube MUST be **named `etl_prop_flow`** (same logical name) over the physical `etl_ingame_item_flow` — exactly mirroring cfm naming its `etl_prop_flow` over `etl_ingame_propflow` (`cfm/etl_prop_flow.yml:2-3`).
- It MUST expose dimensions `prop_id` (07 dataRequirements) and `acquired_at` (07 condition member). Map jus columns: `prop_id` ← `item_id`; `acquired_at` ← `log_date` (TIMESTAMP-wrapped). Optionally `reason`/`place` for drill-down.
- This is the DRY-preserving choice: one logical member, two physical sources. Do NOT add a second registry member or rename — that breaks cfm.
- 07 stays **partial** (raw etl → no cohort scan); 08 (rank-drop) and 11 (set-completion) remain deferred — no clean jus signal.

## Data flow
`etl_ingame_item_flow` (item_id, log_date, role_id, reason, place) → jus cube `etl_prop_flow` exposing `prop_id`(=item_id), `acquired_at`(=log_date) → /meta → resolver sees `etl_*` source → 07 = `partial` (drill-down only, per-member).

## Requirements
- Functional: jus cube `etl_prop_flow` (logical name) over `etl_ingame_item_flow`, dims `prop_id`, `acquired_at` (+ identity to reach user via role_id↔user_id if needed for drill-down).
- 07 resolves `partial` for jus_vn (NOT available — by design, raw event).
- cfm 07 unchanged.

## Architecture
Mirror `cfm/etl_prop_flow.yml`: `name: etl_prop_flow`, `sql_table: etl_ingame_item_flow`. Dimensions: a primary_key (composite of role_id+item_id+log_date or a row id), `prop_id` ← `item_id`, `acquired_at` ← `from_iso8601_timestamp(...)` over `log_date`. If 07 drill-down needs user identity, join `mf_ingame_roles` (role_id↔user_id) like cfm's gameplay mart; otherwise role-grain is fine for a partial. Match cfm's dimension shape so the existing 07 UI works unchanged.

## Related Code Files
- Create: `cube-dev/cube/model/cubes/jus/etl_prop_flow.yml`
- Read: `cfm/etl_prop_flow.yml` (member shape to mirror), discovery (jus item_flow columns).
- Modify: none — registry stays as-is (that is the whole point).

## Implementation Steps
1. Read `cfm/etl_prop_flow.yml` fully; note the exact dimension names the registry + UI expect (`prop_id`, `acquired_at`).
2. Author jus `etl_prop_flow.yml` over `etl_ingame_item_flow`, mapping `item_id`→`prop_id`, `log_date`→`acquired_at`. Mirror cfm's PK + member shape.
3. Restart `cube_api` (+ worker).
4. `/meta` jus: `etl_prop_flow.prop_id` + `etl_prop_flow.acquired_at` present.
5. `/api/care/playbooks?game=jus_vn` → 07 = `partial`; confirm cfm 07 still `partial`.
6. Spot-check a per-member drill-down (07 has no cohort sweep — partial).

## Todo
- [ ] read cfm/etl_prop_flow.yml member shape
- [ ] author jus etl_prop_flow.yml (name=etl_prop_flow over etl_ingame_item_flow)
- [ ] map item_id→prop_id, log_date→acquired_at
- [ ] restart cube serving instance
- [ ] /meta shows etl_prop_flow.prop_id + acquired_at
- [ ] 07 = partial for jus; cfm 07 unchanged
- [ ] per-member drill-down spot check

## Success Criteria
- 07 = `partial` for jus_vn (per-member drill-down works); cfm 07 unaffected.
- No registry edit.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Naming jus cube `etl_prop_flow` collides with cfm in shared /meta on a prefix workspace | Med×Med | Per-game scope prefixes (`jus_etl_prop_flow`) + `logicalCube` strip (`availability.ts:57-58`) keep them separate; verify in step 5 |
| Tempt to rename registry member to fit jus | Low×High | Forbidden — would break cfm 07; mirror cfm naming instead |
| item_id semantics ≠ rare/cosmetic (all items, not just rare) | Med×Low | 07 is partial (drill-down), not a cohort gate — coarse mapping acceptable; note caveat in coverage report |

## Backwards Compatibility
New jus cube reusing cfm's logical name; per-game /meta isolation keeps cfm 07 intact. Registry untouched.

## Security
Read-only raw event read; user identity only via existing role join.

## Next
Independent. 07 has no calibration (partial). Optional — can defer with 08/11 if time-boxed.
