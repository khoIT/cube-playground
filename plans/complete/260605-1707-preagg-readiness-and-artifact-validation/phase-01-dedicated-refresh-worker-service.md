# Phase 01 — Dedicated refresh-worker service (both composes)

## Context Links
- `docker-compose.prod.yml` cube_api block (lines ~126–204) + cubestore (~212–224) + volumes (~226–230)
- `docker-compose.devcube.yml` cube_api_dev (25–71) + cubestore_dev (73–80)
- `cube-dev/cube/cube.js:296` `scheduledRefreshContexts` (enumerates all `SUPPORTED_GAMES`)
- `docs/lessons-learned.md:278-282` (refresh-worker spin-loop; fan-out wedge; CubeStore clock bug)

## Overview
- **Priority:** P1 (this is the actual prod fix)
- **Status:** done (2026-06-05) — also wired `cube_refresh_worker_dev` into
  `scripts/ensure-cube-api.mjs` (the watchdog starts services by explicit name,
  so the dev worker had to be added to its `up -d` list)
- **Description:** Add a `cube_refresh_worker` (prod) / `cube_refresh_worker_dev` (devcube)
  service that runs the same image/model/Trino/CubeStore config as the API instance
  but with `CUBEJS_REFRESH_WORKER=true`, no published ports, no SQL API. The API
  instance keeps `CUBEJS_REFRESH_WORKER=false`. Update the stale "flip once pre-aggs
  exist" comments.

## Key Insights
- The in-process worker is forbidden on the API instance — it spin-loops and pegs
  the event loop (lessons-learned). A **separate** container isolates that loop:
  if the worker wedges, `/meta` + `/readyz` on the API stay healthy.
- `scheduledRefreshContexts` already mints one synthetic ctx per game tagged
  `REFRESH_ROLE` — the worker will build every tenant's rollups with zero model edits.
- Both worker and API mount the **same** `./cube-dev/cube:/cube/conf:ro` and point
  at the **same** `cubestore` host. The worker writes rollups into CubeStore; the
  API reads them. They must agree on `CUBEJS_API_SECRET`, Trino creds, catalog, SSL.
- `:latest` images only (kraken cold-pull constraint). Reuse `cubejs/cube:latest`.

## Requirements
**Functional**
- New service builds all 5 games' rollups on a schedule against Trino → CubeStore.
- API instance no longer hard-fails rollup-matching queries once partitions exist.
**Non-functional**
- Worker has NO published ports, NO SQL API (`CUBEJS_PG_SQL_PORT` omitted), `depends_on: cubestore`.
- Worker carries the same `/readyz` healthcheck (so a wedge surfaces as `unhealthy`).
- Trino backfill load bounded: 5 games × multiple rollups × ~29 monthly partitions
  on first run. Add `CUBEJS_REFRESH_WORKER_CONCURRENCY` (default conservative, e.g. 2)
  so initial backfill doesn't storm Trino. Keep `scheduledRefreshTimer` at Cube's
  default (no need to tighten — backfill is one-time, incremental refresh is cheap).

## Architecture / data flow
```
cube_refresh_worker (REFRESH_WORKER=true, no ports)
   └─ reads ./cube-dev/cube model (same mount as API)
   └─ scheduledRefreshContexts → one ctx per game (cube.js:296)
   └─ runs partition refresh → writes prod_pre_aggregations.* into cubestore
cube_api (REFRESH_WORKER=false)
   └─ matches query to rollup → reads partitions from cubestore → serves
```

## Related Code Files
**Modify**
- `docker-compose.prod.yml` — add `cube_refresh_worker`; fix comment at the
  `CUBEJS_REFRESH_WORKER` line; add `CUBEJS_REFRESH_WORKER_CONCURRENCY` env passthrough
  to the worker only.
- `docker-compose.devcube.yml` — add `cube_refresh_worker_dev` (depends on `cubestore_dev`).
- `docs/deployment-guide.md` — document the new service + the env knob (if guide lists services).
- `docs/lessons-learned.md` — update the "keep REFRESH_WORKER=false until pre-aggs exist"
  apply-note to "API instance stays false; a dedicated worker builds them" (the
  spin-loop guard reasoning is now satisfied by container isolation).
