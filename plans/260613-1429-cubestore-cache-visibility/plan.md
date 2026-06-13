# CubeStore cache visibility + hardened rollup probe

Status: DONE (both phases shipped, code-reviewed, live-verified) · Owner: khoitn · Branch: main

## Outcome (260613)

- Phase 01 DONE: 4-state probe live — local probe flipped `built:53` → `fromSource:53`
  (all were Trino passthrough). Fixed 4 pre-existing preagg-readiness test failures too.
- Phase 02 DONE: CubeStore storage panel + query-cache checker; mysql2 → cubestore :3306
  (mapped :13306), env `CUBESTORE_INTROSPECT_ENABLED`. Live: checker returns `materialized`
  (9 active partitions, 945 rows) for a May range; storage panel reads 9 schemas.
- Code review: no blockers; S1 (dry-run name must NOT be re-stripped — was always `not-built`)
  fixed + symmetry test; S2 comment added.
- Tests: server 1394/1394; FE Admin hub 90/90. Docs: docs/cubestore-cache-and-eviction.md +
  lessons-learned entry.
- Activation: host dev server needs restart to pick up `.env.local` flag (UI shows panel after).

## Why

The `/admin/preagg-runs` "Rollup readiness" matrix calls any HTTP-200 `/load` "built/green",
even when the query fell through to Trino (passthrough, `usedPreAggregations: []`). So green meant
"Cube could answer", not "a rollup actually served". Verified live: local per-game probes returned
200 + 0 rows + empty `usedPreAggregations` while CubeStore held 134 *registered-but-inactive*
`preagg_cfm` tables (partitions `active=false, file_size=NULL`). The matrix was masking the real
state: rollups defined, not sealed, queries silently hitting source.

## Decisions (user-confirmed 260613)

1. Probe: 4 states — `built` (rollup active, green) / `from-source` (200 but Trino passthrough, amber)
   / `unbuilt` (partition-not-built error, gray) / `error` (red).
2. CubeStore access: map cubestore `:3306` to host + thin `mysql2` client, env-flagged, read-only.
3. Depth: storage panel (materialized pre-aggs: ready/sealed/active, freshness, partitions, size, rows)
   + per-query cache checker (dry-run → preAggregationId → is that table materialized & active?).
4. Placement: extend the Pre-agg Runs tab; eviction/retention model written to `docs/`.

## Verified facts (live, this session)

- CubeStore MySQL wire on `:3306`, **no auth**, reachable on `cube-playground_default` docker net.
- Syntax is lowercase: `system.tables`, `system.partitions`, `system.chunks`, `system.indexes`,
  `information_schema.tables|schemata`. Dotted `SYSTEM.TABLES` fails.
- `system.tables` cols: id, schema_id, table_schema, table_name, has_data, is_ready, created_at,
  build_range_end, seal_at, sealed, partition_split_threshold, …
- `system.partitions` cols: id, index_id (→ table id), active, main_table_row_count, file_size.
- `SUM(boolean)` unsupported in CubeStore SQL → aggregate in JS, not in the query.
- Physical table name = `<logical_preagg_base>` + `<rangeYYYYMMDD>_<hash>_<hash>_<suffix>`.
  Group/match by `table_name LIKE '<base>%'`.
- Eviction model (researcher report): durable pre-agg tables are NEVER auto-evicted by CubeStore —
  only replaced/dropped by the Cube refresh worker. Only the *cachestore* result/queue cache
  (CUBEJS_CACHE_AND_QUEUE_DRIVER=cubestore) has TTL + LRU/LFU eviction. Knobs: CUBESTORE_CACHE_*.

## Phases

- [phase-01-harden-rollup-probe.md](phase-01-harden-rollup-probe.md) — 4-state probe via `usedPreAggregations`.
- [phase-02-cubestore-storage-introspection.md](phase-02-cubestore-storage-introspection.md) — mysql2 client,
  storage panel, query-cache checker, docs.

## Reports

- research/researcher-…cubestore-eviction-and-introspection-report.md (in plans/reports/)
