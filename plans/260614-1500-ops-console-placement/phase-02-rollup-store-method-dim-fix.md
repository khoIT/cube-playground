---
phase: 2
title: "Rollup history reseal (perf, optional)"
status: pending
priority: P3
effort: "0.5d"
dependencies: []
---

# Phase 2: billing_detail rollup — history reseal (perf)

## Overview
**Premise corrected by the 2026-06-14 data audit.** There is NO double-count: for the same 13 days,
raw-by-store == rollup-by-gateway == ₫15.370B exactly. store/payment_method queries route to the raw
source but the raw source is CORRECT. The earlier ₫44B "3× inflation" was just the full 30d (raw covers
it; the rollup only has the June partition sealed). So this phase is now a PERF/coverage item, not a
correctness blocker — Phase 3 does NOT depend on it.

The real gap: the `billing_detail` rollup only has the June partition sealed, so a 30d window crossing
into May falls through to a raw scan. Two options (pick from measured cost):
- **(A) Rely on bounded raw** — leave the rollup as-is; the Overview always bounds billing queries to
  ≤31d (the scan guard already enforces this), and raw scans run ~3.5–15s cold (acceptable for a console).
  Zero build work. Default.
- **(B) Reseal history** — extend/rebuild the rollup so May+ partitions are sealed, making 30d windows
  fast. Optionally add `store`/`payment_method_id` to the rollup dims (perf for those breakdowns only).

## Requirements
- If (B): a 30d billing query (cash/payers by day, or by gateway) routes to
  `preagg_<game>.billing_detail_billing_detail_daily_batch` across the FULL window (not just June), and
  totals match the raw source for the same window.
- If (A): document that billing queries are raw-served but bounded + correct; no YAML change.

## Architecture
Option B edits the `pre_aggregations` block in `cube-dev/cube/model/cubes/{cfm,jus}/billing_detail.yml`
(reseal / confirm `build_range_start` covers the needed history; optionally add dims). DEV_MODE=false ⇒
restart `cube-playground-cube-api-dev` + reseal (scope via `CUBE_REFRESH_GAMES=cfm,jus`). Verify by
compiled-SQL FROM clause, never `usedPreAggregations` (lambda masks it — parent plan red-team #7).

## Related Code Files
- Modify (only if B): `cube-dev/cube/model/cubes/cfm/billing_detail.yml`, `.../jus/billing_detail.yml`.
- Reference: `server/src/services/preagg-readiness.ts:15-21`, `cube-dev/scripts/measure-preagg-build.sh`,
  memory `cube-preagg-build-mechanics-harness`, `cube-rollup-authoring-rules`,
  `cube-serving-instance-needs-restart-for-new-rollups`.

## Implementation Steps
1. Decide A vs B from the measured cold-raw latency of a 30d billing query (if <~10s, take A and skip).
2. If B: confirm `build_range_start` history depth; reseal cfm+jus; (optional) add `store` +
   `payment_method_id` dims.
3. Probe a full-30d daily query; confirm full coverage + FROM-clause routing to the preagg table.

## Success Criteria
- [ ] Decision A or B recorded with the measured raw latency that justified it.
- [ ] If B: 30d window fully covered by the rollup; totals == raw; FROM clause = preagg table.
- [ ] If A: documented that bounded raw is the serve path; no correctness risk.

## Risk Assessment
- Reseal race / future-seal (known cubestore behavior) — re-run if first seal is partial (memory
  `cube-preagg-build-mechanics-harness`).
- `payment_method_id` high cardinality could bloat partitions — only add if (B) chosen AND the breakdown
  is actually used; otherwise skip (YAGNI).
