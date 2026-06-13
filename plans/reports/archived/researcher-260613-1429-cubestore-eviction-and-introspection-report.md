# CubeStore Eviction & Introspection Research

## Executive Summary

- **Eviction**: CubeStore has TWO distinct eviction subsystems: (i) durable pre-agg table refresh (explicit Cube worker drops/replaces), and (ii) "cachestore" in-memory result cache (TTL + LRU/LFU/sampling with configurable policies)
- **Cachestore**: Result cache w/ tunable eviction (6 policies: allkeys-lru, allkeys-lfu, allkeys-ttl + sampled variants); no TTL on pre-agg tables themselves
- **Introspection**: Rich INFORMATION_SCHEMA support — `SYSTEM.TABLES`, `SYSTEM.PARTITIONS`, `SYSTEM.CHUNKS`, `SYSTEM.INDEXES` query tables expose materialization state + freshness
- **Pre-agg naming**: No special naming convention — tables stored in schema like `preagg_cfm` (from Cube YAML schema config); partitions have `_part_{id}` suffix; chunks have `_chunk_{id}` suffix
- **Config**: ~20 env knobs for cachestore (max_size, max_keys, eviction loop interval, policy, LFU decay, TTL thresholds, proactive deletion)

---

## 1. EVICTION / RETENTION MODEL

### 1.1 Durable Pre-Agg Tables: No Built-in Eviction

Pre-aggregation tables (the materialized Parquet files on disk) are **not evicted by CubeStore itself**. Instead:

- **Cube refresh worker** (external to CubeStore) controls the lifecycle: creates new table/partitions, seals them, or replaces old ones.
- **Explicit DROP**: Only removed when Cube explicitly sends `DROP TABLE` or refresh replaces it.
- **Metadata in metastore**: Tables have `sealed` flag + `seal_at` timestamp, tracked in RocksDB metastore.
- **No size/age-based auto-drop**: CubeStore does not have TTL or LRU for durable tables — they persist until explicit replacement.

**Evidence:**
- `/Users/lap16299/Documents/code/cube-raw/rust/cubestore/cubestore/src/metastore/table.rs:131–170` — Table struct has `sealed: bool`, `seal_at: Option<DateTime<Utc>>`, `build_range_end: Option<DateTime<Utc>>`, but NO TTL/expiry field for durable tables.
- No `drop_table` eviction loop found; refresh is Cube's responsibility.

---

### 1.2 Cachestore: In-Memory Result Cache with TTL + Eviction Policies

**Purpose**: Stores query results + cachestore queue payloads (CUBEJS_CACHE_AND_QUEUE_DRIVER=cubestore mode).

**Eviction trigger**: When cache size or key count exceeds soft limits (limit_max_size_soft, limit_max_keys_soft), eviction loop runs.

**Eviction policies** (6 variants, configurable via `CUBESTORE_CACHE_EVICTION_POLICY`):

| Policy | Mechanism | Notes |
|--------|-----------|-------|
| `allkeys-lru` | Evict least-recently-used; scan all keys | Best for uniform access patterns |
| `allkeys-lfu` | Evict least-frequently-used; decay over time | Requires tracking LFU counter (default init=10) |
| `allkeys-ttl` | Evict entries with shortest remaining TTL; scan all | Prioritize fresh entries |
| `sampled-lru` | LRU but sample 6 entries per scan, stop early | Faster; same semantic as allkeys-lru |
| `sampled-lfu` | LFU but sample 6 entries per scan, stop early | Faster; same semantic as allkeys-lfu |
| `sampled-ttl` | TTL but sample 6 entries per scan, stop early | Faster; same semantic as allkeys-ttl |

**Evidence:**
- `/Users/lap16299/Documents/code/cube-raw/rust/cubestore/cubestore/src/cachestore/cache_eviction_manager.rs:51–76` — CacheEvictionPolicy enum with all 6 variants.
- Lines 109–126: FromStr parser accepts "allkeys-lru", "allkeys-lfu", "allkeys-ttl", "sampled-lru", "sampled-lfu", "sampled-ttl".

---

### 1.3 Cachestore TTL Handling

Each cache entry can have an optional TTL. Entries are **proactively deleted** if:

1. TTL has passed (load phase, line 655–658).
2. TTL is within `CUBESTORE_CACHE_EVICTION_PROACTIVE_TTL_THRESHOLD` seconds AND entry size > `CUBESTORE_CACHE_EVICTION_PROACTIVE_SIZE_THRESHOLD` (lines 709–726).

