# Follow-up: workspace member-resolver — remaining surfaces

Context: `cube-member-resolver.ts` (logical↔physical Cube member translation for `prefix` vs `game_id` workspaces) landed + wired into segment cards (`card-runner`), LiveOps KPI strip (`liveops-refresh-handlers`), and the hardcoded anomaly path (`anomaly-detector` ANOMALY_METRICS). Idempotent on `${prefix}_` boundary; strict no-op when prefix null (local unchanged). 565 server tests green.

These surfaces were deliberately NOT wired (can't validate against prod from here, or risk-coupled to other subsystems). Each is a separate follow-up.

## 1. FE segment-monitor live-fetch fallback — logical names hit the proxy unprefixed

- **Where:** `src/pages/Segments/detail/use-segment-cube-query.ts` (+ FE preset card specs). Background refetch builds a query from the FE preset (logical members) and sends via `cubejsApi.load` → cube proxy, which does NOT physicalize.
- **Impact:** On prod, a cold-cache live refetch of segment monitor cards sends `mf_users.*` → 404/empty. The server card cache (now correctly physicalized→logicalized in `card-runner`) covers the common path, so this only bites when the cache is missing/stale and `skipBackgroundFetch` is false.
- **Fix sketch:** FE already has `gamePrefixMap` from `/api/workspaces`. Port the resolver's `physicalizeQuery`/`logicalizeRows` to a FE util (or add the rewrite in `scopeQueryToSegment` / the cube-api layer), prefix from the active workspace+game. Mirror the idempotent + null-no-op contract. Alternatively: make the cube proxy physicalize server-side for prefix workspaces (but proxy currently passes FE queries through verbatim, and FE queries are already physical for query-builder-originated members — so a proxy rewrite must be idempotent to avoid double-prefixing).
- **Decision needed:** FE-side rewrite vs proxy-side rewrite. FE-side is safer (proxy sees a mix of already-physical query-builder queries + logical preset queries; only the latter need rewriting, and the proxy can't easily tell them apart).

## 2. Business-metric anomaly planner — meta-driven, coupled to drift subsystem

- **Where:** `server/src/jobs/anomaly-detector.ts:259` (`planMetricQueries`) + `metric-query-planner.ts` + `metric-ref-validator.ts` (`validateRefs`, `snapshotFromMeta`).
- **Impact:** business-metric YAML refs are logical (`recharge.revenue_vnd`). On prod, `validateRefs` against physical `/meta` likely flags them all as unresolved → drift rows / no anomaly checks for those metrics.
- **Why not wired now:** this path feeds the metric-drift subsystem (drift snapshot/run stores, drift-center). Physicalizing refs blind could mask real drift or corrupt drift grouping. Needs a deliberate design pass: should logical refs be physicalized before validation (so they resolve), or should the drift model itself become workspace-aware? Likely the former — physicalize the planned query members + the validation snapshot lookup via the resolver, keyed by `resolveGamePrefix(game)`.
- **Decision needed:** confirm drift semantics on prefix workspaces with whoever owns drift-center before touching.

## 3. (Lower priority) identity map robustness

- **Where:** `resolve-identity-field.ts`. Currently keyed by exact cube name; on prod the map is seeded from live `/meta` (physical keys) + auto-suggester is meta-driven, so it already resolves physical cube names. No change required, but if a logical cube name is ever passed, add a `logicalCube`/`physicalCube` fallback for symmetry.

## Verified-agnostic (no action)

- LiveOps cohort grid (`findRetentionCube`) — derives cube name from live `/meta`.
- Identity map seed + auto-suggester — meta-driven.
- Pattern for new features: derive member names from `/meta` when possible → no translation needed; otherwise route logical config through `cube-member-resolver`.

## Unresolved questions

- Does prod actually exercise LiveOps KPI strip + anomaly detector, or are they local-only today? (If unused on prod, #2 is moot until they're turned on.)
- On prod, is `segments.cube` always the prefixed physical name? (Confirmed via `member.split('.')[0]` on prefix-filtered FE meta — but no live prod segment inspected.)
