# Ordered Funnel Cube Template

Opt-in upgrade for the playground's Funnel analysis: single-query ordered semantics instead of the default multi-query "all-events" path. Deploy one YAML cube to your Cube backend, restart, and the playground silently switches.

> **Status:** the SQL template below is sketched from the official Cube `FILTER_PARAMS` pattern. **It MUST be validated against your warehouse before production use.** The frontend auto-detect ships unchanged regardless; the cube definition is the user's responsibility.

## Why

The default playground Funnel runs N parallel queries — one per step — and counts users that match each step's filter independently. This measures "unique users having all chosen events" but does not enforce **order** (a user who did step 2 before step 1 is still counted at both). This template builds an ordered-funnel cube that uses window functions + `FILTER_PARAMS` to make funnel steps **query-time parametric** in a single SQL round-trip. Drop-off is correct, and there is no combinatorial cube explosion for each funnel definition.

## Detection contract

The playground auto-activates the single-query path when `meta.cubes` contains any cube exposing **all three** of:

- a measure named `step_count` (or `<cube>.step_count`)
- a dimension named `step_index`
- a filter-only dimension named `step_name`

If any are missing, the multi-query fallback runs — zero regression.

## Setup checklist (Postgres)

1. Copy the YAML below into your Cube backend `model/cubes/ordered_event_funnel.yml`.
2. Replace the four placeholders:
   - `<events_table>` — the warehouse table holding raw events.
   - `<user_id_col>` — column identifying the user (e.g. `user_id`, `account_id`).
   - `<event_col>` — column containing the event name/type.
   - `<ts_col>` — column with the event timestamp (must be sortable).
3. Restart the Cube backend so it picks up the new cube.
4. Refresh the playground. Open **Analysis → Funnel**. The header badge should now read **Ordered · single query**.

## Canonical template (Postgres)

```yaml
cubes:
  - name: ordered_event_funnel
    sql: |
      WITH filtered AS (
        SELECT
          <user_id_col> AS user_id,
          <event_col>   AS event_name,
          <ts_col>      AS ts
        FROM <events_table>
        WHERE {FILTER_PARAMS.ordered_event_funnel.step_name.filter('<event_col>')}
          -- Push the UI's date range into the scan. Apply it BOTH to the event
          -- timestamp and to the table's partition column (log_date or similar)
          -- so the warehouse prunes partitions instead of full-scanning history.
          AND {FILTER_PARAMS.ordered_event_funnel.ts.filter('<ts_col>')}
          AND {FILTER_PARAMS.ordered_event_funnel.ts.filter('<partition_col>')}
      ),
      ranked AS (
        SELECT
          user_id,
          event_name,
          ts,
          ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY ts) AS rn
        FROM filtered
      ),
      sequence AS (
        SELECT
          user_id,
          array_agg(event_name ORDER BY ts) AS seq
        FROM ranked
        GROUP BY user_id
      ),
      reached AS (
        SELECT
          user_id,
          step_index
        FROM sequence,
             LATERAL generate_subscripts(seq, 1) AS step_index
        WHERE seq[step_index] IS NOT NULL
      )
      SELECT user_id, step_index FROM reached

    dimensions:
      - name: step_index
        sql: step_index
        type: number

      - name: step_name
        sql: ''
        type: string

      # REQUIRED by the frontend dispatcher (run-funnel.ts queries
      # `<cube>.ts` as a timeDimension) and by the chat agent. Must resolve
      # to TIMESTAMP, not DATE. Queries without a ts dateRange should be
      # rejected by a query-rewrite guard — an unbounded ordered-funnel scan
      # reads every event partition.
      - name: ts
        sql: ts
        type: time

    measures:
      - name: step_count
        type: count_distinct
        sql: user_id
```

### How the SQL works

1. `filtered` keeps only rows whose `event_name` matches one of the step values you passed in the UI. `FILTER_PARAMS` interpolates the equals filter Cube produces from the UI's `step_name` filter; **never** bypass `FILTER_PARAMS` with string concatenation — Cube escapes the values for you.
2. `ranked` and `sequence` collapse each user's filtered events into an ordered array.
3. `reached` pivots the array back into one row per `(user, step_index)` — `step_index` is 1-based and increases monotonically.
4. `step_count` is `COUNT(DISTINCT user_id)` per `step_index`, giving the funnel histogram in one round trip.

The UI orders the funnel by `step_index ASC` and maps each step back to the label using its position.

## Dialect notes

Only the canonical Postgres template is shipped. Other warehouses need small adjustments:

- **BigQuery:** replace `array_agg(event_name ORDER BY ts)` with `ARRAY_AGG(event_name ORDER BY ts)` and `LATERAL generate_subscripts(seq, 1)` with `UNNEST(seq) WITH OFFSET step_index` (add `+ 1` so `step_index` is 1-based).
- **Snowflake:** use `ARRAY_AGG(event_name) WITHIN GROUP (ORDER BY ts)` and `LATERAL FLATTEN(input => seq) f` (`step_index = f.INDEX + 1`).
- **ClickHouse:** use `groupArray(event_name)` (after `ORDER BY user_id, ts`) and `arrayJoin(arrayEnumerate(seq))` for the pivot.

Each warehouse has its own array-window cost characteristics — measure and add a pre-aggregation if the events table exceeds ~10M rows.

## Pre-aggregation recipe (optional, recommended at scale)

Append the following block to the cube above once you've validated correctness:

```yaml
    pre_aggregations:
      - name: ordered_funnel_rollup
        type: rollup
        measures: [ordered_event_funnel.step_count]
        dimensions: [ordered_event_funnel.step_index, ordered_event_funnel.step_name]
        refresh_key:
          every: '1 hour'
```

The `step_name` dimension must be included so `FILTER_PARAMS` can route through the rollup.

## Verification

1. Run any funnel in the playground's **Analysis → Funnel** tab.
2. Check the header badge: it must read **Ordered · single query** when the cube is detected, **All-events · multi-query** otherwise.
3. Compare drop-off numbers against a multi-query funnel with the same steps. Single-query should be ≤ multi-query at every step beyond step 1 (because order is now enforced).
4. Remove the cube and restart Cube backend — playground should silently revert to multi-query.

## Security

- `FILTER_PARAMS` interpolates user-supplied step values into raw SQL via Cube's escape mechanism. Do **not** bypass `FILTER_PARAMS` with string concatenation.
- Cube version: tested against `FILTER_PARAMS` syntax current as of mid-2025. Verify against your pinned backend version before deploying.

## Migration

- Multi-query path is preserved unchanged when the template cube is absent.
- Deploying or removing the cube requires only a backend restart + playground refresh — no playground code changes.
