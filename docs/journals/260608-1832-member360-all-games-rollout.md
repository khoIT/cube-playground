# Member 360 — All-Games Rollout (cros/tf/muaw/pubg, Local)

**Date**: 2026-06-08 18:32  
**Severity**: Medium  
**Component**: Member 360 (Cube models, views, product config, coverage probe)  
**Status**: DONE — 959/959 server tests, 43/43 FE member360 tests, commit afd79ea ready to push

## What Happened

Rolled out Member 360 to all games with viable Cube models on the local workspace. cros, tf, muaw, pubg now join ballistar/cfm/jus with per-member 360 capability. ptg remains blocked (missing base cubes). Every game gated by three layers: Trino table availability → Cube base cubes + `views/<game>/user_360.yml` → product config (FE `PANELS_BY_GAME`/`SECTIONS_BY_GAME` + server `CORE_PANELS_BY_GAME`). Scouting which games cleared which layers drove the entire scope.

## The Brutal Truth

This looked straightforward — copy what works, repeat 4 times. It wasn't. cros and tf looked identical on the surface (user_id game events, devices, IPs) but diverge sharply in execution. cros is multi-region (payment_platform field, hour_of_day_vn, user_id events); tf is strategy-RPG (hour_of_day_local, alliance/lineup_rating fields, TGA session events keyed on role_id, not user_id). Blind-copying panel sets would have shipped the wrong dimensions to users. The real kick in the teeth: live probe caught a measure-as-dimension bug that would have gone unnoticed—the readiness coverage endpoint was querying device/IP *count* panels as dimensions, sending measures to Cube and hitting 400. That only surfaced when live coverage ran against cros for the first time.

## Technical Details

**Three-layer gating analysis:**  
Layer 1 (Trino): table existence (`user_devices`, `user_payment_txns`, etc.)  
Layer 2 (Cube): base cubes (`user_id`, `device_id`) + per-game view YAMLs (`views/cros/user_360.yml`)  
Layer 3 (Product): FE/server config maps (panel list, section grouping, visibility)  
Each game failed or passed per layer; cros/tf passed all three but required separate panel sets; muaw/pubg passed 1+2 but shared core-4 panels; ptg failed at layer 2 (no mf_users/activity cubes).

**Device/IP aggregate rollup vs per-row PII trap:**  
cfm's `user_devices` and `user_ips` views list per-(user,device) rows exposing raw `device_id`/`client_ip` as dimensions. cros/tf have same-named views but entirely different cardinality: aggregate counts (distinct_devices, distinct_ips), NOT row-level PII. Blind-copying cfm's panel columns ("list all devices") would query measures as dimensions in cros/tf, causing Cube 400s. Built measures-only count panels instead.

**Role-id bridge generalization:**  
tf TGA events (login/logout/register) key on `role_id`, not `user_id`. cfm already had a role bridge for playerid-keyed FPS panels (resolve user's role_ids from `user_roles_panel`, filter events). Extended `IdentityKey` type to include `role_id` + updated `event-panel-grid.tsx` to handle both playerid (cfm) and role_id (tf) bridges via shared `user_roles_panel` lookup. ~5-line change instead of parallel plumbing.

**Live-probe-caught measure-as-dimension bug:**  
Coverage readiness probe always sent `probeMember` with `dimensions:[]` array. For measures-only panels (distinct_devices, distinct_ips), this sent a measure *name* as a dimension → Cube 400 "'distinct_devices' not found for path". Fixed: `probeMember` now returns `{member, kind}` ('dimension' | 'measure'); probe branches on kind and excludes the measure from dimensions array. Caught live on cros (returned `error` status in coverage matrix), not caught by any test.

**tf missing from game registry:**  
tf was absent from `gds.config.json` game list—invisible to selector/matrix until restart. Added it; appears after dev-server reboot (config loads at boot, not hot).

## What We Tried

1. Single unified panel set for cros/tf  
   → Rejected: cros uses `hour_of_day_vn` (regional), tf uses `hour_of_day_local` (per-timezone strategy game). Events key on different fields (user_id vs role_id). Forced separate config.

2. Copy cfm's device/IP row-list panels to cros/tf  
   → Rejected: cfm's views expose per-row PII; cros/tf's same-named views are aggregates. Measure-as-dimension 400. Built count-only panels.

3. Hardcode role_id bridge for tf only  
   → Rejected: Added it to the type system. Generalization costs ~5 lines, unlocks future games that key events on identity subdivisions.

## Root Cause Analysis

**Three-layer gating hidden until scouting:** All games were assumed "has Trino tables, has cubes, ship it." Didn't surface layer-by-layer readiness until live audit. Game registry miss was boot-order config coupling — no error; just silent absence.

**Device/IP cardinality mismatch:** View names don't encode cardinality. `user_devices` is ambiguous (cfm = per-row PII list; cros/tf = aggregate count). Required domain knowledge of each game's data semantics; no schema-level signal.

**Measure-as-dimension only visible at query time:** The probe was correct logic (sample every panel family) but didn't branch on whether the panel was a measure-only or dimension-keyed family. Caught by live coverage (HTTP 400 → error status) not by unit test (no live Cube in test suite).

## Lessons Learned

1. **Per-game view grain divergence is real.** Same-named views can expose different cardinalities (row-list PII vs aggregate rollup). Document grain in view names or README. Future games: always verify 1-2 queries against live Cube before panel-set copy-paste.

2. **Coverage probe must be kind-aware.** Readiness checking must distinguish dimension-keyed panels from measure-only panels. Kind-aware branching revealed an entire class of silent probe failures.

3. **Game registry is boot-time config.** Missing from JSON = silent absence, no error. Need a startup check: for every game in panel config, validate it exists in gds.config.json. Prevents invisible-to-selector bugs.

4. **Domain divergence hides in plain sight.** cros and tf both "user_id events game" on the surface. Differences (payment_platform, alliance/lineup, timezone field, role_id keying) only became clear under line-by-line panel diff. Future: prototype 1-2 panels per game before rolling out 8+ panels.

## Next Steps

**Immediate (this session):**  
- [x] cros, tf, muaw, pubg enabled on local workspace  
- [x] Tests: 959/959 server, 43/43 FE member360, zero regressions  
- [x] Docs: 2 lessons-learned entries added (measure-as-dimension, per-game view grain)  
- [x] Code clean: no typecheck errors in touched files  

**Deferred (upstream):**  
Prod parity needs upstream kraken model exposing user_360 views in prefixed naming per game + prefix-aware coverage probe (currently `prefixUnsupported`). Product config already workspace-agnostic. Blocked on upstream cube-dev, not in this repo.

**Follow-up research:**  
Compare prod's prefixed user_360 view naming structure against local bare naming to plan prefix-probe generalization. Check if upstream supports role_id bridging for tf events.

---

**Unresolved questions:**
- Is prod's user_360 views already prefixed (e.g., `cros_user_360`, `tf_user_360`) or do they live under a namespace?
- Does upstream support role_id identity key or will tf events stay un-queryable in prod?