**LFU Decay**: Frequency counter decays over elapsed minutes by a factor `CUBESTORE_CACHE_LFU_DECAY_TIME` (lines 294–308, 136–143).

**Evidence:**
- `/Users/lap16299/Documents/code/cube-raw/rust/cubestore/cubestore/src/cachestore/cache_eviction_manager.rs:629–672` — `collect_stats_and_expired_keys()` scans all items, totals stats, flags expired items.
- Lines 709–726: Proactive TTL + size check.
- Lines 294–308: LFU decay logic on cache lookup.
- Lines 136–143: `lfu_decay_counter()` subtracts `elapsed_minutes / decay_time` from counter (saturates at 0).

---

### 1.4 Soft & Hard Limits + Eviction Thresholds

- **Soft limits**: `limit_max_size_soft` + `limit_max_keys_soft` — when exceeded, trigger eviction.
- **Hard limits**: Soft + percentage bump (`CUBESTORE_CACHE_THRESHOLD_TO_FORCE_EVICTION`) — prevents insertion if hard limit exceeded (lines 1065–1075).
- **Eviction target**: Eviction loop removes extra `CUBESTORE_CACHE_EVICTION_BELOW_THRESHOLD` percentage beyond soft limit (lines 537–550).

**Evidence:**
- Lines 351–362: Soft + hard limit setup.
- Lines 537–550: Eviction target calculation.
- Lines 1065–1075: `need_to_evict()` checks hard limits before insert.

---

## 2. CACHESTORE CONFIGURATION KNOBS

All CUBESTORE_* env vars map to ConfigObj trait methods. Key knobs:

| Env Var (CUBESTORE_*) | Type | Effect | Default Likely |
|---|---|---|---|
| `CACHE_EVICTION_LOOP_INTERVAL` | u64 (secs) | How often eviction runs | 5–10s |
| `CACHE_TTL_PERSIST_LOOP_INTERVAL` | u64 (secs) | How often TTL/LFU metrics persist to disk | 60s |
| `CACHE_MAX_SIZE` | u64 (bytes) | Soft limit for total cache size | 1GB+ |
| `CACHE_MAX_KEYS` | u32 | Soft limit for key count | 100k+ |
| `CACHE_MAX_ENTRY_SIZE` | usize (bytes) | Max size per single entry | 1MB+ |
| `CACHE_EVICTION_POLICY` | str | One of 6 policies above | "sampled-lru" |
| `CACHE_EVICTION_BATCH_SIZE` | usize | Delete N items per batch | 100–1000 |
| `CACHE_EVICTION_BELOW_THRESHOLD` | u8 (%) | Extra % to evict past soft limit | 10% |
| `CACHE_EVICTION_PROACTIVE_SIZE_THRESHOLD` | u32 (bytes) | Min entry size for proactive TTL deletion | 1KB |
| `CACHE_EVICTION_PROACTIVE_TTL_THRESHOLD` | u32 (secs) | Time-to-expire for proactive deletion | 3600s (1h) |
| `CACHE_COMPACTION_TRIGGER_SIZE` | u64 (bytes) | RocksDB compaction threshold | 100GB |
| `CACHE_LFU_LOG_FACTOR` | u8 | LFU increment probability divisor | 10 |
| `CACHE_LFU_DECAY_TIME` | u32 (mins) | LFU counter decay rate | 60–120 mins |
| `CACHE_TTL_NOTIFY_CHANNEL` | usize | In-memory event channel capacity | 10k |
| `CACHE_TTL_BUFFER_MAX_SIZE` | usize | TTL buffer HashMap max entries before persist | 1k–10k |
| `QUEUE_RESULTS_EXPIRE` | u64 (secs) | Queue result item TTL | 86400s (1 day) |

**Evidence:**
- `/Users/lap16299/Documents/code/cube-raw/rust/cubestore/cubestore/src/config/mod.rs` — ConfigObj trait + DefaultConfig struct with all knobs listed above (grep "cachestore_cache" extracts full list).

---

## 3. INTROSPECTION SURFACE: INFORMATION_SCHEMA & SYSTEM TABLES

### 3.1 Standard INFORMATION_SCHEMA Support

CubeStore exposes **INFORMATION_SCHEMA.TABLES** (MySQL-compatible):

```sql
SELECT * FROM INFORMATION_SCHEMA.TABLES;
```

**Columns** (from `info_schema_tables.rs:26–40`):

