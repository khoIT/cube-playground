# Cohort Retention Cube Template

Opt-in upgrade for the Liveops cohort retention grid: single aggregated Cube query instead of the default client-side pivot from `active_daily`. Deploy one YAML cube to your Cube backend, restart, and the playground automatically switches.

> **Status:** the SQL template below is sketched from the Cube `FILTER_PARAMS` pattern and standard cohort window-function SQL. **Validate against your warehouse before production use.** The frontend auto-detect ships unchanged regardless; this definition is the data-engineer's responsibility.

## Why upgrade

The default client-side path:
- Issues a single `active_daily` query returning all `user_id + log_date` rows for the window.
- Pivots in TypeScript in the browser (O(users × days) work).
- Is **capped at 28 days** to keep payload manageable.
- May show lower-bound retention for games with > 50,000 user-day rows in the window.

The server-side path:
- Pre-aggregates cohort sizes and per-day retained counts in the warehouse.
- Returns one row per `install_date` with six pre-computed measures.
- Supports windows up to 90 days without browser-side memory pressure.
- Allows Cube pre-aggregations to bring query time under 200ms at scale.

## Detection contract

The frontend auto-activates the single-query path when `meta.cubes` contains any cube whose **name matches `/retention/i`** and which exposes **all** of:

| Contract member | Type |
|---|---|
| `cohort_size` | measure |
| `retained_d1` | measure |
| `retained_d3` | measure |
| `retained_d7` | measure |
| `retained_d14` | measure |
| `retained_d30` | measure |
| `install_date` | time dimension |

If any member is missing, the client-side compute path runs — zero regression for games that haven't deployed the cube.

Header badge changes from amber "Client-side compute (≤28d only)" to green "Server-side retention" once the cube is detected.

## Setup checklist (Postgres)

1. Copy the YAML below into your Cube backend `model/cubes/<game>/retention.yml`.
2. Replace the four placeholders:
   - `<events_table>` — warehouse table holding raw events (or your `active_daily`-equivalent).
   - `<user_id_col>` — column identifying the user (e.g. `user_id`, `account_id`).
   - `<date_col>` — column containing the event date (DATE or TIMESTAMP, truncated to day).
   - `<schema>` — database schema prefix if required (e.g. `analytics.`), otherwise leave empty.
3. Restart the Cube backend so it picks up the new cube.
4. Refresh the playground. Open **Liveops → Cohort retention**. The header badge should read **Server-side retention**.

## ⚠️ Common pitfall: `install_date` must be TIMESTAMP, not DATE

If `<date_col>` is a `DATE` (or any column whose `MIN()` yields a DATE), wrap the source aggregate with an explicit cast so `install_date` is **TIMESTAMP**. Cube emits both `<col> AT TIME ZONE 'UTC'` (for granularity) and `from_iso8601_timestamp(?)` comparisons (for `dateRange`) on every time dimension. Trino / Presto reject either operation against a DATE column with:

```
Cube /load → 400: "Type of value must be a time or timestamp with or without time zone (actual date)"
```

The fix is at the source CTE, not in the dimension `sql:` — Cube still wraps your dimension expression in `AT TIME ZONE`, so the *input* must already be TIMESTAMP:

```sql
-- ❌ install_date is DATE → Cube /load 400s on every cohort window
SELECT user_id, MIN(<date_col>) AS install_date FROM <events_table> ...

-- ✅ install_date is TIMESTAMP → Cube can apply timezone + dateRange filters
SELECT user_id, CAST(MIN(<date_col>) AS TIMESTAMP) AS install_date FROM <events_table> ...
```

If the FE stays stuck on "Detecting data path…" after deploying the cube, this is the first thing to check (`sqlite3 server/data/segments.db "SELECT error_msg FROM liveops_result_cache WHERE resource='cohort_grid'"`).

## Canonical template (Postgres / Trino)

