#!/usr/bin/env bash
# Manually build + seal one game's pre-aggregations on demand.
#
# WHAT: scopes the refresh worker to a single game (CUBE_REFRESH_GAMES), restarts it
# so it sweeps only that game's rollups, and monitors until builds go quiet — then
# reports, per pre-aggregation, whether it sealed or errored (and which error).
# The heavy work (Trino aggregate + CubeStore write + seal) runs IN THE WORKER;
# this script only scopes, triggers, monitors, and (optionally) parks the worker.
#
# WHY this shape: this prod-mode stack has no on-demand build API (the /cubejs-system
# jobs endpoint needs CUBEJS_DEV_MODE=true, which also disables auth) and neither
# instance builds on query. Scheduled refresh is the only thing that seals — so we
# drive it, scoped, instead of re-grinding all 7 tenants.
#
# Usage:
#   cube-dev/scripts/trigger-preagg-build.sh <game> [--minutes N] [--timer S] [--stop]
#     <game>      e.g. cfm | cfm_vn | ballistar   (aliases are canonicalised by cube.js)
#     --minutes N monitoring window (default 10)
#     --timer S   sweep interval in seconds (default 30; the worker's normal 300s
#                 is too slow to catch a sweep inside a short window)
#     --stop      stop the worker when done (returns the stack to auto-run-off)
set -euo pipefail

GAME="${1:?usage: trigger-preagg-build.sh <game> [--minutes N] [--timer S] [--stop|--restore]}"; shift || true
MINUTES=10; STOP=0; TIMER=30; RESTORE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --minutes) MINUTES="${2:?}"; shift 2;;
    --timer)   TIMER="${2:?}"; shift 2;;
    --stop)    STOP=1; shift;;
    # --restore: when done, recreate the worker with its default (all-games,
    # hourly) config instead of leaving it scoped to GAME. This is what the UI
    # trigger uses so a one-off build never leaves the shared sweep mis-scoped.
    --restore) RESTORE=1; shift;;
    *) echo "unknown arg: $1"; exit 2;;
  esac
done

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"        # cube-dev/scripts -> repo root
COMPOSE="$ROOT/docker-compose.devcube.yml"
WORKER=cube-playground-cube-refresh-worker-dev
START_TS="$(date -u +%Y-%m-%dT%H:%M:%S)"

# Every force-recreate below DESTROYS the container's log history — and the
# gateway's preagg-run collector reads those logs to populate sweep history.
# Dump them to a shared dir first (--timestamps matches the collector's docker
# API read); the collector ingests + deletes these files on its next pass.
SNAPSHOT_DIR="${PREAGG_BUILD_LOG_SNAPSHOT_DIR:-/tmp/cube-playground-preagg-log-snapshots}"
snapshot_logs() {  # $1: label; $2 (optional): --since duration, else full history
  mkdir -p "${SNAPSHOT_DIR}" 2>/dev/null || return 0
  local out="${SNAPSHOT_DIR}/$(date +%s)-${GAME}-$1.log"
  if [ -n "${2:-}" ]; then
    docker logs --timestamps --since "$2" "${WORKER}" > "${out}" 2>&1 || true
  else
    docker logs --timestamps "${WORKER}" > "${out}" 2>&1 || true
  fi
  [ -s "${out}" ] || rm -f "${out}"   # drop empty/failed dumps
}

echo "▶ Scoping refresh worker to game='${GAME}' and (re)starting it…"
# The outgoing all-games container may hold sweep logs the collector (5-min
# cadence) hasn't ingested yet — preserve the recent tail before wiping it.
snapshot_logs prescope 15m
# Override the sweep interval to ${TIMER}s (default 300s is too slow to catch a
# sweep inside a short monitoring window). A small timer makes the first sweep
# fire almost immediately so partitions seal while we watch.
# Force trace logging: the per-partition `CREATE TABLE preagg_<game>.…`
# lines we grep for to detect builds are only emitted at trace level — at the
# worker's normal `info` level the build is invisible and this script reports
# build-attempts=0 even while partitions are sealing.
CUBE_REFRESH_GAMES="${GAME}" CUBEJS_SCHEDULED_REFRESH_TIMER="${TIMER}" CUBEJS_LOG_LEVEL=trace \
  docker compose -f "${COMPOSE}" up -d --no-deps --force-recreate cube_refresh_worker_dev >/dev/null
