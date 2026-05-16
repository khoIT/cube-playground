---
phase: 5
title: "Pre-aggregation enablement + catalog badge"
status: pending
priority: P2
effort: "1d"
dependencies: [4]
---

# Phase 5: Pre-aggregation enablement + catalog badge

## Context Links

- Architecture rationale: [`../reports/architecture/cube-vs-cdp-metrics-architecture.md`](../reports/architecture/cube-vs-cdp-metrics-architecture.md) §1.7 (pre_aggregations block exists commented out in `mf_users.yml`)
- Leadership scope decision: [`../reports/architecture/poc-scoping-and-leadership-decisions.md`](../reports/architecture/poc-scoping-and-leadership-decisions.md) §4.3 (caching + pre-aggregations) and §5.5 (auth/audit/pre-aggs as Phase 5 "ready when latency becomes a problem" — POC pre-empts this for demo)
- Catalog cube card: `src/pages/Catalog/CubeCard.tsx` (created in P4)
- Catalog detail panel: `src/pages/Catalog/CubeDetailPanel.tsx` (created in P4)
- Target cube model (in sibling repo): `cube-dev/cube/model/cubes/mf_users.yml`

## Overview

Two arms:

- **5a. Cube-model side** — uncomment and enable a single `pre_aggregations:` rollup in `cube-dev/cube/model/cubes/mf_users.yml`. Pick a high-visibility rollup (DAU by day) so the demo shows a real latency win.
- **5b. Playground side** — once `preAggregations` populates in `/meta`, surface a "Has rollup × N" badge on cube cards in P4's catalog, and list rollup names + granularity in the DetailPanel. Add a "Pre-aggregated" filter chip.

POC posture per leadership: enable and demonstrate. Skip sandbox-first. Acceptable risk for demo.

## Priority

P2 — demo wow-moment. Depends on P4 surface to land the badge.

## Key Insights

- `preAggregations` field MAY require `?extended=true` to populate in `/meta` (same gotcha as `joins[]`). P1 already forces `extended=true`, so this should land cleanly — but re-probe at start of phase.
- Single rollup chosen for the demo: **`dau_by_day`** on `active_daily` — measures: `[active_daily.dau, active_daily.dau_exact, active_daily.mau]`, time dimension: `active_daily.log_date`, granularity: `day`, partition_granularity: `month`. Highest visibility for ballistar_vn.
- Cube's pre-agg build is triggered on first query against matching shape. First-query latency includes build; subsequent queries hit Cube Store. For demo: pre-warm by running the matching query once before demoing.
- The `mf_users.yml` file is in a DIFFERENT repo (`cube-dev`). Phase 5a is a separate PR there — coordinate.

## Requirements

### 5a. Cube-model enablement

**Functional:**
- Enable `pre_aggregations:` block in `cube-dev/cube/model/cubes/active_daily.yml` (or wherever the right rollup belongs — `mf_users.yml` is referenced in architecture docs but active_daily is the higher-value target).
- Rollup `dau_by_day`:
  - `type: rollup`
  - `measures: [active_daily.dau, active_daily.dau_exact, active_daily.mau]`
  - `time_dimension: active_daily.log_date`
  - `granularity: day`
  - `partition_granularity: month`
  - `refresh_key:` matching the source cube's refresh interval
- Cube hot-reloads (per `cube-mm01-integration-and-schema-reload.md` §1.1 dev mode).

**Non-functional:**
- Pre-warm the rollup before demo (run the canonical "DAU by day" query once).

### 5b. Catalog surfacing

**Functional:**
- `CubeCard.tsx` shows a "Has rollup × N" badge when `cube.preAggregations?.length > 0`. Hidden when 0.
- `CatalogFilterRail.tsx` gains a "Pre-aggregated" toggle filter — shows only cubes with at least one rollup.
- `CubeDetailPanel.tsx` adds a Pre-aggregations section listing each rollup's `name`, `measures[]`, `time_dimension`, `granularity`. Hidden when 0.
- Re-probe `/meta?extended=true` for the actual shape of the `preAggregations` field — JSON shape determines exact rendering.

**Non-functional:**
- All data from already-fetched `/meta`. No new endpoint.

## Architecture

```
cube-dev repo:
  cube/model/cubes/active_daily.yml
    └─ pre_aggregations: { dau_by_day: { type: rollup, ... } }
                ↓ (Cube hot-reloads)
  /cubejs-api/v1/meta?extended=true
    └─ cubes[active_daily].preAggregations = [{ name: dau_by_day, ... }]

cube-playground repo:
  CatalogPage cubes state (from P1 fetch)
    ├─ CubeCard ──▶ "Has rollup × N" badge
    ├─ CatalogFilterRail ──▶ "Pre-aggregated" filter
    └─ CubeDetailPanel ──▶ Pre-aggregations section
```

