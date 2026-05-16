# Cube vs. CDP Metrics — Architecture Analysis

Date: 2026-05-16
Source repo for cube model: `C:\Users\CPU12830-local\code\cube-dev\cube\model`
Source for CDP API spec: `MM-01-CRUD.openapi.yaml` (metrics_mgm v1.0.0)

This document captures three questions worked through in one session:

1. What joins and aggregates does the current Cube model require?
2. If we reimplement the engine, how does the Cube-API path compare to building
   our own CDP-API path end-to-end?
3. How do we keep Cube as the runtime engine but persist every metric created
   via Cube into the CDP catalog (`metrics_mgm`)?

---

## 1. Cube model inventory

### 1.1 Cubes and source tables

| Cube | Source table | Grain |
|------|--------------|-------|
| `mf_users` | `ballistar_vn.mf_users` | 1 row / user (hub) |
| `active_daily` | `ballistar_vn.std_ingame_user_active_daily` | 1 row / user / active day |
| `user_recharge_daily` | `ballistar_vn.std_ingame_user_recharge_daily` | 1 row / user / recharge day |
| `recharge` | `ballistar_vn.etl_ingame_recharge` | 1 row / transaction |

### 1.2 Join topology

All declared joins are **single-column equi-joins** in a **hub-and-spoke**
pattern centred on `mf_users`. No multi-key joins, multi-hop joins, or
self-joins are declared.

| From → To | Relationship | Condition |
|-----------|--------------|-----------|
| `active_daily` → `mf_users` | `many_to_one` | `CUBE.user_id = mf_users.user_id` |
| `user_recharge_daily` → `mf_users` | `many_to_one` | `CUBE.user_id = mf_users.user_id` |
| `recharge` → `mf_users` | `many_to_one` | `CUBE.account_id = mf_users.user_id` (key rename) |
| `mf_users` → `active_daily` | `one_to_many` | mirror |
| `mf_users` → `user_recharge_daily` | `one_to_many` | mirror |
| `mf_users` → `recharge` | `one_to_many` | mirror |

All views in `model/views/user_360.yml` declare a single `join_path` cube. No
view spans more than one cube today, so cross-cube joins are declared but not
actively exercised by views.

### 1.3 Measure / aggregate types

| Type | Count | SQL it must emit |
|------|-------|------------------|
| `count` | 3 | `COUNT(*)` |
| `count_distinct` | 5 | `COUNT(DISTINCT col)` |
| `count_distinct_approx` | 7 | Trino `approx_distinct(col)` |
| `sum` | 6 | `SUM(col)` |
| `number` (calculated) | 6 | expression over other measures, e.g. `{ltv_total_vnd} * 1.0 / NULLIF({user_count}, 0)` |
| filtered variant (`filters:`) | 6 | `<agg>(...) FILTER (WHERE ...)` or `SUM(CASE WHEN ... THEN col END)` |

### 1.4 Dimension patterns

| Pattern | Examples | SQL shape |
|---------|----------|-----------|
| Plain column rename | `user_id`, `country → unified_first_country_code` | passthrough |
| Cast expression | `CAST({CUBE}.log_date AS TIMESTAMP)` | `CAST` |
| Boolean CASE | `is_paying_user`, `is_recharge_day` | inline `CASE WHEN` |
| Multi-arm `case:` block | `payer_tier`, `lifecycle_stage`, `txn_value_band_vnd` | compiled `CASE WHEN ... ELSE ... END` |
| Date arithmetic | `DATE_DIFF('day', col, CURRENT_DATE)` | passthrough |
| Composite primary key | `CONCAT(user_id, '__', CAST(log_date AS VARCHAR))` | `primary_key: true`, `public: false` |
| Time dimension | every cube has a `type: time` field | drives `DATE_TRUNC(<granularity>, …)` and BETWEEN filters |

### 1.5 Segments

~17 named segments across the four cubes — each is a raw boolean SQL fragment
appended to `WHERE`. Examples:

