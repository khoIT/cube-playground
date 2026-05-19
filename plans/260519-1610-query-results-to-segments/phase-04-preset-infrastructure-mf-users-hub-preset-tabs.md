---
phase: 4
title: "Preset infrastructure + mf_users-hub preset tabs"
status: pending
priority: P1
effort: "1.5w"
dependencies: [0, 2]
---

# Phase 4: Preset infrastructure + mf_users-hub preset tabs

## Overview

Build the **preset registry** (schema-agnostic backbone for analysis tabs) and ship the `mf_users-hub` preset bundle. Fills in the four bespoke detail tabs from the UI mock — Overview / Engagement / Monetization / Retention — plus the shared KPI/chart cards. Segments with `primary_cube === 'mf_users'` get the rich preset tabs; other primary cubes fall back to Sample users + Predicate tabs only (v1.5 adds more presets).

## Requirements

**Functional**
- Preset definition format (TypeScript constant in v1):
  - `id`, `label`, `hubCube`, `identityDim`, `reachableCubes`, `headlineKpis`, `tabs[]`.
  - Each tab: `id`, `label`, `kpis: KpiSpec[]`, `cards: CardSpec[]`.
  - Each `KpiSpec` / `CardSpec` declares Cube measures / dimensions + chart kind + formatter id.
- Preset registry `src/pages/Segments/presets/registry.ts` maps `preset_id → Preset`.
- `mf_users-hub.ts` preset implements the 4 tabs from the mock:
  - **Overview**: 3 composition cards (channel / platform / country donut + bar list), DAU 14d line, revenue 14d line, payment method bars, retention curve line.
  - **Engagement**: KPIs DAU today / MAU 30d / stickiness; DAU 14d chart; session-intensity histogram.
  - **Monetization**: KPIs Revenue 30d / ARPU lifetime / ARPPU / paying rate; revenue 14d chart; payment method bars.
  - **Retention**: KPIs D7 / D30 / median tenure; retention curve; first-active cohort buckets.
- Shared card primitives: `KpiCard`, `LineChartCard`, `BarListCard`, `DonutCard`, `CompositionCard`.
- All cards run their Cube queries through `useSegmentCubeQuery(segmentId, querySpec)` which:
  - Resolves preset's query spec to a concrete Cube `Query` scoped to the segment's uid list.
  - Caches results client-side keyed by `(segment_id, query_hash, predicate_meta_version)` for 10 minutes.
  - Throttles concurrent requests to 3.
- Detail view headline KPIs (4 tiles above the tab strip) sourced from `preset.headlineKpis`.

**Non-functional**
- Tab body code is preset-driven; no hard-coded "Engagement" knowledge in tab renderer.
- Profile cards lazy-mount per tab (avoids firing all 20+ Cube queries on detail open).
- **Chart components reuse P0 visual primitives** (`LineChart`, `BarList`, `Donut`, `Sparkline`, `CompositionCard` from `src/pages/Segments/visuals/`). No new chart libs, no raw recharts in tab bodies.
- KPI tiles use P0 `KpiTile` primitive.

**Visual parity**
- Detail tabs Overview / Engagement / Monetization / Retention match the corresponding sections of `~/Downloads/cube-segment/screen-detail.jsx` within ≤2% pixel delta at both viewports.
- 4 headline KPIs above tab strip match mock's KPI strip.

## Architecture

```
src/pages/Segments/
  presets/
    registry.ts                    (id → Preset)
    types.ts                       (Preset, KpiSpec, CardSpec)
    mf-users-hub.ts                (the v1 preset definition)
  detail/
    detail-view.tsx                (fills KPI strip + tab strip from preset)
    use-preset.ts                  (resolves segment.preset_id → Preset)
    use-segment-cube-query.ts      (cached, scoped, throttled fetcher)
    cards/
      kpi-card.tsx
      line-chart-card.tsx
      bar-list-card.tsx
      donut-card.tsx
      composition-card.tsx
    tabs/
      preset-tab.tsx               (renders KpiSpec[] + CardSpec[])
      overview-tab.tsx             (preset-driven wrapper; layouts only)
      engagement-tab.tsx
      monetization-tab.tsx
      retention-tab.tsx
```

`preset-tab.tsx` is the generic renderer; the per-tab files just provide layout grids (e.g. `grid-3`, `grid-2`) and pass through. Falling back to `preset-tab.tsx` directly is acceptable if all presets share the same layout vocabulary.

## Related Code Files

**Create**
- `src/pages/Segments/presets/{registry,types,mf-users-hub}.ts`
- `src/pages/Segments/detail/use-preset.ts`
- `src/pages/Segments/detail/use-segment-cube-query.ts`
- `src/pages/Segments/detail/cards/{kpi-card,line-chart-card,bar-list-card,donut-card,composition-card}.tsx`
- `src/pages/Segments/detail/tabs/{preset-tab,overview-tab,engagement-tab,monetization-tab,retention-tab}.tsx`

**Modify**
- `src/pages/Segments/detail/detail-view.tsx` — wire KPI strip + 4 preset tabs (replace `TabPending`)
- `src/pages/Segments/detail/sample-users-tab.tsx` — no change; sits alongside preset tabs
- `src/i18n/locales/*.json` — preset labels + KPI labels

## Implementation Steps

