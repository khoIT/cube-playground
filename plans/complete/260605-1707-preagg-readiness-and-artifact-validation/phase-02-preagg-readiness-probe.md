# Phase 02 — Pre-agg readiness probe (server)

## Context Links
- `server/src/services/workspace-readiness.ts` (report shape, `gamesReadinessCache`
  pattern at :248-267, `buildCtxFor` :90, `readGamesReadiness` :118)
- `server/src/services/cube-client.ts` — `loadWithCtx(query, ctx)` :141, `getMetaWithCtx` :128
- `server/src/services/resolve-cube-token.ts` — `resolveCubeTokenForWorkspace`
- `server/src/routes/workspaces.ts` — readiness route :69
- `docs/lessons-learned.md:278` — fan-out probe wedge (bound concurrency!)
- `cube-dev/cube/model/cubes/{ballistar,cfm,jus,muaw,pubg}/active_daily.yml` etc — pre-agg-bearing cubes

## Overview
- **Priority:** P1
- **Status:** completed
- **Description:** For the `local` (game_id) workspace, classify each pre-agg-bearing
  cube per game as `built` / `unbuilt` / `error` by issuing a tiny `/load` probe and
  inspecting the result/error. Cache with a TTL like `gamesReadinessCache`. Surface
  as a new `preaggs` section on the readiness report.

## Key Insights
- Cube `/meta` does NOT expose pre-aggregations by default. **Decision: probe, don't
  parse YAML.** The server container does NOT mount the vendored model dir (only the
  cube container mounts `./cube-dev/cube`). So the server can't read the YAML. Probing
  a known cube + catching the partition error is the reliable signal. (`?extended=true`
  meta is a possible future optimization but is heavier and not needed for KISS.)
- The discriminating error string is the partition message:
  `"No pre-aggregation partitions were built yet"`. Classify:
  - probe resolves (HTTP 200, has data or empty) → `built`
  - error contains that string → `unbuilt`
  - any other error (timeout, auth, cube-missing) → `error`
- **Probe must be cheap + bounded.** Use a 1-day `dateRange` on the rollup's time
  dimension, `limit: 1`. The fan-out wedge (lessons-learned) was caused by *dozens
  of concurrent* per-game `/load`s compiling all tenants at once. So: bound
  concurrency (reuse `bounded-concurrency.ts` — already in repo), cache results 60s+,
  and only probe ONE representative measure per pre-agg-bearing cube per game.