```yaml
cubes:
  - name: retention
    sql: |
      WITH first_seen AS (
        SELECT
          <user_id_col>              AS user_id,
          -- CAST to TIMESTAMP — Cube wraps time dims with AT TIME ZONE 'UTC'
          -- and from_iso8601_timestamp() filters, both of which reject DATE.
          CAST(MIN(DATE_TRUNC('day', <date_col>)) AS TIMESTAMP) AS install_date
        FROM <schema><events_table>
        WHERE {FILTER_PARAMS.retention.install_date.filter(
                 'DATE_TRUNC(''day'', <date_col>)')}
        GROUP BY <user_id_col>
      ),
      activity AS (
        SELECT
          <user_id_col>              AS user_id,
          DATE_TRUNC('day', <date_col>) AS active_date
        FROM <schema><events_table>
        GROUP BY 1, 2
      )
      SELECT
        fs.user_id,
        fs.install_date,
        COUNT(DISTINCT fs.user_id)                                    AS cohort_size,
        COUNT(DISTINCT CASE WHEN a1.active_date  = fs.install_date + INTERVAL '1  day' THEN fs.user_id END) AS retained_d1,
        COUNT(DISTINCT CASE WHEN a3.active_date  = fs.install_date + INTERVAL '3  days' THEN fs.user_id END) AS retained_d3,
        COUNT(DISTINCT CASE WHEN a7.active_date  = fs.install_date + INTERVAL '7  days' THEN fs.user_id END) AS retained_d7,
        COUNT(DISTINCT CASE WHEN a14.active_date = fs.install_date + INTERVAL '14 days' THEN fs.user_id END) AS retained_d14,
        COUNT(DISTINCT CASE WHEN a30.active_date = fs.install_date + INTERVAL '30 days' THEN fs.user_id END) AS retained_d30
      FROM first_seen fs
      LEFT JOIN activity a1  ON a1.user_id  = fs.user_id
      LEFT JOIN activity a3  ON a3.user_id  = fs.user_id
      LEFT JOIN activity a7  ON a7.user_id  = fs.user_id
      LEFT JOIN activity a14 ON a14.user_id = fs.user_id
      LEFT JOIN activity a30 ON a30.user_id = fs.user_id
      GROUP BY fs.user_id, fs.install_date

    dimensions:
      - name: install_date
        sql: install_date
        type: time

    measures:
      - name: cohort_size
        sql: cohort_size
        type: sum

      - name: retained_d1
        sql: retained_d1
        type: sum

      - name: retained_d3
        sql: retained_d3
        type: sum

      - name: retained_d7
        sql: retained_d7
        type: sum

      - name: retained_d14
        sql: retained_d14
        type: sum

      - name: retained_d30
        sql: retained_d30
        type: sum
```

### How the SQL works

1. `first_seen` computes each user's earliest active date within the queried range using `FILTER_PARAMS` on `install_date`. This respects the cohort window the user selected in the UI.
2. `activity` de-duplicates user-day pairs so each user counts at most once per day.
3. Six `LEFT JOIN + CASE` columns produce the retained counts for each day offset. Using `LEFT JOIN` (not `EXISTS`) allows a single scan of the activity CTE.
4. `GROUP BY install_date` (after adding `install_date` to the `SELECT`) produces one row per cohort day.

**Note:** the template above groups by `user_id` and `install_date` — for large datasets, pre-aggregating at the `install_date` grain removes the `user_id` column and sums the measures. See the pre-aggregation recipe below.

## Dialect notes

- **BigQuery:** replace `DATE_TRUNC('day', col)` with `DATE_TRUNC(col, DAY)` and `INTERVAL '1 day'` with `INTERVAL 1 DAY`.
- **Snowflake:** replace `DATE_TRUNC('day', col)` with `DATE_TRUNC('DAY', col)` and `INTERVAL '1 day'` with `INTERVAL '1 DAY'`.
- **ClickHouse:** replace `DATE_TRUNC('day', col)` with `toDate(col)` and `+ INTERVAL 'N days'` with `addDays(install_date, N)`.
- **MySQL / Aurora:** replace `DATE_TRUNC` with `DATE(col)` and use `DATE_ADD(install_date, INTERVAL N DAY)`.

## Pre-aggregation recipe (recommended at scale)

```yaml
    pre_aggregations:
      - name: cohort_daily_rollup
        type: rollup
        measures:
          - retention.cohort_size
          - retention.retained_d1
          - retention.retained_d3
          - retention.retained_d7
          - retention.retained_d14
          - retention.retained_d30
        dimensions: []
        time_dimension: retention.install_date
        granularity: day
        refresh_key:
          every: '6 hours'
```

This collapses the per-user rows down to one row per install_date, dropping `user_id` from the stored table. The `cohort_size` and `retained_dN` measures are sums, so the pre-aggregation is additive and correct.

## Verification

1. Deploy the cube and restart Cube backend.
2. Open **Liveops → Cohort retention** in the playground.
3. Header badge must read **Server-side retention** (green).
4. Enable the 28-day window and compare D7 values against a manual SQL query:
   ```sql
   SELECT install_date, cohort_size, retained_d7
   FROM retention
   WHERE install_date >= CURRENT_DATE - INTERVAL '28 days'
   ORDER BY install_date;
   ```
5. Remove the cube (or rename it so it no longer matches `/retention/i`) and restart — grid should silently revert to the amber "Client-side compute" badge.

## Security

- `FILTER_PARAMS` interpolates the `install_date` range filter into the CTE. Do **not** bypass `FILTER_PARAMS` with string concatenation — Cube escapes the values for you.
- Cube's per-game JWT scoping (`repositoryFactory` with per-game model dirs) means this cube is only visible to games that have it deployed. No cross-game data leakage.

## Migration

- The client-side path is preserved unchanged when this cube is absent.
- Deploying or removing the cube requires only a backend restart + browser refresh — no frontend code changes needed.
- The 28-day cap is lifted automatically when the server-side path is detected; the window selector will offer up to 90-day windows (configurable in `use-cohort-grid.ts` → `WINDOW_OPTIONS`).
