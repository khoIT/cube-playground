#!/usr/bin/env bash
# Measure Cube pre-aggregation build cost per data model, on real Trino data.
#
# WHAT: for each rollup, runs its build SELECT (the CREATE-TABLE-AS-SELECT the
# refresh worker issues against Trino) wrapped in count(*), timed, per month.
# Reports output-row-count + seconds — the number that should drive refresh cadence.
# Pure read: writes nothing to CubeStore, safe to run anytime.
#
# HOW: harvests each pre-agg's loadSql from the refresh-worker logs, then runs the
# node measurer inside a cube container (which holds the Trino credentials).
# Requires the worker to have attempted builds at least once (so loadSql is in its
# logs). If logs were rotated, restart the worker briefly to repopulate, or extend
# the --since window below.
#
# Usage:
#   cube-dev/scripts/measure-preagg-build.sh [SCHEMA] [API_CONTAINER] [WORKER_CONTAINER]
# Defaults: SCHEMA=cfm_vn, API=cube-playground-cube-api-dev, WORKER=cube-playground-cube-refresh-worker-dev
# Months: override by exporting PREAGG_MONTHS as JSON, e.g.
#   PREAGG_MONTHS='{"Apr26":["2026-04-01","2026-04-30"]}' cube-dev/scripts/measure-preagg-build.sh
set -euo pipefail

SCHEMA="${1:-cfm_vn}"
API="${2:-cube-playground-cube-api-dev}"
WORKER="${3:-cube-playground-cube-refresh-worker-dev}"
MONTHS_JSON="${PREAGG_MONTHS:-{\"May26\":[\"2026-05-01\",\"2026-05-31\"],\"Jun26\":[\"2026-06-01\",\"2026-06-09\"]}}"
HERE="$(cd "$(dirname "$0")" && pwd)"

echo "Harvesting pre-agg build SQL from ${WORKER} logs..."
docker logs "${WORKER}" 2>&1 | python3 -c '
import json, sys
found = {}
def walk(o):
    out = []
    if isinstance(o, dict):
        if isinstance(o.get("loadSql"), list): out.append(o)
        for v in o.values(): out += walk(v)
    elif isinstance(o, list):
        for v in o: out += walk(v)
    return out
for line in sys.stdin:
    line = line.strip()
    if "\"loadSql\"" not in line: continue
    try: obj = json.loads(line)
    except Exception: continue
    for pa in walk(obj):
        pid = pa.get("preAggregationId") or "?"
        sql = pa["loadSql"][0]
        if pid not in found and sql.strip().upper().startswith("CREATE TABLE"):
            parts = sql.split(" AS SELECT", 1)
            if len(parts) == 2: found[pid] = "SELECT" + parts[1]
json.dump(found, open("/tmp/preagg_sql.json", "w"))
print(f"  extracted {len(found)} build SELECTs: " + ", ".join(sorted(found)))
'

[ -s /tmp/preagg_sql.json ] || { echo "No loadSql found in worker logs — restart the worker once, then retry."; exit 1; }

echo "Staging into ${API}..."
docker cp /tmp/preagg_sql.json "${API}:/tmp/preagg_sql.json" >/dev/null
docker cp "${HERE}/measure-preagg-build.mjs" "${API}:/tmp/measure-preagg-build.mjs" >/dev/null

echo "Measuring (schema=${SCHEMA})..."
docker exec -e PREAGG_SCHEMA="${SCHEMA}" -e PREAGG_MONTHS="${MONTHS_JSON}" \
  "${API}" node /tmp/measure-preagg-build.mjs
