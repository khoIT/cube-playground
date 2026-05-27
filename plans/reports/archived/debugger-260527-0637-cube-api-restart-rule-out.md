# cube_api "crashing" — rule-out diagnosis

**Verdict:** cube_api is **not crashing**. It is being **cleanly restarted by the dev watchdog** (`scripts/ensure-cube-api.mjs --watch`) when its `/livez` probe misses. The restarts look like crashes (uptime resets, in-flight queries dropped) but are graceful `docker compose restart`s.

## Evidence

| Possibility | Status | Evidence |
|---|---|---|
| Process panic / non-zero exit | **RULED OUT** | `ExitCode=0`, clean shutdown |
| OOM kill | **RULED OUT** | `OOMKilled=false`, mem `222MiB / 3.8GiB`, no `mem_limit` set |
| Docker restart-policy crash loop | **RULED OUT** | `RestartCount=0` (policy never fired) |
| cubestore crash | **RULED OUT** | `ballistar_cubestore` Up 29h, stable |
| chat-service chart changes (this session) | **RULED OUT** | FE + prompt only; never touches the cube container |
| **Dev watchdog restarting it** | **CONFIRMED mechanism** | Watchdog PID 77504 (`ensure-cube-api.mjs --watch`) running since dev:all start (~21h). Restart signature: `FinishedAt` 23:37:52.458 → `StartedAt` 23:37:52.568 = ~110ms stop→start = a `restart`, exit 0. Only automated restarter present. |

Currently `/livez` and `/readyz` return 200 in ~3ms and the container has been Up 9 min — so it is **intermittent**, not a tight loop right now.

## Why `/livez` misses (so the watchdog kicks)

Contributing factors, strongest first:

1. **Emulation.** Container is `x86_64` on an `arm64` host — `docker-compose.yml` pins `platform: linux/amd64`. But `cubejs/cube:latest` **has a native `linux/arm64` manifest**, so the pin forces emulation for no reason. The compose file's own comment warns amd64-on-arm64 "wedges the Rust binary silently." Under emulation a heavy request can stall the HTTP loop long enough to miss probes.
2. **Lazy pre-aggregation builds.** `CUBEJS_REFRESH_WORKER=false` → pre-aggregations build **inline** on the query that needs them (e.g. `dev_pre_aggregations.active_daily_dau_by_country_payer_daily…`). A 4.8s load was seen in logs. Under emulation these builds can block responsiveness past the probe window.
3. **Tight probe budget.** Watchdog: `/livez` every 30s, 4s timeout, restart after **3 consecutive misses (~90s)**. A long pre-agg build trips this.
4. **Restart-interrupts-build thrash.** Restarting mid-build discards the partial pre-agg; the next query rebuilds from scratch → can re-trigger the next restart. Self-inflicted recurrence.
5. **Unbounded logging** (not a cause, but a real problem): `CUBEJS_LOG_LEVEL=info` logs every SQL query, no `max-size` on the json-file driver → the container log is huge enough that `docker logs --since` hangs. Disk/IO pressure over multi-day sessions.

## How to confirm definitively

- Watch the dev terminal (the `cube` pane) for `[cube-guard] cube_api unreachable for N consecutive probes — triggering recovery`. Each such line = a watchdog-induced restart.
- Or temporarily stop the watchdog pane and see if "crashes" stop while leaving cube_api running.

## Fix options (cube-dev repo — not this repo)

Ranked by leverage. None applied yet — these touch `~/Documents/code/cube-dev`.

1. **Drop the emulation pin** (highest leverage): remove `platform: linux/amd64` from `cube_api` (or set `linux/arm64`) and `docker compose up -d --force-recreate cube_api`. Native arm64 should remove the stalls. Verify the patched Trino entrypoint + a sample `/load` still work on arm64 before trusting it.
2. **Make the watchdog tolerant of "busy but alive":** raise probe timeout (4s→10s) and threshold (3→5), and skip the restart when the container is `running` AND the node process is alive (a 503/slow `/livez` ≠ dead). Avoids interrupting pre-agg builds. (This file lives in *this* repo: `scripts/ensure-cube-api.mjs`.)
3. **Enable a refresh worker** or pre-build the hot pre-aggregations so first-touch queries don't block.
4. **Add log rotation:** `logging: { driver: json-file, options: { max-size: 10m, max-file: 3 } }` on both services.

## Unresolved questions

- Was `platform: linux/amd64` pinned for a real arm64 incompatibility (Trino driver / native dep)? Need to test option 1 before adopting — there may have been a reason it was added.
- No watchdog restart count is persisted; can't quantify restarts/hour without scraping the dev terminal or adding a log file to `ensure-cube-api.mjs`.
