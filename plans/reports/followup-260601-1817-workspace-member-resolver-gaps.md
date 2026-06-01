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

## Unresolved questions

- Does prod actually exercise LiveOps KPI strip + anomaly detector, or are they local-only today? (If unused on prod, #2 is moot until they're turned on.)
- On prod, is `segments.cube` always the prefixed physical name? (Confirmed via `member.split('.')[0]` on prefix-filtered FE meta — but no live prod segment inspected.)
