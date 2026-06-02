# Follow-up: workspace member-resolver — remaining surfaces

Context: `cube-member-resolver.ts` (logical↔physical Cube member translation for `prefix` vs `game_id` workspaces) landed + wired into segment cards (`card-runner`), LiveOps KPI strip (`liveops-refresh-handlers`), and the hardcoded anomaly path (`anomaly-detector` ANOMALY_METRICS). Idempotent on `${prefix}_` boundary; strict no-op when prefix null (local unchanged). 565 server tests green.

These surfaces were deliberately NOT wired (can't validate against prod from here, or risk-coupled to other subsystems). Each is a separate follow-up.

## 1. FE segment-monitor live-fetch fallback — ✅ RESOLVED (260601)

- **Where:** `src/pages/Segments/detail/use-segment-cube-query.ts`. Background refetch builds a query from the FE preset (logical members) and sent it via `cubejsApi.load` → cube proxy, which does NOT physicalize.
- **Was:** On prod, a cold-cache live refetch of segment monitor cards sent `mf_users.*` → 404/empty. Server card cache (physicalized→logicalized in `card-runner`) covered the warm path; this bit only when the cache was missing/stale and `skipBackgroundFetch` was false.
- **Fix shipped:** FE-side rewrite (chosen over proxy-side — see rationale below). New thin mirror `src/lib/cube-member-resolver.ts` (same contract as the server module; the FE bundle can't import server code). `useSegmentCubeQuery` now: `prefix = resolveGamePrefix(workspace, activeGameId)` (reads `gameModel`/`gamePrefixMap` from `useWorkspaceContext`); `physicalizeQuery(scopedLogical, prefix)` before `/load`; `logicalizeRows(rawData(), prefix)` on the response. Idempotent on `${prefix}_` so the segment's already-physical slice filters pass through untouched while logical preset measures get prefixed. Strict no-op on null prefix → local unchanged. `prefix` added to the effect deps so a workspace switch re-fetches. Tests: `src/lib/__tests__/cube-member-resolver.test.ts` (9).
- **Why FE-side, not proxy-side:** the request side is safe via idempotency, but the *response* side is not. The query builder sends physical members and reads physical row keys; the segment monitor sends logical members and reads logical keys. A proxy that logicalized responses would break the query builder (it can't tell the two consumers apart). FE-side keeps the request/response translation paired and local to the consumer that knows its own naming.

## 2. Business-metric anomaly planner — meta-driven, coupled to drift subsystem

- **Where:** `server/src/jobs/anomaly-detector.ts:259` (`planMetricQueries`) + `metric-query-planner.ts` + `metric-ref-validator.ts` (`validateRefs`, `snapshotFromMeta`).
- **Impact:** business-metric YAML refs are logical (`recharge.revenue_vnd`). On prod, `validateRefs` against physical `/meta` likely flags them all as unresolved → drift rows / no anomaly checks for those metrics.
- **Why not wired now (verified):** this path is *deliberately* local-only today. `runDriftReconciliation` persists every drift snapshot/run under a hardcoded `workspaceId: 'local'` (`anomaly-detector.ts:217`, `:202`) with the explicit comment "Detector stays on the local game_id model" (`:214`). It iterates `loadGamesConfig().games` (local games), and `/meta` is fetched directly (not via the prefix-filtering proxy), so on prod it would see ALL games' physical cubes and flag every logical ref unresolved. Making it prefix-aware is a **feature/product decision** (per-workspace drift storage + UI), not a bug fix — physicalizing refs blind could mask real drift or corrupt grouping.
- **Decision needed (escalate to drift-center owner):** should the detector/drift become workspace-aware (store per-workspace, physicalize refs + `/meta` snapshot via `resolveGamePrefix(game)`), or stay intentionally local? Do NOT touch without this decision — it reverses a deliberate scoping choice.

## 3. identity map robustness — ✅ NO ACTION (verified workspace-agnostic, 260601)

- **Where:** `resolve-identity-field.ts`. Keyed by exact cube name; the manual `cube_identity_map` is seeded from live `/meta` (physical keys) and the auto-suggester (`suggestIdentities`) is meta-driven, so it already resolves physical cube names on prod. Callers (`refresh-segment`, card-runner) pass the segment's stored cube, which is the physical name on prod. No logical-named caller exists → a `logicalCube`/`physicalCube` fallback would be dead code (YAGNI). Left unchanged. Add the fallback only if a future logical-named caller appears.

## Verified-agnostic (no action)

- LiveOps cohort grid (`findRetentionCube`) — derives cube name from live `/meta`.
- Identity map seed + auto-suggester — meta-driven.
- Pattern for new features: derive member names from `/meta` when possible → no translation needed; otherwise route logical config through `cube-member-resolver`.

## Decisions

- **#1 (FE live-fetch):** ✅ shipped 260601 (`1747ef1`) — FE-side rewrite.
- **#2 (anomaly/drift):** owner chose **leave as-is** (260601) — detector/drift stays intentionally local. No code change; revisit only if the anomaly detector is turned on for prod.
- **#3 (identity map):** ✅ no action — verified workspace-agnostic.

## Verification (260601, real data)

Verified against the cube-api stack (`/Users/lap16299/Documents/code/cube-api`). Legs 1–2 were the initial split proof; leg 3 is the unified run after fixing `:16000`:

1. **Revenue match (slice-filter fix), numeric proof on real Trino data** — endpoint `ballistar_cube_api` (`localhost:4000`, logical names, prefix=null path). Cell = `recharge` Android, week 2026-05-18 (1,422 payers): **804,765,000**. Post-fix monitor query (`revenue_vnd` + os/week slice + `user_id IN(1422 uids)`) = **804,765,000** → exact match. Pre-fix (uid-IN only, no slice) = **2,866,112,000** (3.56× over) → reproduces the original bug. Confirms slice filters constrain the cohort measure to the cell's window.
2. **Prefix member resolution on prod-shaped meta** — endpoint `cube_gateway` (`localhost:16000`, prefix model, 133 game-namespaced cubes). Pre-fix logical `recharge.revenue_vnd` → HTTP 400 `Cube 'recharge' not found`; post-fix physicalized `ballistar_recharge.revenue_vnd` (+ already-physical slice filters, idempotent) → HTTP 200 accepted. Confirms `physicalizeQuery` output resolves where logical names 404.

3. **UNIFIED: revenue match on the prefixed prod model with real data** — endpoint `cube_gateway` (`localhost:16000`) after fixing its Cube Store wiring (see below). Cell = `ballistar_recharge` IOS, week 2026-05-04 (1,449 payers): **1,154,910,000**. Post-fix monitor (`ballistar_recharge.revenue_vnd` + os/week slice + `user_id IN(1449 uids)` — all physical/prefixed, the exact `physicalizeQuery` output) = **1,154,910,000** → exact match. Pre-fix (uid-IN only) = **4,029,000,000** (3.49× over). This supersedes the split legs above: prefixed cubes + real Trino numbers + the fix's actual physical query shape, in one run.

**`:16000` was hanging on Cube Store, not Trino.** `cube_api` inherited a stale prod coord from `.env` (`CUBEJS_CUBESTORE_HOST=cubestore_router:9999`); the dev stack runs single-node `cubestore`. Every `/load` hung in the query orchestrator (`CubeStore connection failed: ENOTFOUND cubestore_router`) before reaching Trino. Fixed with a `cube-api/docker-compose.yml` `environment` override on `cube_api` → `cubestore:3030` (`environment` beats `env_file`, so the prod `.env` stays intact). Recreated `cube_api`; data now flows.

Incidental: this mirror's `ballistar_recharge.recharge_date` column is empty (time-grouped queries on it return 0 rows); used `recharge_time` for the week slice. Unrelated to the connection fix or the member resolver.

## Unresolved questions

- Does prod actually exercise LiveOps KPI strip + anomaly detector, or are they local-only today? (If unused on prod, #2 is moot until they're turned on.)
- On prod, is `segments.cube` always the prefixed physical name? (Confirmed via `member.split('.')[0]` on prefix-filtered FE meta — but no live prod segment inspected.)
