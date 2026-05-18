---
phase: 8
title: "Pre-aggregation enablement + catalog badge"
status: pending
priority: P3
effort: "1d"
dependencies: [7]
---

# Phase 8: Pre-aggregation enablement + catalog badge

## Overview

Enable a `pre_aggregations:` block on one cube in `metrics-catalogue/cube/model/cubes/mf_users.yml`, then surface it in the catalog: "Has rollup × N" badge on cube cards, "Pre-aggregated" filter chip in facets, and pre-agg names + time-dim granularity in DetailPanel.

Absorbed from cancelled meta-driven plan P5. Demo line: "This cube has a daily rollup — `dau` queries are millisecond-class."

## Requirements

- **Functional:**
  - `mf_users.yml` gets a `pre_aggregations:` block with at least one named rollup keyed by a time dimension (e.g. daily rollup of `dau`)
  - Cube refreshes pre-aggs after restart (Cube Store handles materialization)
  - Catalog cube cards show "Has rollup × N" badge when `cube.preAggregations` is non-empty
  - Catalog facet "Pre-aggregated" toggles cubes that have ≥1 pre-agg
  - DetailPanel "Pre-aggregations" section: list each pre-agg name, granularity, time-dim
- **Non-functional:**
  - YAML change coordinated with metrics-catalogue repo (separate PR or branch)
  - No new endpoint calls — reuses extended `/meta` from P1

## Architecture

```
Catalog facet additions:
  - hasPreAgg (boolean toggle)

Cube card additions (when meta.cubes[i].preAggregations?.length > 0):
  └── PreAggBadge ("Has rollup × 2")

DetailPanel additions:
  └── PreAggSection
      └── for each preAgg: name, type (rollup/originalSql), granularity, timeDimension
```

The /meta extended payload should expose `preAggregations` per cube — **verify in P8 step 1** before coding the UI.

## Related Code Files

- **Modify (metrics-catalogue repo — coordinate separately):**
  - `metrics-catalogue/cube/model/cubes/mf_users.yml` — add `pre_aggregations:` block
- **Modify (this repo):**
  - `src/pages/Catalog/CubeCard.tsx` — render PreAggBadge
  - `src/pages/Catalog/CatalogToolbar.tsx` — add "Pre-aggregated" facet
  - `src/pages/Catalog/DetailPanel.tsx` — render PreAggSection
  - `src/pages/Catalog/hooks/use-catalog-filters.ts` — add `hasPreAgg` filter
- **Create:**
  - `src/pages/Catalog/components/pre-agg-badge.tsx`
  - `src/pages/Catalog/components/pre-agg-section.tsx`

## Implementation Steps

1. **Probe:** `curl -H "Authorization: Bearer $TOKEN" "$API_URL/v1/meta?extended=true" | jq '.cubes[].preAggregations'`. Confirm whether extended /meta includes preAggregations. If empty, this phase's data path may need a different endpoint or YAML enablement first.
2. **Coordinate YAML change** in metrics-catalogue repo (separate PR):
   ```yaml
   pre_aggregations:
     - name: dau_daily_rollup
       measures: [active_daily.dau]
       time_dimension: active_daily.event_date
       granularity: day
       refresh_key:
         every: '1 hour'
   ```
3. After cube_api restart picks up the rollup, re-run probe — confirm /meta exposes the pre-agg.
4. **PreAggBadge:** small chip on CubeCard header.
5. **PreAggSection in DetailPanel:** list name + granularity + time-dim.
6. **CatalogToolbar:** "Pre-aggregated" facet chip; updates `useCatalogFilters`.
7. **Filter logic:** add `hasPreAgg` clause to filter function.
8. Tests:
   - useCatalogFilters: hasPreAgg filter
   - Snapshot for CubeCard with/without PreAggBadge
   - Snapshot for DetailPanel with/without PreAggSection

## Success Criteria

- [ ] `mf_users.yml` carries a `pre_aggregations:` block (verified in source repo)
- [ ] Cube card shows "Has rollup × 1" badge for mf_users
- [ ] "Pre-aggregated" facet toggle shows only mf_users
- [ ] DetailPanel for mf_users shows the daily rollup
- [ ] Querying `dau` by day in Playground is noticeably faster (manual demo step)

## Risk Assessment

- **Risk:** /meta does NOT expose preAggregations even with `extended=true` on deployed Cube — mitigation: P8 step 1 probes first. If missing, surface as known limitation; skip the UI and document.
- **Risk:** Rollup materialization fails (Cube Store config) — mitigation: existing Cube Store volume in docker-compose is configured; verify after first refresh cycle (≤ 1h per `refresh_key`).
- **Risk:** Cross-repo coordination (metrics-catalogue PR) delays this phase — mitigation: phase is P3, lowest priority; defer if blocked.

## Security Considerations

- No new endpoint, no new auth.
