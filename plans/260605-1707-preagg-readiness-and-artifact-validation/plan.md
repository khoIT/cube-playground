---
title: "Pre-agg readiness, dedicated refresh worker, and artifact validation"
description: "Build pre-aggs via a dedicated refresh worker (both stacks), expose per-game pre-agg readiness, and add an on-demand artifact validation sweep."
status: pending
priority: P1
effort: ~11h
branch: main
tags: [cube, pre-aggregations, infra, readiness, artifacts, docker-compose]
created: 2026-06-05
---

# Pre-agg Readiness + Artifact Validation

Prod `active_daily.dau` (and every other rollup-matching query) hard-fails with
"No pre-aggregation partitions were built yet…" because no refresh worker ever
builds the rollups vendored under `cube-dev/cube/model/cubes/{ballistar,cfm,jus,muaw,pubg}/`.
The API instance has `CUBEJS_REFRESH_WORKER=false` (correctly — an in-process
worker spin-loops, per `docs/lessons-learned.md:280`). Fix: add a **dedicated**
refresh-worker container; then make the gap *observable* (pre-agg readiness probe)
and validate saved artifacts against the live workspace.

Root cause is confirmed — do NOT re-diagnose. See the parent task brief.

## Phases

| # | Phase | Status | Effort | Blocked by |
|---|-------|--------|--------|-----------|
| 01 | Dedicated refresh-worker service (both composes) | done | 3h | — |
| 02 | Pre-agg readiness probe (server) | done | 2.5h | — |
| 03 | Pre-agg readiness panel (Settings FE) | done | 1.5h | 02 |
| 04 | Artifact validation sweep service (server) | done | 2.5h | 02 |
| 05 | Artifact sweep surface (Settings FE) | done | 1.5h | 03,04 |

Phases 01 and 02 are independent and may run in parallel (different files: compose
YAML vs server TS). 03 needs 02's response shape. 04 reuses 02's probe helper.
05 needs both FE hooks.

## Key dependencies / locked facts

- `cube-dev/cube/cube.js:296` already enumerates every tenant in
  `scheduledRefreshContexts` — a refresh worker builds all 5 games with **no
  model changes**.
- Compose images MUST stay `:latest` (kraken runner can't cold-pull — prod
  compose comment at `docker-compose.prod.yml` cube_api block). The new worker
  reuses `cubejs/cube:latest`.
- Probes MUST be rate-limited + cached + fail-open. Lessons-learned
  (`docs/lessons-learned.md:278`) records the readiness fan-out wedging the cube
  once — bound concurrency, reuse the 60s cache pattern, never throw.
- Artifacts all carry a `game`: dashboards via `dashboards.game`, segments via
  `segments.cube` + `cube_query_json`, chat via `QueryArtifact.game` + `.query`.
- Dashboards + segments are ALREADY live-executed by existing cron jobs that persist
  failures (`jobs/refresh-dashboard-tiles.ts` → tile cache `status='broken'`+error;
  `jobs/refresh-segment.ts` → `segments.status='broken'`+`broken_reason`). The sweep
  READS those verdicts — only chat artifacts ever get a fresh probe.

## File ownership (no overlap across parallel phases)

- P01: `docker-compose.prod.yml`, `docker-compose.devcube.yml`, `cube-dev/cube/cube.js` (read-only check), docs.
- P02: `server/src/services/preagg-readiness.ts` (new), `server/src/services/cube-client.ts` (add nothing — reuse `loadWithCtx`), `workspace-readiness.ts` (extend report), `server/src/routes/workspaces.ts`.
- P03: `src/pages/Settings/workspace-readiness-section.tsx`, `use-workspace-readiness.ts`.
- P04: `server/src/services/artifact-validation-sweep.ts` (new), new route file `server/src/routes/artifact-sweep.ts`.
- P05: `src/pages/Settings/*` new component + hook.

## Out of scope

- Enabling the in-process worker on the API instance (explicitly forbidden).
- New top-level pages (reuse Settings → Workspace tab; do NOT invent a page).
- Touching prod Vault secrets beyond documenting the new env knob.
