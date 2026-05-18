---
phase: 6
title: "Ordered funnel cube template and auto-detect"
status: pending
priority: P2
effort: "4h"
dependencies: [4]
---

# Phase 6: Ordered funnel cube template and auto-detect

## Context Links
- Phase 4 fidelity gap: "v1 measures unique users having ALL chosen events; true ordered sequence requires SQL mode"
- Cube official funnel recipe: https://cube.dev/docs/product/data-modeling/recipes/funnels
- Cube `Funnels.eventFunnel()` package — steps **hardcoded per cube** (not parametric), so we don't reuse it directly
- Cube FILTER_PARAMS for query-time SQL templating: https://cube.dev/docs/product/data-modeling/reference/cube#filter-params
- SQL window-function recipe: https://cube.dev/blog/sql-queries-for-funnel-analysis

## Overview

Closes the ordered-sequence fidelity gap from phase 4 without forcing every funnel definition into a separate YAML cube. Ships **one template cube** (`ordered_event_funnel`) per warehouse that uses window functions + `FILTER_PARAMS` to make funnel steps query-time-parametric. UI auto-detects the cube and switches funnel-mode.tsx to a **single-query ordered path**; falls back to phase 4's multi-query "all events" path if absent. No regression for users who don't adopt the template.

## Key Insights

- Cube's official `Funnels.eventFunnel({steps:[...]})` package enforces ordering but steps live in YAML → one cube per funnel definition. Combinatorial explosion. Not what we want.
- `FILTER_PARAMS` is Cube's mechanism for injecting filter values into the raw SQL at compile time. Perfect for making step names parametric.
- Single SQL query with `MIN(CASE WHEN event = step_k AND ts > step_(k-1)_ts THEN ts END)` per step gives ordered semantics in one round-trip — beats v1 multi-query on both fidelity and performance.
- Warehouse dialect matters: PostgreSQL, BigQuery, Snowflake, ClickHouse each have slight syntax differences for array/window operations. We ship Postgres as the canonical template + a "dialect notes" appendix. Out of scope to ship adapters for all dialects in v1.
- The template **must be deployed by the user to their Cube backend** (this repo is the playground frontend; the backend is `ballistar_cube_api`). Phase 6 ships docs + UI auto-detect; backend deployment is a one-time manual step.
- Auto-detect must be silent — if cube missing, funnel-mode.tsx behaves identically to phase 4.

## Requirements

**Functional**
- New doc page `docs/ordered-funnel-cube-template.md` containing:
  - 1-paragraph rationale ("why ordered semantics matter").
  - Canonical Postgres YAML cube definition (`ordered_event_funnel.yml`), copy-pasteable.
  - Setup checklist: (1) copy YAML to backend `model/cubes/`, (2) replace `<events_table>` + `<user_id_col>` + `<event_col>` + `<ts_col>` placeholders, (3) restart Cube backend, (4) refresh playground.
  - Verification step: "Run any funnel in the Analysis tab; header should now read 'Ordered (single query)' instead of 'All-events (multi-query)'".
  - Dialect notes appendix: 3-line snippets for BigQuery + Snowflake + ClickHouse showing the diff vs Postgres template.
- `funnel-mode.tsx` auto-detects template cube presence by scanning `meta.cubes` for a cube exposing `step_count` measure + `step_index` dimension + supports `step_name` filter.
- If detected:
  - Switch to **single-query path**: build one `cubeApi.load({ measures: ['ordered_event_funnel.step_count'], dimensions: ['ordered_event_funnel.step_index'], filters: [{member: 'ordered_event_funnel.step_name', operator: 'equals', values: steps}, ...pillBarFilters] })`.
  - Header badge changes: `Ordered · single query`.
- If not detected:
  - Fall back to phase 4 multi-query path unchanged.
  - Header badge: `All-events · multi-query`.
  - Small inline link beside badge: "Enable ordered funnels" → opens drawer with link to `docs/ordered-funnel-cube-template.md` + 3-line summary.
- Detection is **memoised** on `meta` reference (avoid re-scan per render).

**Non-functional**
- Zero regression for users without the template.
- Detection is a pure function in `analysis/detect-ordered-funnel.ts` (≤ 50 LOC) — unit-testable.
- Doc page within `docs.maxLoc=800` cap.

