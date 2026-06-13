# CubeStore cache, eviction & introspection

How CubeStore stores pre-aggregations, what evicts (and what doesn't), and how
to read its real state. Written after observing the readiness matrix report
"green" for rollups that were actually serving from Trino (passthrough).

## Two cache layers — don't conflate them

1. **CubeStore pre-aggregation tables** (the materialised rollups; schemas
   `preagg_<game>`, `prod_pre_aggregations`). A *matched* query serves from here
   with **zero Trino hits**. But this is NOT a fill-on-demand cache: a partition
   exists only if a **build** ran, and the build reads Trino. No Trino → no build
   → nothing to serve. Lambda rollups (`rollup_lambda` + `union_with_source_data`)
   additionally read a **live tail from source on every query**, so they touch
   Trino even when the batch partition is sealed.

2. **In-memory query-result cache** (on the Cube API node, or the CubeStore
   *cachestore* when `CUBEJS_CACHE_AND_QUEUE_DRIVER=cubestore`). Short-lived,
   keyed by query + refreshKey. Holds result sets, not rollup tables; can't serve
   a cold rollup. **This is the layer with eviction semantics.**

## Eviction / retention model

**Durable pre-agg tables: never auto-evicted.** No TTL, no LRU, no size-pressure
drop. A partition persists until the Cube **refresh worker** explicitly replaces
it (new build seals → old dropped) or `DROP`s it. Lifecycle is driven by:

- `refresh_key` (e.g. `every: 1 hour, incremental: true`) — how often the worker
  re-checks and rebuilds the current/affected partition.
- `build_range_start/end` — hard bounds on which partitions can exist. Anything
  outside the range is never materialised → those queries fall to source.
- The worker must actually run. With `CUBEJS_DEV_MODE=false` there's no
  hot-reload; new rollups stay dormant until the serving instance restarts.

**Cachestore (result/queue cache): TTL + LRU/LFU eviction.** Only when
`CUBEJS_CACHE_AND_QUEUE_DRIVER=cubestore`. Six policies via
`CUBESTORE_CACHE_EVICTION_POLICY` (`allkeys-lru|lfu|ttl`, `sampled-*`). Eviction
runs when soft limits (`CUBESTORE_CACHE_MAX_SIZE`, `..._MAX_KEYS`) are exceeded;
entries past TTL are proactively dropped. LFU counters decay over
`CUBESTORE_CACHE_LFU_DECAY_TIME`. Knobs are all `CUBESTORE_CACHE_*`. (Source:
`cube-raw/rust/cubestore/.../cachestore/cache_eviction_manager.rs`.)

## Reading the real state (introspection)

CubeStore speaks the MySQL wire protocol on `:3306` (no auth on the bare
cluster). Syntax is **lowercase** — dotted `SYSTEM.TABLES` fails. `SUM(boolean)`
and JOINs are unreliable; pull flat result sets and aggregate client-side.

| Query | Use |
|-------|-----|
| `SELECT * FROM information_schema.schemata` | list pre-agg schemas (`preagg_cfm`, …) |
| `SELECT id, table_schema, table_name, has_data, is_ready, sealed, build_range_end, seal_at FROM system.tables` | per-table materialisation + freshness |
| `SELECT id, table_id FROM system.indexes` | map `partition.index_id → table_id` |
| `SELECT index_id, active, main_table_row_count, file_size FROM system.partitions` | partition size/rows + **active** flag |

`active = false` on every partition of a table = **registered but not sealed** →
queries on it pass through to source. This is the state that masqueraded as green.

Physical table names carry a version/range suffix:
`<base>[batchYYYYMMDD]_<contentHash>_<structHash>_<id>` — group by the stripped
base to get the logical pre-agg.

## In this app

- **Rollup readiness** probe asserts `usedPreAggregations` on the `/load`
  response → `built` only when a rollup actually served; `from-source` when a 200
  fell through to Trino. (`server/src/services/preagg-readiness.ts`)
- **CubeStore storage** panel + **query-cache checker** read the `system.*`
  tables above (`server/src/services/cubestore-introspect.ts`,
  `cubestore-query-cache-check.ts`), behind `CUBESTORE_INTROSPECT_ENABLED`.
  Local dev maps cubestore `:3306 → 13306` (see `docker-compose.devcube.yml`);
  in-stack callers reach it by service name.

See also `docs/lessons-learned.md` (passthrough-reads-as-green) and the research
report in `plans/reports/researcher-260613-1429-cubestore-eviction-and-introspection-report.md`.