- Rolling-window date filters: `last_7d`, `last_30d`, `yesterday`
- Value thresholds: `whales`, `high_level_players`
- Composite (AND-of-clauses): `at_risk_paying`

### 1.6 Template / placeholder substitution

- `{CUBE}` → current cube's table alias.
- `{<cube_name>}` → other cube's alias (only in join `sql`).
- `{<measure_name>}` → another measure's resolved SQL (only in calculated
  `type: number` measures: `arpu_vnd`, `arppu_vnd`, `paying_rate`, `arpt_vnd`).

### 1.7 Caching / pre-aggregations

- `refresh_key.every` per cube (5 min / 30 min / 1 h) — result-cache TTL only,
  no SQL impact.
- `pre_aggregations` block exists but is **commented out** in `mf_users.yml`.
  Documented shape: `type: rollup` with `measures`, `dimensions`,
  `time_dimension`, `granularity`, `partition_granularity`, `refresh_key`,
  `build_range_start/end`. Reimplementation can defer this.

### 1.8 Minimum surface a reimplementation must support

1. **Single-cube queries** (covers 100% of current views): dim+measure select
   list, optional segments + time-range filter, `GROUP BY` non-aggregate dims,
   `ORDER BY`, `LIMIT`.
2. **Two-cube queries via the hub** (declared but unused by views today): emit
   `FROM <fact> JOIN mf_users ON <equi-join>` using declared relationship.
3. **Aggregate compilation**: the 5 types above, filtered variants,
   measure-reference resolution (outer SELECT wrapping the inner aggregate).
4. **Dimension compilation**: passthrough, inline expressions, plus the
   structured `case:` block (the only non-raw-SQL construct on dimensions).
5. **Time-dimension granularity** rewriting (`day` / `month`) into
   `DATE_TRUNC`, plus BETWEEN for date ranges.
6. **Trino dialect**: `approx_distinct`, `DATE_TRUNC`, `DATE_DIFF`,
   `CURRENT_DATE/CURRENT_TIMESTAMP`, `INTERVAL`, `CAST`, `NULLIF`.

Not used and therefore not required v1: many-to-many, transitive joins,
parameterized queries, RLS predicates, dynamic `sql:` cubes
(everything uses `sql_table:`).

---

## 2. Cube API vs. own CDP API — architecture comparison

### 2.1 Flow A — Cube API as the metrics layer (the POC today)

```
  Data Analyst ──git push──▶  cube/model/*.yml
                                    │
                                    ▼
                          ┌─────────────────────────┐
                          │ CUBE SERVER (managed)   │
                          │  YAML parser            │
                          │  Schema registry        │
                          │  Query compiler         │
                          │  Result cache           │
                          │  Pre-aggregations       │
                          └────────┬────────────────┘
                                   │ Trino SQL
                                   ▼
                          ┌─────────────────────────┐
                          │ Trino / Lakehouse       │
                          │ ballistar_vn.*          │
                          └────────┬────────────────┘
                                   │ JSON / SQL-API
                                   ▼
                          ┌─────────────────────────┐
                          │ Segment Query Tool      │
                          │ (calls Cube REST/SQL)   │
                          └─────────────────────────┘
```

- **Cube owns:** YAML schema, query compilation, join planning, calculated
  measures, segments, time granularity, result cache, rollups.
- **We own:** the YAML in `cube/model/`.
- **Coupling risk:** anything Cube cannot express becomes a hard wall. The
  query API shape (REST `/load`, SQL API) is Cube's; the segment tool speaks
  Cube's dialect, not ours.

### 2.2 Flow B — Own CDP metrics_mgm API (rebuild)