## Related Code Files

- **In `cube-dev/` (separate repo):**
  - `cube/model/cubes/active_daily.yml` — uncomment / add `pre_aggregations:` block
- **In this repo:**
  - **Modify:**
    - `src/pages/Catalog/CubeCard.tsx` — add "Has rollup × N" badge
    - `src/pages/Catalog/CatalogFilterRail.tsx` — add "Pre-aggregated" filter
    - `src/pages/Catalog/CubeDetailPanel.tsx` — add Pre-aggregations section
    - `src/pages/Catalog/use-catalog-selectors.ts` — extend filterByFacets to support `hasRollup` predicate
  - **Augment:** `src/QueryBuilderV2/types.ts` — add `PreAggregation` type + `preAggregations?: PreAggregation[]` to `Cube`

## Implementation Steps

### 5a. Cube model

1. **Re-probe `/meta?extended=true`** for the live `preAggregations` field shape. Document the exact JSON shape (likely `[{ name, type, measures, timeDimension, granularity, partitionGranularity, refreshKey }]`).
2. Edit `cube-dev/cube/model/cubes/active_daily.yml`. Add (or uncomment) the `pre_aggregations:` block under the cube. Suggested:
   ```yaml
   pre_aggregations:
     - name: dau_by_day
       measures:
         - active_daily.dau
         - active_daily.dau_exact
         - active_daily.mau
       time_dimension: active_daily.log_date
       granularity: day
       partition_granularity: month
   ```
3. Watch Cube logs for reload + first-build. Run a canonical DAU-by-day query to verify the rollup is matched.
4. Verify `/cubejs-api/v1/meta?extended=true` now returns `preAggregations` for `active_daily`.

### 5b. Catalog surfacing

5. Add `PreAggregation` type to `src/QueryBuilderV2/types.ts` (shape from step 1).
6. `CubeCard.tsx`: render `Has rollup × {cube.preAggregations.length}` badge after the cluster chip when length > 0.
7. `CatalogFilterRail.tsx`: add `Pre-aggregated` toggle. Wire into the facets object passed to `use-catalog-selectors`.
8. `use-catalog-selectors.ts`: extend filter predicate — if `hasRollup` is true, keep only cubes with `preAggregations.length > 0`.
9. `CubeDetailPanel.tsx`: add a new section (positioned after Description, before Joins): table with rollup name, measures (comma-joined), time dimension, granularity / partition_granularity.
10. Smoke test:
    - `/catalog` shows `active_daily` with "Has rollup × 1" badge
    - Pre-aggregated filter narrows to just `active_daily`
    - DetailPanel shows the `dau_by_day` rollup details
    - Pre-warm: run "DAU by log_date.day" in `/build`, observe rollup hit in Cube logs

## Todo List

- [ ] Re-probe `/meta?extended=true` for `preAggregations` shape
- [ ] Edit `cube-dev/cube/model/cubes/active_daily.yml` to enable `dau_by_day` rollup
- [ ] Verify Cube hot-reload picks up new rollup
- [ ] Verify `/meta` exposes `preAggregations`
- [ ] Add `PreAggregation` type
- [ ] Add "Has rollup × N" badge to CubeCard
- [ ] Add "Pre-aggregated" filter chip to FilterRail
- [ ] Add Pre-aggregations section to CubeDetailPanel
- [ ] Pre-warm rollup before demo

## Success Criteria

- [ ] `active_daily` cube exposes 1 rollup (`dau_by_day`) in `/meta?extended=true`
- [ ] Catalog `active_daily` card shows "Has rollup × 1" badge
- [ ] "Pre-aggregated" filter narrows results correctly
- [ ] DetailPanel lists rollup measures + granularity
- [ ] DAU-by-day query in `/build` is observably faster (Cube logs show rollup match)
- [ ] No regression on non-pre-aggregated cubes

## Risk Assessment

- **Risk:** `/meta?extended=true` doesn't expose `preAggregations` on this Cube version. Mitigation: re-probe at step 1. If unsupported, fall back to reading YAML directly via dev-only Vite middleware (already in place for schema-write). Document the gap.
- **Risk:** Rollup build fails (Trino dialect mismatch on `approx_distinct`). Mitigation: dau_exact uses `count_distinct` which is portable; dau uses `count_distinct_approx` which requires Cube to know Trino — verify by running a one-off query first.
- **Risk:** Pre-agg build latency on first query makes demo confusing. Mitigation: explicit pre-warm step in the todo list.
- **Risk:** Cross-repo coordination — the rollup edit lives in `cube-dev/`, separate PR. Mitigation: document the dependency in commit message and PR description; verify reload before catalog work begins.

## Security Considerations

- No new auth surface; reads the same `/meta` payload.
- Rollup contents (measures, granularity) are NOT sensitive — same level as the rest of `/meta`.