echo "  worker rebuilding ${GAME} rollups (sweep every ${TIMER}s); monitoring up to ${MINUTES}m (Ctrl-C is safe)…"

# Real partition tables are named <cube>_<rollup>_batch<YYYYMM>_<hash>_<hash>_<hash>
# (or, for non-partitioned rollups, <cube>_<rollup>_<hash>_<hash>_<hash>). Collapse
# either shape to its stable base name so we count/attribute by pre-aggregation.
ERR_SIGS='after it was successfully created|later than self|must be a time or timestamp'
base_names() {  # stdin: log text -> stdout: sorted-unique pre-agg base names
  grep -oE 'CREATE TABLE preagg_[a-z0-9]+\.[a-z_0-9]+' \
    | sed -E 's#^CREATE TABLE preagg_[a-z0-9]+\.##; s#_batch[0-9]+.*#_batch#; s#_[a-z0-9]{8}_[a-z0-9]{8}_[a-z0-9]+$##' \
    | sort -u
}

# Poll every 30s. Stop early once a CREATE TABLE burst is followed by ~90s of quiet.
deadline=$(( $(date +%s) + MINUTES*60 ))
last_attempts=0; quiet=0
while [ "$(date +%s)" -lt "${deadline}" ]; do
  sleep 30
  logs="$(docker logs --since "${START_TS}" "${WORKER}" 2>&1 || true)"
  attempts="$(printf '%s' "${logs}" | grep -coE 'CREATE TABLE preagg_[a-z0-9]+\.' || true)"
  errs="$(printf '%s' "${logs}" | grep -coE "${ERR_SIGS}" || true)"
  printf '  +%ds  build-attempts=%s  errors=%s\n' "$(( $(date +%s) - deadline + MINUTES*60 ))" "${attempts}" "${errs}"
  if [ "${attempts}" = "${last_attempts}" ] && [ "${attempts}" -gt 0 ]; then
    quiet=$(( quiet + 1 )); [ "${quiet}" -ge 3 ] && { echo "  builds quiet — finishing early."; break; }
  else quiet=0; fi
  last_attempts="${attempts}"
done

echo ""
echo "── Per-pre-aggregation outcome (game=${GAME}) ──"
logs="$(docker logs --since "${START_TS}" "${WORKER}" 2>&1 || true)"
attempted="$(printf '%s' "${logs}" | base_names || true)"
[ -z "${attempted}" ] && echo "  (no build attempts seen yet — worker may still be compiling; re-run with more --minutes or a smaller --timer)"
for pa in ${attempted}; do
  # a pre-agg whose log lines include an error signature failed; otherwise treated as sealed
  if printf '%s' "${logs}" | grep -E "${pa}" | grep -qE "${ERR_SIGS}"; then
    sig="$(printf '%s' "${logs}" | grep -E "${pa}" | grep -oE "${ERR_SIGS}" | sort -u | head -1)"
    printf '  ✗ %-52s ERROR: %s\n' "${pa}" "${sig}"
  else
    printf '  ✓ %-52s sealed (no build error in window)\n' "${pa}"
  fi
done

if [ "${RESTORE}" = 1 ]; then
  echo "" && echo "▶ restoring worker to default config (all games, hourly)…"
  # The scoped container's full history IS the build window — preserve it so
  # the collector can backfill sweep history with this build's stats.
  snapshot_logs window
  docker compose -f "${COMPOSE}" up -d --no-deps --force-recreate cube_refresh_worker_dev >/dev/null
  echo "  worker back to all-games sweep."
elif [ "${STOP}" = 1 ]; then
  docker stop "${WORKER}" >/dev/null && echo "" && echo "▶ worker stopped (auto-run off)."
else
  echo "" && echo "▶ worker left running (still scoped to ${GAME}). Stop it with: docker stop ${WORKER}"
fi
echo "Verify serving:  cube-dev/scripts/measure-preagg-build.sh ${GAME}   (or run your Playground query)"