<!-- Updated: Validation Session 1 - prereq research step added; preset spec is provisional until YAML reviewed -->
0. **Prereq: research `mf_users` cube YAML in cube-dev repo.**
   - Locate the `mf_users` cube schema (cube-dev YAML or `.js` schema files in the upstream Cube project).
   - Enumerate every measure + dimension referenced by the preset's KPIs, charts, and composition cards (channel / platform / country donuts, DAU 14d, revenue 14d, payment-method bars, retention curve, MAU 30d, stickiness, ARPU lifetime, ARPPU, paying rate, D7, D30, median tenure, first-active cohort buckets).
   - For each missing or mismatched measure/dim: decide build-in-Cube (block on Cube PR), substitute, or drop from v1 preset.
   - Output: `plans/reports/researcher-260519-mf-users-yaml.md` with the verified measure/dim list.
1. Define `Preset`, `KpiSpec`, `CardSpec`, `TabDef` types in `presets/types.ts`. Include enum of supported card kinds: `'kpi-grid' | 'line' | 'bar' | 'donut' | 'composition'`.
2. Implement `registry.ts` with a single entry for `mf_users-hub`.
3. Implement `mf-users-hub.ts` preset using the verified measure/dim list from Step 0. Every `KpiSpec`/`CardSpec` must cite a measure/dim that exists in the `/meta` payload. Anything still TBD is gated behind a `Skeleton` placeholder with a TODO comment until the corresponding Cube measure ships.
4. Implement `use-preset.ts` — looks up `segment.preset_id` in registry; falls back to `null` (detail view renders only Sample users + Predicate if so).
5. Implement `use-segment-cube-query.ts`:
   - Accepts `(segmentId, querySpec)`.
   - Resolves spec to a concrete Cube `Query` (injects `filters: [{ member: identityDim, op: 'in', values: uids }]`).
   - Uses existing `useCubeQuery` hook (`@cubejs-client/react`) or direct `cubejsApi.load()`.
   - Caches in a shared `Map<string, { result, fetchedAt }>` keyed by query hash + segment's `predicate_meta_version`.
   - Throttles to 3 concurrent.
6. Implement card primitives:
   - `kpi-card.tsx` — label, value, unit, delta arrow + colour, measure pill, footer.
   - `line-chart-card.tsx` — wraps existing recharts line chart; accepts `{ data, xKey, yKey, height, format }`.
   - `bar-list-card.tsx` — horizontal bar list with optional value formatter.
   - `donut-card.tsx` — pie/donut chart.
   - `composition-card.tsx` — donut + accompanying bar list.
7. Implement `preset-tab.tsx`:
   - Receives `tab: TabDef` + `segment`.
   - Renders KPI grid first (`kpis: KpiSpec[]`).
   - Renders cards in declared order; respects layout hints (`gridCols`).
   - Suspends with `<Skeleton/>` placeholders per card while data loads.
8. Implement per-tab wrappers (`overview-tab.tsx`, etc.) as thin wrappers that pull their `tab` from the preset and pass to `preset-tab.tsx`.
9. Wire `detail-view.tsx`:
   - On segment load → `use-preset(segment.preset_id)` returns `Preset | null`.
   - KPI strip renders `preset.headlineKpis` (or hides if no preset).
   - Tab strip filters tabs to those provided by preset; appends Sample users + Saved analyses (stub for P7) + Predicate.
   - For segments without a preset: render only Sample users + Predicate tabs.
10. Add unit tests:
    - `use-preset.test.ts` — known id resolves; unknown returns null.
    - `use-segment-cube-query.test.ts` — uid filter injected; cache hit short-circuits.
    - `preset-tab.test.tsx` — renders KPI then cards in spec order.

## Success Criteria

- [ ] Loading a segment with `primary_cube='mf_users'` and `preset_id='mf_users-hub'` shows the 4 preset tabs with real Cube data scoped to the segment's uid list.
- [ ] Loading a segment with no preset shows only Sample users + Predicate tabs.
- [ ] KPI strip above tabs reflects `preset.headlineKpis`.
- [ ] Switching tabs lazy-fires their queries (not all at once on detail open).
- [ ] Same segment opened twice within 10 min hits the local cache (network panel shows ≤ 1 request per card).
- [ ] Concurrent card fetches capped at 3 (verified via network panel throttling).
- [ ] No more than 3 inline `style` props per new component (theme tokens preferred).
- [ ] Playwright visual diff passes ≤2% for `detail-overview`, `detail-engagement`, `detail-monetization`, `detail-retention` at both viewports.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Preset hardcodes Cube measure names that don't exist in the actual schema | Resolved via Step 0 prereq: cube-dev YAML reviewed + measure list verified before any preset code is written. Surface "missing measure" warnings in dev for defense-in-depth. |
| Cube `IN` filter with 5k uids slow for some preset queries | Pre-aggregations on `mf_users` will help; document v1 cap (5k uids); add `Skeleton` loading > 1s. |
| 20+ cards on Overview tab fire 20 queries on open | Lazy per-card via `IntersectionObserver`; only mount visible cards initially. |
| Cards become a "kitchen sink" of bespoke logic | Keep card primitives generic; preset specs declarative; no card-specific React state outside the renderer. |
| Sample users query needs random sampling (not just LIMIT) | Use `ORDER BY hash(user_id) LIMIT 50` pattern at Cube query layer; or sample on FE if the full list is paged in (≤ 5k uids → cheap). |
