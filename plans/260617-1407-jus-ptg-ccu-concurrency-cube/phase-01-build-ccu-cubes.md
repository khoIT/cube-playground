# Phase 01 — Build the `ccu` cubes (jus_vn + ptg)

**Priority:** P1 · **Status:** not started

## Files to create
- `cube-dev/cube/model/cubes/jus/ccu.yml`
- `cube-dev/cube/model/cubes/ptg/ccu.yml`

## jus/ccu.yml — design
Subquery collapses the 2-row split, then sums across servers per timestamp.

```yaml
cubes:
  - name: ccu
    sql: >
      SELECT online_time, log_date, SUM(server_online) AS concurrent
      FROM (
        SELECT online_time, log_date, server,
               MAX(online) AS server_online
        FROM jus_vn.etl_ingame_ccu          # bare schema-qualified per driverFactory
        GROUP BY online_time, log_date, server
      ) collapsed
      GROUP BY online_time, log_date
    title: JUS VN — Concurrent Users (CCU samples, system-wide per timestamp)
    description: >
      One row per ~30s sample = total players online across all 14 servers at
      that instant. Source etl_ingame_ccu emits 2 null-complementary rows per
      (online_time, server): online = vng+cloud+other (verified). MAX collapses
      them, SUM aggregates across servers. Query with granularity:hour for
      hourly peak/avg/low. CCU != DAU (a player online all day is in every
      sample).
    dimensions:
      - name: online_time
        sql: online_time
        type: time
        primary_key: true        # sample timestamp is unique post-aggregation
      - name: log_date
        sql: log_date
        type: time
    measures:
      - name: peak            # -> pcu
        sql: concurrent
        type: max
      - name: low             # -> lcu
        sql: concurrent
        type: min
      - name: avg             # -> acu (and proposed -> ccu)
        sql: concurrent
        type: avg
      - name: sample_count
        sql: concurrent
        type: count
```

NOTE on exact `sql_table` vs `sql`: confirm whether to use `sql_table:
etl_ingame_ccu` + Cube-side aggregation is impossible (two-level agg needs the
subquery), so a `sql:` cube is required here. Use bare table name
`etl_ingame_ccu` (the driver injects schema) — do NOT hardcode `jus_vn.`;
fix the snippet above to bare `etl_ingame_ccu` when authoring.

## ptg/ccu.yml — design (simpler, no split)
```yaml
cubes:
  - name: ccu
    sql: >
      SELECT logdatetime_timezone_utc_7 AS online_time, log_date,
             SUM(numberuseronline) AS concurrent
      FROM etl_ingame_ccu
      GROUP BY logdatetime_timezone_utc_7, log_date
    # dims/measures identical shape to jus (online_time, log_date; peak/low/avg/sample_count)
```
ptg time col is already GMT+7. jus `online_time` is tz-aware UTC — Cube handles
tz; keep as-is, document the difference.

## Steps
1. Author both YAMLs (bare table names).
2. `docker restart cube-playground-cube-api-dev`; poll `/meta` warm.
3. Verify real queries (server cube proxy, `x-cube-game: jus_vn` / `ptg`):
   - peak/avg/low for last 7d at granularity day — sanity vs raw probe
     (jus peak/server ~8k × 14 ≈ system peak tens-of-thousands; ptg ~146k×2).
4. Cross-check: `avg` should sit between `low` and `peak`; `peak` ≈ raw
   `max(sum-across-servers-per-timestamp)`.

## Success criteria
- `/meta` for jus_vn + ptg lists `ccu.peak/low/avg`.
- Real query returns plausible non-zero, internally consistent values.

## Risks
- jus tz-aware `online_time` grouping cost over big ranges — always bound by
  log_date in verification queries.
- If `sql:` subquery cube can't pre-agg cheaply at query time, consider a thin
  rollup later (out of scope; tables are small).