```
  Data Analyst / Web UI ─POST/PUT─▶ metrics_mgm (MM-01-CRUD)
                                       │
                                       ▼
                              ┌─────────────────────┐
                              │ Metric Registry     │
                              │ (Postgres)          │
                              │ PK=(game_id, name)  │
                              └──┬───────────────┬──┘
                  reads defs     │               │ if materialize=true
                                 ▼               ▼
              ┌─────────────────────────┐ ┌───────────────────────────┐
              │ ★ Segment / Query Engine│ │ Materialization Workflow  │
              │   (NEW, to build)       │ │ (Airflow / cron)          │
              │  compose SQL:           │ │ write to user_stage table │
              │   SELECT <expression>   │ └────────┬──────────────────┘
              │   FROM   <source>       │          │
              │   WHERE  <filter>       │          ▼
              │   GROUP BY <dimensions> │   user_stage.* (Iceberg)
              └──────────┬──────────────┘          │
                         │  Trino SQL              │
                         ▼                         │
                 ┌────────────────┐ ◀──────────────┘
                 │ Trino/Lakehouse│
                 └───────┬────────┘
                         ▼
                 ┌────────────────────┐
                 │ Segment Query Tool │ (calls OUR API, our shape)
                 └────────────────────┘
```

- **We own:** metric CRUD, schema, query compiler, materialization scheduler,
  cache, API contract with the segment tool.
- **We lose vs. Cube until we build:** joins between metrics, calculated
  metrics referencing other metrics, named segments, time-dimension
  granularity rewriting, pre-aggregation planner.
- **We gain:** full control over request/response, no vendor coupling on the
  segment-tool side.

### 2.3 Gap analysis — MM-01 vs. Cube model

MM-01 today is **strictly less powerful** than the four cubes' model:

- one metric = one expression over one source — no joins.
- no metric-to-metric references — no equivalent to Cube's calculated
  measures.
- no named segments.
- no dimension types or time granularities.

Matching today's Cube capability with a CDP-native path requires extending
MM-01 with `joins[]`, `segments[]`, and a `derived_from` shape, plus a
compiler that turns those into SQL.

### 2.4 Decision framing

The decision is about **how much surface area we want to own**.

- Flow A: one box (Cube) does parsing + compilation + caching + serving. Our
  control surface is the YAML.
- Flow B (as MM-01 stands): a smaller engine that doesn't yet match what the
  cubes already express; we'd have to build the missing pieces before the
  segment tool can match feature parity.

---

## 3. Hybrid — keep Cube as the engine, sync metrics into CDP

### 3.1 Intercept point

Cube's source of truth is YAML; whatever the UI surface (Cube Cloud Data
Model editor, local edits, CLI), the mutation lands as a YAML change. Sync at
the YAML layer, not the UI layer.

| # | Intercept | Trigger | Pros / Cons |
|---|-----------|---------|-------------|
| 1 | **Git webhook** on Cube's model repo | `push` | Deterministic, replayable, signed. Requires Cube to read schema from git. |
| 2 | **`/cubejs-system/v1/meta`** polling | cron | No Cube Cloud dependency; reads already-parsed schema (no YAML parser to maintain). Slight lag. |
| 3 | **File watcher sidecar** in Cube container | inotify | Works for self-host; brittle on Cube Cloud. |

**Recommendation:** combine **#1** (push-time, source-of-truth) with **#2**
(hourly drift detector). The webhook keeps CDP fresh; the poll catches what
the webhook misses.

### 3.2 Hybrid topology