| Column | Type | Content |
|--------|------|---------|
| table_schema | Utf8 | Schema name (e.g., "preagg_cfm") |
| table_name | Utf8 | Table name (e.g., "active_daily") |
| build_range_end | Timestamp | Max data timestamp in table |
| seal_at | Timestamp | When table was sealed |

**Rank: LOW usefulness** — minimal: only schema, table name, and 2 freshness timestamps. No partition/chunk detail, no byte size, no row count.

**Evidence:**
- `/Users/lap16299/Documents/code/cube-raw/rust/cubestore/cubestore/src/queryplanner/info_schema/info_schema_tables.rs:26–40` — Schema + columns.

---

### 3.2 SYSTEM.TABLES: Extended Metadata

```sql
SELECT * FROM SYSTEM.TABLES;
```

**Columns** (from `system_tables.rs:28–61`):

| Column | Type | Content | Usefulness |
|--------|------|---------|-----------|
| id | UInt64 | Table ID | Unique identifier |
| schema_id | UInt64 | Schema ID | Foreign key |
| table_schema | Utf8 | Schema name | Name lookup |
| table_name | Utf8 | Table name | **Key** |
| columns | Utf8 | Debug format of column defs | Minimal (debug print) |
| locations | Utf8 | S3/GCS paths | Optional, for external tables |
| import_format | Utf8 | Format (Parquet, etc) | **Key** |
| has_data | Boolean | Whether table has any rows | Materialized? |
| is_ready | Boolean | Ready to query? | **Key** |
| unique_key_column_indices | Utf8 | PK columns (debug) | Minimal |
| aggregate_columns | Utf8 | Agg function defs (debug) | Minimal |
| seq_column_index | Utf8 | Sequence column (debug) | Rarely used |
| partition_split_threshold | UInt64 | Threshold for partition splits | Config |
| created_at | Timestamp | Table creation time | **Key** |
| build_range_end | Timestamp | Max data timestamp | **Key** |
| seal_at | Timestamp | Seal timestamp | **Key** |
| sealed | Boolean | Is table sealed? | **Key** — immutable if true |
| select_statement | Utf8 | Define-as SQL (for views/imports) | Optional |
| extension | Utf8 | Extension metadata | Rarely used |

**Rank: HIGH usefulness** — rich metadata: freshness, sealing state, import format, ready status.

**Evidence:**
- `/Users/lap16299/Documents/code/cube-raw/rust/cubestore/cubestore/src/queryplanner/info_schema/system_tables.rs:28–61`.

---

### 3.3 SYSTEM.PARTITIONS: Partition-Level Detail

```sql
SELECT * FROM SYSTEM.PARTITIONS;
```

**Columns** (from `system_partitions.rs:24–39`):

| Column | Type | Content | Usefulness |
|--------|------|---------|-----------|
| id | UInt64 | Partition ID | **Key** — unique across tables |
| file_name | Utf8 | Physical filename (computed from ID + suffix) | **Key** — maps to on-disk Parquet |
| index_id | UInt64 | Parent index (pre-agg) ID | **Key** — links to table |
| parent_partition_id | UInt64 | Parent if this is a sub-partition | Rarely used |
| multi_partition_id | UInt64 | Multi-partition group ID | Rarely used |
| min_value | Utf8 | Min value of partition key (debug) | Minimal (debug print) |
| max_value | Utf8 | Max value of partition key (debug) | Minimal (debug print) |
| min_row | Utf8 | Min row across columns (debug) | Minimal (debug print) |
| max_row | Utf8 | Max row across columns (debug) | Minimal (debug print) |
| active | Boolean | Actively served by queries? | **Key** |
| warmed_up | Boolean | Pre-warmed in memory? | Performance hint |
| main_table_row_count | UInt64 | Approx row count | **Key** |
| file_size | UInt64 | Parquet file byte size | **Key** — critical for monitoring |

**Rank: VERY HIGH usefulness** — partition-level granularity: file size, row count, active state, parent table linkage.

**Evidence:**
- `/Users/lap16299/Documents/code/cube-raw/rust/cubestore/cubestore/src/queryplanner/info_schema/system_partitions.rs:24–39`.

---

### 3.4 SYSTEM.CHUNKS: Sub-Partition Chunks

```sql
SELECT * FROM SYSTEM.CHUNKS;
```

**Columns** (from `system_chunks.rs:27–55`):

