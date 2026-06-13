# Phase 02 — CubeStore storage introspection panel + query-cache checker

Status: pending · Priority: high · Depends on: phase-01 (shares the tab)

## Goal

See what CubeStore actually holds: per pre-agg materialization (ready/sealed/active partitions,
freshness, size, rows), and answer "does this query have cache?" by resolving its preAggregationId
(dry-run) and checking the physical table state.

## Backend

- `docker-compose.yml` (+ dev compose if separate): map cubestore `:3306` → host (e.g. `13306:3306`)
  so the host dev server reaches it. Prod server reaches by service name (no map needed there).
- `server/package.json`: add `mysql2` dep.
- `server/src/services/cubestore-introspect.ts` (new, <200 LOC):
  - env: `CUBESTORE_INTROSPECT_ENABLED` (default false), `CUBESTORE_MYSQL_HOST` (default 127.0.0.1),
    `CUBESTORE_MYSQL_PORT` (default 13306), `CUBESTORE_MYSQL_USER` (default root).
  - pooled mysql2 connection; read-only. Two queries (no JOIN, no SUM(bool)):
    `SELECT id, table_schema, table_name, has_data, is_ready, sealed, created_at, build_range_end, seal_at FROM system.tables`
    `SELECT index_id, active, main_table_row_count, file_size FROM system.partitions`
  - aggregate in JS: group tables by (schema, logical base via suffix strip), fold partition stats by
    table id ↔ index_id; per pre-agg → {schema, base, tables, activePartitions, rows, bytes, ready,
    sealed, buildRangeEnd, sealAt}. TTL-cache 30s (mirror preagg-readiness cache).
  - `suffix strip`: physical `<base>_<rangeYYYYMMDD>?_<hash>_<hash>_<suffix>` → base = drop trailing
    `_<digits/hash>` version segments; conservative regex, keep raw table_name available.
- `server/src/services/cubestore-query-cache-check.ts` (new) OR fold into route:
  - input {workspace, game, query}; call `/sql` dry-run via cube-client (sqlWithCtx) → read
    `preAggregations[].{preAggregationId, tableName}`; for each, look up CubeStore state → return
    {preAggregationId, tableName, schema, materialized: has_data&&is_ready, activePartitions>0, sealed,
    rows, bytes, buildRangeEnd}.
- `server/src/routes/preagg-runs.ts` (or new `cubestore.ts` mounted same prefix):
  - `GET  /api/preagg-runs/cubestore/tables` → grouped pre-agg materialization (admin-gated).
  - `POST /api/preagg-runs/cubestore/query-cache` → body {game, query} → checker result.
  - both 503 `{disabled:true}` when `CUBESTORE_INTROSPECT_ENABLED` false (UI renders calm note).

## Frontend

- `src/pages/Admin/hub/cubestore-storage-panel.tsx` (new): table grouped by schema; columns
  pre-agg · state (ready/sealed/active chip) · partitions(active/total) · rows · size · freshness(build_range_end).
  Tokens only; mirror existing card/eyebrow/th recipes. Disabled-state note when 503.
- `src/pages/Admin/hub/cubestore-query-cache-checker.tsx` (new): game select (from probe games) +
  cube+measure select (from `useServeabilityNow` games' cube list, or free-text member) → POST →
  verdict chip (materialized & serving / registered not sealed / no preagg / disabled). Explains passthrough.
- `src/pages/Admin/hub/cubestore-data.ts` (new): `useCubestoreTables()`, `useQueryCacheCheck()` hooks
  (apiFetch, expand/poll gated, console.warn on error — mirror preagg-runs-data patterns).
- `src/pages/Admin/hub/preagg-runs-tab.tsx`: mount both below the readiness matrix; collapsible section
  "CubeStore storage" so the tab stays scannable.
- `src/types/` as needed for the new payload shapes (or co-locate in cubestore-data.ts).

## Docs

- `docs/cubestore-cache-and-eviction.md` (new, concise): two layers (durable pre-agg tables = no auto
  evict, replaced/dropped by refresh worker; cachestore result/queue cache = TTL+LRU/LFU, CUBESTORE_CACHE_*
  knobs). Introspection cheatsheet (the working lowercase system.* queries). Link from
  docs/lessons-learned.md + a one-line pointer in system-architecture.md.

## Tests

- `server/test/cubestore-introspect.test.ts` — suffix-strip + JS aggregation (pure fns; mock the two
  row arrays; no live mysql). Disabled-flag path returns disabled.
- `server/test/cubestore-query-cache-check.test.ts` — dry-run preAggregations → verdict mapping (mock
  cube-client + introspect).
- route test — gating (503 when disabled), shape when enabled (mock the service).
- FE: panel renders rows + disabled note; checker renders verdict (mock hooks).

## Risks

- mysql2 vs CubeStore wire quirks (auth none; limited SQL). Mitigated: verified queries live; aggregate
  in JS; no JO/SUM(bool).
- Port-map recreate restarts cubestore briefly (drops in-flight queries). Operator action, not auto.
- Naming suffix strip heuristic — keep raw name; group best-effort; never hide a table we can't parse.

## Success

- Panel lists preagg_cfm etc. with active/total partitions exposing the registered-but-inactive state.
- Checker on a known passthrough query → "registered, not sealed → served from source".
- Disabled flag → calm note, no errors. Docs explain eviction. Tests green; tsc clean.