## Architecture

```
Phase 4 funnel-mode.tsx
└── (extended)
    ├── const orderedCube = useMemo(() => detectOrderedFunnelCube(meta), [meta])
    ├── if (orderedCube) → useOrderedFunnelQuery(orderedCube, steps, filters)
    │                       → single cubeApi.load → 1 result row per step
    └── else             → useFunnelQueries(...) [phase 4 multi-query path]

NEW: analysis/detect-ordered-funnel.ts
  └── detectOrderedFunnelCube(meta) → cubeMeta | null
      └── scans for {measures: [{name: '*.step_count'}], dimensions: [{name: '*.step_index'}]}

NEW: analysis/use-ordered-funnel-query.ts (~80 LOC)
  └── (orderedCube, steps, globalFilters) → { isLoading, error, results }
      └── single cubeApi.load
      └── post-process: extract step_index → count map, compute conversion/drop-off
      └── returns same shape as use-funnel-queries.ts (drop-in replacement)

NEW: docs/ordered-funnel-cube-template.md (~200 LOC)
  └── rationale + Postgres YAML + setup checklist + dialect notes
```

## Canonical Template (sketch — final SQL goes in docs)

```yaml
# ordered_event_funnel.yml (Postgres)
cubes:
  - name: ordered_event_funnel
    sql: |
      WITH filtered AS (
        SELECT
          {user_id_col} AS user_id,
          {event_col}   AS event_name,
          {ts_col}      AS ts
        FROM {events_table}
        WHERE {event_col} IN ({FILTER_PARAMS.ordered_event_funnel.step_name.filter(v => v)})
      ),
      ranked AS (
        SELECT user_id, event_name, ts,
          ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY ts) AS rn
        FROM filtered
      ),
      sequence AS (
        SELECT user_id, array_agg(event_name ORDER BY ts) AS seq
        FROM ranked
        GROUP BY user_id
      )
      -- Pivot the sequence into step_index rows; one row per (user, step_index)
      -- where the user has reached that step in correct order.
      SELECT user_id, step_index
      FROM sequence,
           LATERAL generate_subscripts(seq, 1) AS step_index
      WHERE seq[step_index] = (
        ARRAY[{FILTER_PARAMS.ordered_event_funnel.step_name.filter(v => v)}]::text[]
      )[step_index]

    dimensions:
      - name: step_index
        sql: step_index
        type: number

      - name: step_name
        sql: '' # FILTER_PARAMS-only dimension; never returned, only used in filters
        type: string
        filter_only: true

    measures:
      - name: step_count
        type: count_distinct
        sql: user_id
```

**Note:** the actual SQL above is sketched for review; the doc page must contain a validated runnable version. Phase 6 implementation step 1 is to **prove the template against a sample Postgres dataset** before checking the doc in.

## Related Code Files

**Modify**
- `src/QueryBuilderV2/analysis/funnel-mode.tsx` — add detection branch + dual-path render.
- `src/QueryBuilderV2/analysis/use-funnel-queries.ts` — ensure return shape matches the new ordered hook so callers don't branch on data shape.

**Create**
- `src/QueryBuilderV2/analysis/detect-ordered-funnel.ts` (~50 LOC)
- `src/QueryBuilderV2/analysis/use-ordered-funnel-query.ts` (~80 LOC)
- `docs/ordered-funnel-cube-template.md` (~200 LOC, < `docs.maxLoc=800` cap)

**Read for context (do NOT modify)**
- `src/QueryBuilderV2/hooks/query-builder.ts` (cubeApi.load signature)
- Phase 4 funnel files

## Implementation Steps

1. **Validate the YAML template against a real Postgres dataset** in `ballistar_cube_api` dev environment. Iterate until single query returns correct ordered-funnel results. Lock the final SQL.
2. Write `docs/ordered-funnel-cube-template.md` with the validated template + setup checklist + dialect notes (BigQuery, Snowflake, ClickHouse — 3-line diff each, not full templates).
3. Build `detect-ordered-funnel.ts` pure detector:
   - Iterate `meta.cubes`. Return first cube whose `measures` contains `*.step_count` AND `dimensions` contains `*.step_index` AND `*.step_name` (filter-only dim).
   - Return `null` if none match.
