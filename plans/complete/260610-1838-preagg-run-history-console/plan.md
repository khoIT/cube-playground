---
title: "Pre-agg Run History Console — refresh telemetry + serveability"
status: pending
created: 2026-06-10
owner: khoitn@vng.com.vn
scope: local devcube stack; Admin/hub UI; server SQLite
---

# Pre-agg Run History Console

## Goal

Give an operator a UI to see the history of the worker's hourly pre-aggregation
sweeps: per sweep, which rollups **sealed**, which **failed** (with cause), and —
the signal that matters — which are **serving stale cache because the latest
refresh failed**. "Both" was chosen: refresh-outcome telemetry is the source of
truth for run success/failure; a serveability badge shows whether the metric can
still answer warm right now.

## Why now

Worker now sweeps hourly + all games (heavy job). When a sweep fails midway the
old cache keeps serving (verified — versioned-table swap is atomic, failures only
orphan the half-built table), so failures are **invisible** today: dashboards stay
green while data silently goes stale. No history exists; `preagg-readiness.ts` is
a point-in-time probe only.

## Key facts (verified this session)

- Worker (`cube_refresh_worker_dev`) is the only builder; APIs don't build. It
  sweeps on `CUBEJS_SCHEDULED_REFRESH_TIMER` (now 3600s), all games.
- At **info** level the worker logs sweep start (`Refresh Scheduler Interval`) and
  every failure (`Error while querying`, `Downloading external pre-aggregation
  error/warning`, `Error querying db`) with `preAggregationId` / `targetTableName`
  / `requestId` / timestamp. Successful `CREATE TABLE` seals are **trace-only** →
  we infer success from absence-of-error + serveability probe, not from logs.
- Server persists to SQLite (`server/data/segments.db`, `db/sqlite.js`) and has no
  docker socket → worker logs reach it via a **shared log file**, not the socket.
- `computePreaggReadiness()` already returns built/unbuilt/error per cube per game
  via Cube `/load` probes — reuse for the serveability badge.
- Home for the UI: `src/pages/Admin/hub` (existing observability tabs). Follow
  `docs/design-guidelines.md` (tokens, page-header pattern, status tokens).

## Outcome taxonomy (the data model's heart)

Per (sweep × cube): combine log-failure presence with the probe result:

| outcome | log error in window | probe serveable | meaning |
|---|---|---|---|
| `sealed` | no | yes | refreshed + serving (healthy) |
| `stale_serving` | yes | yes | **refresh failed, old cache still serving** ← key signal |
| `failed` | yes | no | refresh failed AND not serveable |
| `unbuilt` | no | no | never sealed (cold) |

## Phases

| # | Phase | Output |
|---|-------|--------|
| 1 | Telemetry capture + schema | shared worker-log file; server-side collector parses sweeps+failures; SQLite `preagg_sweeps` + `preagg_sweep_items`; merges probe serveability into outcome taxonomy |
| 2 | API route | `GET /api/preagg-runs` (sweep list + drill-down), `GET /api/preagg-runs/current` (live serveability); zod-typed |
| 3 | Admin/hub UI tab | "Pre-agg Runs" tab: sweep timeline, per-sweep expand → per-cube outcome chips, stale-serving warnings, last-sealed times; design tokens |
| 4 | Tests + docs | parser unit tests (fixture log lines), route test, outcome-merge test; changelog + journal |

## Architecture

- **Shared log file (no socket):** worker `command` wraps stdout with `tee
  /shared/worker.log` onto a new named volume `preagg_logs`, mounted read-only
  into `server`. Keeps `docker logs` working. (Fallback if entrypoint wrap is
  fragile: a collector sidecar reusing the server image with `/var/run/docker.sock:ro`.)
- **Collector** (`server/src/services/preagg-run-collector.ts`): tails the file,
  groups lines between `Refresh Scheduler Interval` markers into a sweep, extracts
  failures (preAgg id, error signature, message, ts), then runs
  `computePreaggReadiness()` once at sweep close, computes the outcome per cube,
  writes one `preagg_sweeps` row + N `preagg_sweep_items`. Idempotent on sweep
  start-ts (re-tail safe). Capped retention (e.g. keep 30 days / prune older).
- **Reuse, don't fork:** `getDb()` for SQLite + migration; `computePreaggReadiness`
  for serveability; Admin/hub tab pattern for the UI.

## Key dependencies / order

Phase 1 (capture+schema) → 2 (API) → 3 (UI) → 4 (tests/docs). Phase 1 is the risk
center (log-file wiring); validate the worker still boots + `docker logs` still
works before building on it.

## Out of scope

- Prod stack (`docker-compose.prod.yml`) — local devcube only this round; mirror
  later once the shape is proven (note: prod worker config must land in BOTH
  registries per workspace-config rollout rule).
- Triggering builds from the UI (read-only history viewer); manual seal stays the
  `cube-dev/scripts/trigger-preagg-build.sh` CLI.
- Real per-rollup build durations (trace-only) — show sweep duration + failure
  cause; per-partition timing is a later enhancement if needed.

## Risks

- **Entrypoint wrap** for `tee` may fight Cube's `docker-entrypoint.sh` → test
  early; fall back to socket sidecar.
- **Log rotation / re-tail dedup** → key sweeps by start-ts, upsert.
- **Serveability false-green** is the whole point — make sure `stale_serving` is
  visually distinct (warning token), not lumped with `sealed`.

## Open questions

- Retention window for history (default proposed: 30 days)? 
- Should `stale_serving` raise anything beyond the UI (e.g. a badge count on the
  hub nav), or is the tab enough for now?