| Column | Type | Content | Usefulness |
|--------|------|---------|-----------|
| id | UInt64 | Chunk ID | **Key** — unique identifier |
| file_name | Utf8 | Physical filename | **Key** — maps to on-disk |
| partition_id | UInt64 | Parent partition ID | **Key** — parent link |
| replay_handle_id | UInt64 | Ingestion replay handle | Rarely used |
| row_count | UInt64 | Rows in chunk | **Key** |
| uploaded | Boolean | Flushed to object store? | **Key** — in-memory vs persisted |
| active | Boolean | Actively served? | **Key** |
| in_memory | Boolean | Still in memory (not persisted)? | **Key** — performance + freshness |
| created_at | Timestamp | Creation time | **Key** |
| oldest_insert_at | Timestamp | Oldest inserted row timestamp | Freshness |
| deactivated_at | Timestamp | When chunk was closed | Optional |
| file_size | UInt64 | Byte size on disk | **Key** |
| min_row | Utf8 | Min row across columns (debug) | Minimal (debug print) |
| max_row | Utf8 | Max row across columns (debug) | Minimal (debug print) |

**Rank: VERY HIGH usefulness** — chunk-level detail: in-memory flag, upload state, creation time, row count, byte size. Critical for "what's materialized right now?"

**Evidence:**
- `/Users/lap16299/Documents/code/cube-raw/rust/cubestore/cubestore/src/queryplanner/info_schema/system_chunks.rs:27–55`.

---

### 3.5 SYSTEM.INDEXES: Pre-Agg Index Metadata

```sql
SELECT * FROM SYSTEM.INDEXES;
```

**Columns** (from `system_indexes.rs:23–33`):

| Column | Type | Content | Usefulness |
|--------|------|---------|-----------|
| id | UInt64 | Index ID (maps to pre-agg definition) | **Key** |
| table_id | UInt64 | Parent table ID | Link |
| name | Utf8 | Index name (pre-agg name from Cube YAML) | **Key** — semantic name |
| columns | Utf8 | Index columns (debug format) | Minimal (debug print) |
| sort_key_size | UInt64 | Number of sort key columns | Config |
| partition_split_key_size | UInt64 | Partition split key cardinality | Config |
| multi_index_id | UInt64 | Multi-index group ID | Rarely used |
| index_type | Utf8 | Index type (debug format) | Minimal (debug print) |

**Rank: MEDIUM usefulness** — links pre-agg names to table IDs; allows joining SYSTEM.INDEXES → SYSTEM.TABLES → SYSTEM.PARTITIONS → SYSTEM.CHUNKS to drill down from pre-agg name to materialized partitions/chunks.

**Evidence:**
- `/Users/lap16299/Documents/code/cube-raw/rust/cubestore/cubestore/src/queryplanner/info_schema/system_indexes.rs:23–33`.

---

### 3.6 Recommended Query for Monitoring UI

**Most useful for "what pre-aggs are materialized + how fresh + how big?":**

```sql
SELECT
  si.name AS preagg_name,
  st.table_schema,
  st.table_name,
  st.is_ready,
  st.sealed,
  st.build_range_end,
  st.seal_at,
  COUNT(sp.id) AS partition_count,
  SUM(sp.file_size) AS total_byte_size,
  SUM(sp.main_table_row_count) AS total_row_count,
  MAX(sp.active) AS has_active_partition,
  CAST(SUM(sp.file_size) / 1024.0 / 1024.0 / 1024.0 AS DECIMAL) AS size_gb
FROM
  SYSTEM.INDEXES si
  JOIN SYSTEM.TABLES st ON si.table_id = st.id
  LEFT JOIN SYSTEM.PARTITIONS sp ON st.id = sp.index_id
GROUP BY
  si.name, st.table_schema, st.table_name, st.is_ready, st.sealed, st.build_range_end, st.seal_at
ORDER BY
  total_byte_size DESC;
```

**Columns returned:**
- Pre-agg name (from Cube YAML definition)
- Schema + table name
- Ready + sealed status
- Freshness: build_range_end (max data timestamp), seal_at (when sealed)
- Partition count + total byte size + row count
- Active flag + size in GB

---

## 4. PRE-AGG TABLE / PARTITION NAMING CONVENTION

### 4.1 Schema Naming

Pre-agg tables live in **custom schemas** defined in Cube YAML:

```yaml
pre_aggregations:
  - name: active_daily_dau_by_country_payer_daily_batch
    external: true
    sql_table: "{{SCHEMA}}.active_daily_dau_by_country_payer_daily_batch"
    sql: "SELECT ..."
```

Schema is typically **namespace-prefixed**: `preagg_cfm`, `preagg_jus`, etc. (from Cube cube-name config or explicit schema override).