**Read-only verify**
- `cube-dev/cube/cube.js` — confirm `scheduledRefreshContexts` is present and
  unconditional (it is, line 296). No edit.

## Implementation Steps
1. In `docker-compose.prod.yml`, copy the `cube_api` service block to a new
   `cube_refresh_worker`: same `image`, `entrypoint`, `command`, `volumes`,
   `depends_on: [cubestore]`, healthcheck, `restart`. Set `CUBEJS_REFRESH_WORKER: "true"`.
   Remove the `ports:` block and the `CUBEJS_PG_SQL_PORT/SQL_USER/SQL_PASSWORD` env.
   Keep `AUTH_API_URL`/`AUTH_INTERNAL_SECRET` (refresh ctx uses REFRESH_ROLE; auth-db
   skips RLS for it — verify the worker boots without the server by confirming
   `scheduledRefreshContexts` mints role-tagged ctxs, not real JWTs).
2. Add `CUBEJS_REFRESH_WORKER_CONCURRENCY: ${CUBEJS_REFRESH_WORKER_CONCURRENCY:-2}`
   to the worker env only.
3. Edit the API instance comment block at `CUBEJS_REFRESH_WORKER` — replace the
   stale "Flip to true once pre-aggs exist" with: API stays false; the dedicated
   `cube_refresh_worker` builds rollups (isolated event loop so a refresh wedge
   can't starve the serving API).
4. Mirror steps 1–3 in `docker-compose.devcube.yml` as `cube_refresh_worker_dev`
   (cubestore_dev host, no ports). Keep its file-auth posture (`AUTH_API_URL: ""`,
   `AUTH_USERS_FILE`) so it boots standalone.
5. Verify both compose files parse: `docker compose -f <file> config -q`.
6. Update docs.

## Todo List
- [x] prod: add `cube_refresh_worker` (REFRESH_WORKER=true, no ports/SQL API, same mounts)
- [x] prod: add `CUBEJS_REFRESH_WORKER_CONCURRENCY` to worker
- [x] prod: rewrite stale REFRESH_WORKER comment on API instance (pinned literal "false")
- [x] devcube: add `cube_refresh_worker_dev` (+ pinned API flag, + watchdog up-list in ensure-cube-api.mjs)
- [x] `docker compose config -q` passes for both files (prod + 3-file devcube overlay)
- [x] docs/deployment-guide + lessons-learned updated

## Success Criteria
- `docker compose -f docker-compose.prod.yml config -q` exits 0; same for devcube.
- Worker service present with `CUBEJS_REFRESH_WORKER=true`, no `ports:`, depends on cubestore.
- API instance `CUBEJS_REFRESH_WORKER` still defaults `false`; comment no longer stale.
- Both worker and API share identical Trino/CubeStore/API_SECRET/model config.
- (Live, post-deploy) `active_daily.dau` by day returns 200 instead of the partition error.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Worker storms Trino on first backfill (5×rollups×29 partitions) | M×H | `CUBEJS_REFRESH_WORKER_CONCURRENCY=2`; first backfill is one-time |
| Worker wedges its event loop (same spin-loop class) | M×M | Separate container → API unaffected; `/readyz` healthcheck flips it `unhealthy` |
| Worker can't reach server for auth (boot order) | L×M | Refresh ctx uses REFRESH_ROLE synthetic ctx, not server-minted JWT; verify in step 1 |
| Image tag drift breaks kraken cold-pull | L×H | Reuse `cubejs/cube:latest` (already cached on runner) |
| CubeStore clock bug after Mac sleep masks worker output | L×L | Documented (lessons-learned); restart cubestore — not in scope to auto-fix |

## Rollback
Remove the `cube_refresh_worker` service block and redeploy — API reverts to the
prior (failing-on-rollup but otherwise healthy) state. No data migration; CubeStore
partitions persist on the volume and are simply not refreshed.

## Security
Worker has no published ports (no new attack surface). Reuses existing secrets;
introduces no new secret. `CUBEJS_DEV_MODE` stays `false`.

## Next Steps
Independent of P02. Enables the live validation in P02/P04 to observe `built`
rather than `unbuilt` once deployed.
