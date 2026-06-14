# Phase 0 — Worker Build + Validation Gate

**Priority:** P0 — blocks everything. **Status:** pending.

## Why
Measured 2026-06-08: zero pre-agg partitions built on any reachable stack. Adding rollup defs is wasted effort until a refresh worker materializes partitions AND the serving API instance reads the same CubeStore. This phase proves the pipe works on ONE existing rollup before we author new ones.

## Key insight
- ptg `ordered_funnel_canonical` (plain `rollup`) is the canary: it 404s with "instance not set up to build pre-aggregations" until partitions exist. When it returns rows with non-empty `usedPreAggregations`, the build pipeline is live.
- `active_daily` lambdas mask the problem (serve live silently) — do NOT use them to validate.

## Steps
1. Determine which Cube instance each stack's `local` workspace `/load` actually targets (`server/src/services/resolve-cube-token.ts`, workspace config). Identify the `:11000` topology: is there a worker container, is `CUBEJS_REFRESH_WORKER=true`, does it share the CubeStore the API queries?
2. On the chosen build-capable stack (local `cube-dev` docker-compose has `cube_api`+`cubestore`+worker): bring it up, confirm `CUBEJS_REFRESH_WORKER=true`, confirm `scheduledRefreshContexts()` enumerates games.
3. Trigger/await a refresh cycle for ballistar + ptg. Confirm partitions in CubeStore (`SELECT * FROM information_schema.tables` via cubestore :3030, or Cube `/v1/pre-aggregations/jobs`).
4. **Validation gate (must pass):**
   - ptg `ordered_funnel_canonical.step_count` → 200, rows>0, `usedPreAggregations` non-empty.
   - ballistar `active_daily.dau by day` → `usedPreAggregations` non-empty (not live-tail).
   - Capture cold + warm latency → this is the first real **"after"** CubeStore number vs the 3.5–15s "before".

## Success criteria
- At least one rollup proven served from CubeStore (`usedPreAggregations` non-empty) end-to-end through the gateway proxy.
- Documented: which stack builds, how to trigger refresh, measured pre-agg latency.

## Risks
- Source tables empty in build range → partitions build but return no rows. Mitigate: verify source row counts first.
- Worker builds but API reads a different CubeStore (split-brain) → still empty. Mitigate: single-node embedded for validation.

## Reuse the harness
`/tmp/preagg_latency.py` (POST via `:3004` gateway) already captures `usedPreAggregations`+timing. Repoint BASE to the build-capable gateway.