```
   Data Analyst ─Cube UI/IDE─▶  cube/model/*.yml  (git repo, source of truth)
                                       │
                                       │ git push
                                       ▼
                              ┌───────────────────┐
                              │ GitHub / GitLab   │
                              │ push webhook ●────┼────┐
                              └───────┬───────────┘    │ webhook
                                      │ pull            ▼
                                      ▼          ┌────────────────────────────┐
                              ┌──────────────┐   │ ★ metric-sync worker ★     │
                              │ CUBE SERVER  │   │ (NEW, small service)       │
                              │ /meta + /load│◀──│  diff changed *.yml        │
                              └──────┬───────┘poll│  parse cubes + measures   │
                                     │  /meta    │  map → CDP metric shape    │
                                     │           │  upsert POST/PUT /cdp/v1/  │
                                     │           │  DELETE removed metrics    │
                                     │           └────────────┬───────────────┘
                                     │                        │
                                     │                        ▼
                                     │           ┌────────────────────────────┐
                                     │           │ metrics_mgm  (MM-01)       │
                                     │           │ Postgres registry          │
                                     │           │ PK=(game_id, metric_name)  │
                                     │           │ + provenance columns       │
                                     │           └────────────┬───────────────┘
                                     │                        │
                                     │                        ▼
                                     │            catalog / discovery / lineage
                                     │
                                     │ runtime queries (unchanged)
                                     ▼
                              ┌────────────────────┐
                              │ Segment Query Tool │── calls Cube REST/SQL API
                              └────────┬───────────┘
                                       ▼
                                ┌──────────────────┐
                                │ Trino / Lakehouse│
                                └──────────────────┘
```

- **Cube owns:** parsing, compilation, joins, calculated measures, caching,
  serving runtime queries.
- **CDP owns:** the canonical *catalog* of every metric — discoverable,
  governable, queryable by name from non-Cube tools, with git-sha provenance
  back to the YAML it came from.
- **Coupling:** one-way (Cube → CDP). Cube evolves freely; CDP gets enriched,
  never blocking.

### 3.3 Cube measure → CDP metric mapping

| Cube measure | → CDP `expression` | → CDP `filter` | Notes |
|---|---|---|---|
| `type: count` | `COUNT(*)` | `""` | trivial |
| `type: sum, sql: x` | `SUM(x)` | `""` | trivial |
| `type: count_distinct, sql: x` | `COUNT(DISTINCT x)` | `""` | trivial |
| `type: count_distinct_approx, sql: x` | `approx_distinct(x)` | `""` | Trino dialect |
| `type: <agg>, filters: [{sql: P}]` | `<agg>` over col | `P` (AND multiple) | combine filters with `AND` |
| `type: number, sql: "{a}/{b}"` (calculated) | leave `{a}` / `{b}` placeholders | `""` | mark `measure_kind=derived`; do not let CDP compile it |

Schema-extension (additive, non-breaking) suggested for MM-01 so the sync is
debuggable:

- `source_yaml_path`
- `source_git_sha`
- `cube_name`
- `view_name`
- `measure_kind` — `raw | derived | segment-backed`
- `synced_at`

The CRUD API surface stays the same; these columns are populated by the sync
worker.

### 3.4 Caveats to surface to the team

1. **CDP becomes read-mostly** for synced rows. If an analyst `PUT`s a
   Cube-sourced metric, the next sync overwrites them. Either lock those rows
   (`source = cube`, reject writes) or accept overwrite — pick one and
   document it.
2. **Game-ID convention** must be settled. Cube YAML has no `game_id`. Options:
   parse from cube name (`ballistar_vn_*` → `bal_vn`), from folder
   (`model/cubes/<game_id>/*.yml`), or stamp via a `meta:` block. Folder
   convention is the only one that survives renames cleanly.
3. **Calculated measures and segments don't fit MM-01 today.** They can be
   carried in CDP for catalog purposes (`measure_kind`) but the segment tool
   still calls Cube to execute them, not CDP. Fine for a catalog; worth saying
   out loud so nobody assumes CDP can serve them later.
4. **Bidirectional later, if you want.** Once the sync worker exists, the
   reverse flow (CDP UI creates a metric → worker generates YAML → opens a PR
   against the model repo) is the same pieces in reverse. Not v1.

---

## Appendix — files referenced

- `cube/model/cubes/active_daily.yml`
- `cube/model/cubes/mf_users.yml`
- `cube/model/cubes/recharge.yml`
- `cube/model/cubes/user_recharge_daily.yml`
- `cube/model/views/user_360.yml`
- `MM-01-CRUD.openapi.yaml` (metrics_mgm v1.0.0)