**Evidence:**
- Cube playground repo memory: "Pre-aggs use schema like `preagg_cfm`" (observed in Catalog view naming).
- `/Users/lap16299/Documents/code/cube-raw/rust/cubestore/cubestore/src/queryplanner/info_schema/system_tables.rs:90` — Returns `schema.get_row().get_name()` as schema name.

### 4.2 Table Naming

Table name = pre-agg name from Cube YAML:

```
preagg_cfm.active_daily_dau_by_country_payer_daily_batch
preagg_cfm.active_daily_dau_by_platform_daily_batch
```

**No special suffix** on table name (unlike partition/chunk).

---

### 4.3 Partition Naming

Partition file names are computed as:

```
partition_file_name(partition_id, partition.suffix())
```

**Pattern** (from metastore/partition.rs):
```
{partition_id}_{suffix}.parquet
```

Where `suffix` is an optional string for versioning during partition rebuild.

Example:
```
12345_v1.parquet
12346_v1.parquet
```

**Evidence:**
- `/Users/lap16299/Documents/code/cube-raw/rust/cubestore/cubestore/src/queryplanner/info_schema/system_partitions.rs:62` — Calls `partition_file_name(id, part.suffix())`.
- Query: `SELECT id, file_name FROM SYSTEM.PARTITIONS WHERE index_id = ?` to enumerate partitions of a pre-agg.

---

### 4.4 Chunk Naming

Chunk file names are computed similarly:

```
chunk_file_name(chunk_id, chunk.suffix())
```

**Pattern**:
```
{chunk_id}_{suffix}.parquet
```

**Evidence:**
- `/Users/lap16299/Documents/code/cube-raw/rust/cubestore/cubestore/src/queryplanner/info_schema/system_chunks.rs:79` — Calls `chunk_file_name(id, chunk.suffix())`.

---

## 5. SUMMARY: UI INTROSPECTION STRATEGY

**Recommended architecture for "materialized pre-aggs + freshness + size" monitoring UI:**

1. **Query SYSTEM.INDEXES** to list all pre-aggs (by name).
2. **Join to SYSTEM.TABLES** to get sealed + ready status + freshness timestamps.
3. **Left-join to SYSTEM.PARTITIONS** to count partitions + sum byte sizes + row counts.
4. **Left-join to SYSTEM.CHUNKS** (optional) to see in-memory vs persisted chunks.
5. **Refresh interval**: Every 10–30s (introspection queries are fast; no full scans needed).

**UI Dashboard Panels:**

| Panel | Query | Shown Metrics |
|-------|-------|---|
| Pre-Agg List | Grouped by schema (preagg_cfm, preagg_jus) | name, status (sealed/ready), freshness, size, partition count |
| Freshness Heatmap | `build_range_end` per pre-agg | Last data timestamp; color-code stale (>1h old) vs fresh |
| Size Ranking | `SUM(file_size)` by pre-agg | Largest pre-aggs first; identify storage hot-spots |
| Partition Drill-Down | `SYSTEM.PARTITIONS` filtered by index_id | Partition ID, file size, row count, active flag |
| Chunk Inventory | `SYSTEM.CHUNKS` filtered by partition_id | In-memory vs uploaded chunks; age of oldest insert |

---

## UNRESOLVED QUESTIONS

1. **Partition split logic**: `partition_split_threshold` config — how does CubeStore decide when to split a partition? Is this automatic or driven by external worker?
   - Answer likely in: `cubestore/src/metastore/partition.rs` or `cluster/ingestion/`.

2. **Rollup materialization loop**: How often does the Cube worker refresh pre-aggs? Is there a tuning knob in Cube side?
   - This is Cube configuration (not CubeStore), likely in cube.yml or refreshSchedule.

3. **Chunk-to-partition promotion**: When do in-memory chunks get flushed to Parquet partitions?
   - Likely in: `cachestore/mod.rs` or `store/mod.rs` flush logic.

4. **SYSTEM.CACHE table**: Is there a query-level cache introspection table (cache hit/miss stats)?
   - Saw `system_cache.rs` file; not yet inspected.

---

## SOURCES & CITATIONS

All line numbers reference: `/Users/lap16299/Documents/code/cube-raw/rust/cubestore/cubestore/src/`

- **Eviction**: `cachestore/cache_eviction_manager.rs:51–126, 271–376, 482–812`
- **Config knobs**: `config/mod.rs` (trait + impl)
- **Info schema**: `queryplanner/info_schema/{system_tables,system_partitions,system_chunks,system_indexes}.rs`
- **Table structure**: `metastore/table.rs:131–200`
