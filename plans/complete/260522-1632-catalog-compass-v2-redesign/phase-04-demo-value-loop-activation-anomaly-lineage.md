---
phase: 4
title: "Demo value loop (activation + anomaly + lineage)"
status: done
priority: P1
effort: "3d"
dependencies: [3]
---

# Phase 4: Demo value loop (activation + anomaly + lineage)

## Overview

Close the leadership demo loop from MetricDetailPage:
- **Flow 5 (Activation):** right-rail "Push to activation" → existing push-modal
- **Flow 4 (Anomaly):** AnomalyBadge on MetricCard + MetricDetail header → ChangeAnalysisModal stub → "Save as segment"
- **Flow 3 (Metric Tree):** Lineage tab v1 = static 3-column layout

After this phase, the leadership demo (5 → 3 → 4) is runnable end-to-end from the Metrics tab.

## Requirements

**Functional:**
- "Push to activation" right-rail button → opens existing `push-modal` preloaded
- AnomalyBadge renders on MetricCard + MetricDetail header when `metric.anomaly` non-empty (mocked from YAML)
- AnomalyBadge click → ChangeAnalysisModal with mocked breakdowns (Country / Channel / Tier)
- "Save as segment" CTA → opens segments page w/ synthesised segment definition (URL handoff acceptable)
- Lineage tab v1: 3 columns (upstream cubes from formula refs · this metric · downstream metrics referencing this)

**Non-functional:**
- Modal opens within 200ms
- Lineage compute < 100ms (in-memory)

## Architecture

```
src/pages/Catalog/metric-detail/
├── tab-lineage.tsx                       # MODIFY — placeholder → 3-col
├── right-rail.tsx                        # MODIFY — wire activation
├── lineage-columns.tsx                   # NEW — 3-col layout
├── lineage-graph-builder.ts              # NEW — upstream/downstream compute
└── ...

src/pages/Catalog/metrics-tab/
└── metric-card.tsx                       # MODIFY — add AnomalyBadge slot

src/shared/concept-shell/
├── anomaly-badge.tsx                     # NEW — 4 states
└── change-analysis-modal.tsx             # NEW — Compass-style modal

src/shared/activation/
└── push-from-metric.ts                   # NEW — adapter metric → push-modal payload
```

**Activation adapter:**

```ts
type ActivationPayload = {
  source: 'metric' | 'concept' | 'segment';
  sourceId: string;
  inferredSegmentName?: string;
  inferredFilters?: FilterTree;
};
```

**Lineage compute:** upstream = cube FQNs in `formula.numerator/denominator/ref`. Downstream = scan registry for metrics referencing this id. View refs (cube-dev `views/`) deferred.

**ChangeAnalysisModal mocked:** 3 hard-coded breakdowns per metric (Country/Channel/Tier, top-3 each with deltaPct). YAML `anomaly.breakdowns` override allowed.

## Related Code Files

**Create:**
- `src/shared/concept-shell/anomaly-badge.tsx`
- `src/shared/concept-shell/change-analysis-modal.tsx`
- `src/shared/activation/push-from-metric.ts`
- `src/pages/Catalog/metric-detail/lineage-columns.tsx`
- `src/pages/Catalog/metric-detail/lineage-graph-builder.ts`
- `src/pages/Catalog/metric-detail/__tests__/lineage-graph-builder.test.ts`

**Modify:**
- `src/pages/Catalog/metric-detail/tab-lineage.tsx`
- `src/pages/Catalog/metric-detail/right-rail.tsx`
- `src/pages/Catalog/metrics-tab/metric-card.tsx`
- `src/pages/Catalog/metric-detail/metric-detail-header.tsx` — add badge

## Implementation Steps

1. **Build AnomalyBadge** — 4 states (none/low/high/trend); coloured chip + deltaPct. Click → emit modal open.
2. **Build ChangeAnalysisModal** — header (metric + delta + period), 3-col breakdown grid, "Save as segment" CTA. Hard-code mocked data unless YAML override present.
3. **Wire "Save as segment"** — synthesise segment URL `/segments/new?from-anomaly=<metric-id>:<contributor>`.
4. **Build push-from-metric adapter** — input business-metric, output ActivationPayload. For metric: synthesise name + reachable segment from denominator.
5. **Wire right-rail "Push to activation"** — enabled when reachable segment OR inferred filter. Click → `openPushModal(payload)`. Reuse `src/pages/Segments/push-modal/push-modal.tsx`.
6. **Build lineage-graph-builder** — pure `buildLineage(metric, allMetrics)` → `{ upstream, downstream }`.
7. **Build lineage-columns** — 3 vertical columns, clickable nav.
8. **Replace tab-lineage placeholder** — compute + render.
9. **Seed 3 anomalous metrics in YAML:** `payments.refund_rate` = high, `users.churn_30d` = high, `revenue.ad_vnd` = trend.
10. **Test:**
    - Unit: buildLineage with fixture registry
    - Integration: anomaly click → modal → save-as-segment URL
    - Integration: "Push to activation" → push-modal opens preloaded

## Success Criteria

- [ ] AnomalyBadge on 3 seeded anomalous metric cards
- [ ] Click anomaly → ChangeAnalysisModal with mocked breakdowns
- [ ] "Save as segment" → segments page with URL params (no creation needed v1)
- [ ] "Push to activation" → push-modal opens preloaded with metric context
- [ ] Lineage tab shows upstream for ARPDAU + downstream for revenue_vnd
- [ ] Flow 5 → 3 → 4 runnable end-to-end from Metrics tab

## Risk Assessment

- **push-modal API may not accept metric context.** **Mitigation:** adapter synthesises compatible payload; if push-modal needs real segment, route via "Save as segment" first.
- **Mocked anomaly data misleads in demos.** **Mitigation:** small "demo data" banner inside modal until P8.
- **Lineage O(n²)** over registry. **Mitigation:** memoise; if registry > 1000, build adjacency map at load.
- **Badge click vs card click race.** **Mitigation:** stopPropagation on badge.