4. Build `use-ordered-funnel-query.ts`:
   - Wraps `cubeApi.load` once.
   - Post-processes result rows into the same `{step, label, count, conversionPct, dropOffPct}[]` shape phase 4 returns.
5. Wire into `funnel-mode.tsx`:
   - `const orderedCube = useMemo(() => detectOrderedFunnelCube(meta), [meta]);`
   - `const data = orderedCube ? useOrderedFunnelQuery(orderedCube, steps, filters) : useFunnelQueries(...);`
   - Render header badge `Ordered · single query` or `All-events · multi-query` accordingly.
   - Add "Enable ordered funnels →" link when fallback path active.
6. Manual smoke matrix:
   - Template deployed → ordered funnel runs in single query, drop-off matches expected.
   - Template absent → falls back to multi-query, header reads "All-events".
   - Toggle template (restart cube backend) → playground refresh picks up new mode without code change.
7. `npx vite build`.

## Todo List

- [ ] Validate SQL template against real Postgres dev cube
- [ ] Write `docs/ordered-funnel-cube-template.md` with checklist + dialect notes
- [ ] Build `detect-ordered-funnel.ts` (pure)
- [ ] Build `use-ordered-funnel-query.ts`
- [ ] Wire dual-path in `funnel-mode.tsx`
- [ ] Header badge + "Enable ordered funnels" link
- [ ] Smoke matrix (template present / absent / toggled)
- [ ] `npx vite build` passes

## Success Criteria

- [ ] When user deploys the template cube, funnel-mode.tsx switches to single-query ordered semantics with no code change.
- [ ] When template absent, funnel-mode.tsx behaves identically to phase 4.
- [ ] Header badge correctly identifies which mode is active.
- [ ] Doc page contains a validated, runnable Postgres template.
- [ ] No console errors in either branch.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `FILTER_PARAMS` syntax differs across Cube versions | Medium | High | Pin Cube version in setup checklist; test against the version pinned in `ballistar_cube_api` |
| Postgres-only SQL fails on the user's actual warehouse | High | Medium | Dialect notes appendix + explicit "we ship Postgres canonical, port for your DB" disclaimer |
| `array_agg(... ORDER BY ts)` performance at scale | Medium | Medium | Doc page recommends adding a pre-agg over `ordered_event_funnel` for warehouses > 10M events |
| Detection false-positive (some other cube exposes `step_count`/`step_index`) | Low | Medium | Require ALL THREE (`step_count` + `step_index` + `step_name` filter-only) to match — collision unlikely |
| User deploys template but cube schema gets out of date (events table renamed) | Medium | Low | Template documents the placeholders; user updates when schema changes |
| Auto-detect re-runs on every render → perf | Low | Low | `useMemo` on `meta` reference |

## Security Considerations

- `FILTER_PARAMS` interpolates user-supplied step values into raw SQL. **Cube escapes these** via its filter mechanism (verified in [FILTER_PARAMS docs](https://cube.dev/docs/product/data-modeling/reference/cube#filter-params)). Doc page must explicitly say "do NOT bypass FILTER_PARAMS with string concatenation" to prevent the user from breaking the escaping when adapting the template.

## Migration / Backwards Compatibility

- Phase 4 multi-query path is preserved. Users without the template see no behavioural change.
- If a user removes the template later, UI silently reverts to multi-query — no error state.

## Next Steps (Post-merge / Deferred to true v2)

- BigQuery / Snowflake / ClickHouse first-class template files (not just dialect notes).
- "Generate template SQL for my warehouse" wizard inside the playground (would require a small SQL-builder UI).
- Pre-aggregation recipe for the ordered funnel cube at scale.
- Strict / Any ordering modes (today: Sequential only).

## Unresolved Questions

- Should the playground itself host the template YAML file (e.g. `templates/cubes/ordered_event_funnel.yml`) for direct copy, or keep it inside the markdown doc only? Lean: keep in doc to avoid implying we deploy backend artifacts.
- Should we ship a one-click "Copy template to clipboard" button on the docs page, or in the playground UI itself when the fallback badge is active? Lean: playground UI button (lower friction).
- What's the minimum Cube backend version needed for the `FILTER_PARAMS` syntax we use? Verify before publishing template.
