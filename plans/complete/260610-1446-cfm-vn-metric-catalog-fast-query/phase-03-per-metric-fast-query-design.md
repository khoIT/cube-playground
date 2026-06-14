---
phase: 3
title: "Per-metric fast-query (rollup) design (cfm_vn)"
status: completed
priority: P1
effort: "4h"
dependencies: [1, 2]
---

# Phase 3: Per-metric fast-query (rollup) design (cfm_vn)

## Overview
For the final list, design the semantic-layer artifacts that make each metric serve
**warm <2s from CubeStore** for the common slice. Design only — YAML lands in Phase 4.

## Key insights (from this session)
- A rollup serves a metric only if **time-dim matches the query** and measures are additive.
- Cross-cube **ratios cannot be one raw query** (fanout via mf_users). Classify ratios:
  - **Class A — same-cube** (arppu, roas, cpi, ctr, paying_rate-as-defined, rr*): post-agg
    measure on one cube → already fast once that cube has a daily rollup.
  - **Class B — cross-grain** (arpdau, mkt_rev_ratio): conform denominator into a daily mart
    measure (best, → becomes Class A) OR product-layer blend on the conformed day key.
- Ratio operands must share **identical dimension cuts** across their rollups, else a sliced
  ratio falls back to Trino on one side.

## Requirements
- Functional: per backing cube, a rollup spec = {measures, dimension cuts, time_dimension
  (canonical day = log_date-based), granularity: day, partition_granularity: year,
  refresh/lambda, build_range on the physical column}. Reuse existing rollups where present
  (active_daily already has daily DAU rollups; don't duplicate).
- The known gap: **recharge daily-revenue rollup keyed on `recharge_date` (log_date)** — cfm
  has none. Design it carrying revenue_vnd + transactions + paying_users, cut by the same
  dims as the DAU rollup (country_code, os_platform, payer/is_recharge_day) so ARPDAU/
  paying_rate stay rollup-backed when sliced.
- For Class B ratios, decide per-metric: conform-into-mart vs blend (document which + why).
- Non-functional: each spec names the exact common slice it accelerates + expected partition
  row count (sanity that it's small).

## Related Code Files
- Read: `cube-dev/cube/model/cubes/cfm/{recharge,active_daily,game_key_metrics,new_user_retention,user_recharge_daily,marketing_cost}.yml`
- Read: `docs/lessons-learned.md` (rollup authoring rules)
- Create: `plans/.../reports/cfm-vn-rollup-design-spec-report.md`

## Implementation Steps
1. Map each final metric → backing cube → existing rollup? (reuse) or new spec.
2. Write the recharge `revenue_daily` spec on `recharge_date`; align dims with DAU rollup.
3. For each new event-cube metric (Phase 2 adds), spec a day-grain rollup.
4. For Class B ratios, pick conform-vs-blend and note the product-layer touch (out of YAML scope).
5. Produce a single spec table: cube | rollup | measures | dims | time_dim | covers metrics.

## Success Criteria
- [ ] Every final metric maps to a rollup that can serve its common slice <2s warm (or an
      explicit "blend, two rollups" note for Class B).
- [ ] Ratio operand rollups have matching dimension sets.
- [ ] No additive-violation (no ratio stored as a rollup measure).

## Risk Assessment
- Dimension-cut sprawl → too many rollups. Cap cuts to the 3–4 dims dashboards actually slice.
- count_distinct HLL across week/month must use approx sketch (verify rolls up).

## Next steps
Spec drives Phase 4 implementation + verification.