- **Which cubes to probe:** hard-code the known pre-agg-bearing cube list (it's
  stable, lives in the vendored model, changes rarely): `active_daily`,
  `game_key_metrics`, `marketing_cost`, `mf_users`, `recharge`. For each, probe one
  measure that the rollup serves. This is a small curated registry (KISS) co-located
  with the probe service, documented as "mirror of cube-dev rollup definitions".
  `cros` and `tf` have no pre-aggs → skip (don't probe).
- **Only `local` (game_id) workspace** has the in-stack cube with these rollups.
  `prod` (prefix) points at the external cube-api stack — out of scope for this probe
  (return empty preaggs section for non-game_id workspaces; fail-open).

## Requirements
**Functional**
- `computeWorkspaceReadiness` report gains a `preaggs` section: per game, per
  pre-agg cube, a status. Aggregate counts (`built`/`unbuilt`/`error`) for the panel.
- Reuse existing `buildCtxFor` + per-game token minting.
**Non-functional**
- Bounded concurrency (≤2 in flight), per-workspace TTL cache (≥60s).
- Fail-open: any probe failure → `status:'error'` with message; never throws.
- Adds ≤ one `/load` per (game × pre-agg cube) per cache window. 5 games × 5 cubes = 25
  probes worst case — bounded at concurrency 2, cached. Must NOT fan out unbounded.

## Architecture / data flow
```
GET /api/workspaces/:id/readiness
  → computeWorkspaceReadiness (workspace-readiness.ts)
      → computePreaggReadiness(workspace)   [new: preagg-readiness.ts]
          if workspace.gameModel !== 'game_id' → { games: [], note: 'n/a' }
          for each game (bounded concurrency 2):
            ctx = buildCtxFor(workspace, gameId)
            for each known pre-agg cube:
              probe = loadWithCtx({ measures:[<repr>], timeDimensions:[{dimension,dateRange:[d,d],granularity:'day'}], limit:1 }, ctx)
              classify built|unbuilt|error
          cache(workspaceId) 60s
```

## Related Code Files
**Create**
- `server/src/services/preagg-readiness.ts` (<200 lines): the probe registry,
  `classifyProbe`, `computePreaggReadiness(workspace)`, the TTL cache, types.
**Modify**
- `server/src/services/workspace-readiness.ts` — call `computePreaggReadiness` in
  `computeWorkspaceReadiness`; add `preaggs` to `WorkspaceReadinessReport`.
- `server/src/services/cube-client.ts` — NO change (reuse `loadWithCtx`).

## Implementation Steps
1. Define the curated pre-agg registry in `preagg-readiness.ts`:
   `[{ cube:'active_daily', measure:'active_daily.dau', timeDimension:'active_daily.date' }, …]`
   for the 5 cubes. Add a comment that this mirrors the rollups in cube-dev's vendored
   model and lists why cros/tf are excluded.
2. `classifyProbe(resultOrError)`: 200 → `built`; error msg matches partition regex
   → `unbuilt`; else `error`. Export the regex/predicate as a named helper for testing.
3. `probeOne(ctx, entry)`: build the 1-day, limit-1 query; `loadWithCtx`; try/catch →
   classified status + optional message. Use a small fixed `dateRange` (yesterday..yesterday
   in workspace TZ) — partitions exist regardless of date if any partition was built,
   and the error fires before data scan so date precision doesn't matter.
4. `computePreaggReadiness(workspace)`: short-circuit non-`game_id` → empty section.
   For `game_id`, iterate games × registry with `runBounded(tasks, 2)` from
   `bounded-concurrency.ts`. Shape: `{ games: [{ id, label, cubes: [{ cube, status, message? }], built, unbuilt, errored }], generatedAt }`.
5. Add a module-level `Map<workspaceId, {at, result}>` cache, TTL 60s (mirror
   `gamesReadinessCache`). Export `__resetPreaggCache` for tests.
6. Wire into `workspace-readiness.ts`: add `preaggs: PreaggReadiness` to the report
   interface; call it in `computeWorkspaceReadiness`. Keep it OUT of the lightweight
   `computeGamesReadiness` (game picker must stay cheap).
7. Tests (vitest, `server/test/preagg-readiness.test.ts`): unit-test `classifyProbe`
   against the three message shapes; test the non-game_id short-circuit; mock
   `loadWithCtx` to assert bounded concurrency (≤2 concurrent) and cache hit on 2nd call.

## Todo List
- [x] curated pre-agg registry (5 cubes, repr measure + time dim) with rationale comment
- [x] `classifyProbe` + exported partition-error predicate
- [x] `probeOne` (1-day, limit-1, fail-open)
- [x] `computePreaggReadiness` with bounded concurrency + non-game_id short-circuit
- [x] 60s TTL cache + `__resetPreaggCache`
- [x] extend `WorkspaceReadinessReport` with `preaggs`; wire into `computeWorkspaceReadiness`
- [x] vitest: classify, short-circuit, concurrency bound, cache hit
- [x] `npm --prefix server run build` (tsc) passes

## Success Criteria
- `classifyProbe` returns `unbuilt` for the partition message, `built` for success,
  `error` otherwise (unit-tested).
- Non-game_id workspaces return an empty/n-a preaggs section without any `/load`.
- A 2nd `readiness` call within 60s issues zero new `/load` probes (cache hit, tested).
- Concurrency never exceeds 2 (tested with a mock that records in-flight count).
- Whole report still fail-opens: a probe throw never 500s the readiness route.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Probe fan-out wedges the cube (the documented incident) | M×H | bound concurrency ≤2, cache 60s, one measure per cube, only on full readiness (not game picker) |
| `unbuilt` reported as `built` because `/load` falls back to Trino | M×M | With REFRESH_WORKER off and DEV_MODE off the cube hard-fails (no fallback) — so success genuinely means built. Document this dependency on cube config. |
| Curated registry drifts from actual rollups | M×L | Comment pins it to cube-dev model; a missing cube probes as `error`/`cube-missing`, visible not silent |
| Probe date range outside any partition → false `unbuilt` | L×M | Partition-missing error fires before data scan; date doesn't gate it. Use yesterday to be safe. |

## Rollback
Remove the `preaggs` field + service call; report reverts to games/coverage/artifacts.
No persistence, no migration.

## Security
Reuses per-game minted JWT via `buildCtxFor`/`resolveCubeTokenForWorkspace`. No new
secret, no new external call target (same cubeApiUrl as readiness already uses).

## Open Question
- Probe granularity: `active_daily.dau` is the failing measure — confirm its time
  dimension name (`active_daily.date`?) against the vendored YAML during impl. If
  the repr measure/dimension names differ per cube, the registry must carry the exact
  fqn. Resolve by reading `cube-dev/cube/model/cubes/<game>/<cube>.yml` at impl time
  (these are readable in the repo even though not mounted into the server container).
