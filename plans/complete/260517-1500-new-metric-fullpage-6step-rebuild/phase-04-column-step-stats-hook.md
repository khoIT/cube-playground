---
phase: 4
title: "Step 3 Column + use-column-stats hook (runIdRef stale-token concurrency)"
status: completed
priority: P1
effort: "2d"
dependencies: [3]
---

# Phase 4: Column step stats hook

## Overview

Build Step 3 (Column picker) and `use-column-stats` hook that fetches real per-column data via lazy Cube `/load` queries on column click — count (if cube has count measure), null %, distinct, samples, 15-bucket histogram, 30-day sparkline, min/avg/max. Cards or Table view toggle. "Why only N?" popover lists rejected columns. Right rail = column health panel (op-applied KPI, DQ checks, 30-day sparkline).

**Red-team-applied (finding #4):** **Concurrency uses `runIdRef` stale-token guard, not AbortController.** Cube SDK 1.6.46 `load()` does NOT accept `AbortSignal`. Mirror the existing pattern from `src/QueryBuilderV2/NewMetric/hooks/use-live-preview.ts:75-78,99-114` and `use-funnel-queries.ts:57-78`.

**Red-team-applied (finding #14):** Hook gates on `<cube>.count` measure presence (probed in P1). When absent, distinct/null-count/sparkline degrade gracefully w/ explicit empty-state — no broken fallback queries.

## Requirements

**Functional:**
- Eligible columns derived from `useEligibleColumns(sourceCube, op)`.
- Card view (default): one card per column showing icon, name (mono), type, description, no-nulls / null % pill, distinct pill, distribution histogram (numeric/integer only) w/ min/avg/max, sample value strip.
- Table view: sortable table — name, type, distribution mini-bar, min, avg, max, null %, distinct.
- Segmented toggle Cards / Table in StepHeader actions slot.
- "Why only N?" popover button — shows reasoning ("Sum accepts numeric, integer") + list of rejected columns w/ their type.
- `use-column-stats(cube, columnId, op)` — lazy: fires `/load` queries on column change.
  - **Concurrency:** `runIdRef` increments on each call; each pending promise checks `myRunId === runIdRef.current` before `setState`. Stale results from prior column discarded.
  - **Cache:** in-memory `Map<string, ColumnStats>` keyed `${cube}|${col}|${op}` capped at 50 entries LRU.
  - Returns `{ loading, error, count, nullCount, nullPct, distinct, samples, histogramBins, min, avg, max, sparkline }`.
- Queries emitted (only if cube has `count` measure per P1 probe; else degrade):
  - **count** — `{ measures: ['<cube>.count'] }`.
  - **null count** — `{ measures: ['<cube>.count'], filters: [{ member: '<col>', operator: 'notSet' }] }`.
  - **distinct** — count-distinct of column via Cube measure if available, else `{ dimensions: ['<col>'], limit: 1000 }` and count rows client-side (POC compromise, surfaced as "estimated" in DQ panel).
  - **samples** — `{ dimensions: ['<col>'], limit: 5 }`.
  - **histogram** (numeric/integer only) — `{ dimensions: ['<col>'], limit: 1000 }` → bin client-side into 15 buckets.
  - **min/avg/max** — three queries if Cube measures exist; else compute from sample set + label as "estimated".
  - **sparkline** — `{ measures: ['<op-on-col>'], timeDimensions: [{ dimension: '<primary time dim>', granularity: 'day', dateRange: 'last 30 days' }] }` — only if source cube has time dim AND count measure.
- When cube lacks `count` measure: hook returns `{ unavailable: true, reason: 'no-count-measure' }`; right rail renders "No count measure on this cube — column stats unavailable. Ask data team to add `count: { type: count }`."
- Right-rail Column Health panel: KPI big number (op-applied), DQ checks (nulls 0% green / range OK / no outliers / refreshed N ago), 30-day sparkline area chart w/ +Δ% vs prior 30 d.
- LeftRail step row 3 summary: column name; badge: currency or ✓.
- Continue → Step 4 Filters.

**Non-functional:**
- Hook discards stale results via runIdRef (no AbortController — SDK doesn't support it).
- Cache survives within session (component lifetime).
- Skeleton placeholder for histogram + sparkline while loading.
- All files < 200 LOC; histogram + sparkline rendered as inline `<svg>`.
- No `dangerouslySetInnerHTML`.

## Architecture

```
src/QueryBuilderV2/NewMetric/full-page/
├── steps/step-3-column/
│   ├── index.tsx
│   ├── column-body.tsx
│   ├── column-card.tsx
│   ├── column-table.tsx
│   ├── column-health-rail.tsx
│   ├── why-only-n-popover.tsx
│   ├── distribution-histogram.tsx          inline SVG
│   ├── sparkline.tsx                       inline SVG
│   └── __tests__/
│       └── column-card.test.tsx
└── hooks/
    ├── use-column-stats.ts                 runIdRef pattern, NO AbortController
    └── __tests__/
        └── use-column-stats.test.ts        mock cubejsApi.load
```

## Related Code Files

- **Create:** all files above
- **Modify:** `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` — render step-3 when `currentStep === 3`
- **Reference for pattern:** `src/QueryBuilderV2/NewMetric/hooks/use-live-preview.ts:75-114` (runIdRef stale-token reference)

## Implementation Steps (TDD)

1. **Re-confirm P1 cube probe results** — list of cubes with `count` measure. Used to gate stat queries.
2. **Manual smoke** — run a `cubejsApi.load` for each query type against `mf_users` in dev console; confirm shape + timing.
3. **Write tests first** for `use-column-stats`:
   - Mock `cubejsApi.load` to return fixture rows.
   - Initial state `loading: true` then resolves with `nullPct: 0`, `distinct: ...`, histogram bins length 15 (for numeric), samples length 5.
   - **Stale-token behavior:** call hook with column A; before A's promise resolves, call w/ column B. Assert A's setState path is no-op (runId mismatch); only B's data lands.
   - Second call to same `{cube,col,op}` key returns from cache without re-fetching `cubejsApi.load`.
   - String/boolean columns skip histogram + min/avg/max gracefully.
   - When source cube lacks `count` measure (mock meta), hook returns `{ unavailable: true, reason: 'no-count-measure' }` without firing any queries.
4. **Implement `use-column-stats`** — orchestrates parallel queries via `Promise.all`, runIdRef stale-token guard. Cache map keyed `${cube}|${col}|${op}` capped via simple LRU (50).
5. **Write tests first** for `column-card` — name + type + null pill render; click fires `onClick`; histogram absent for string type; unavailable card renders muted "stats unavailable" pill when hook reports `unavailable`.
6. **Implement `column-card.tsx`** — pixel-match mockup w/ histogram inline + sample list.
7. **Implement `column-table.tsx`** — sortable; mini-bar histogram per row; null % red when > 0.
8. **Implement `distribution-histogram.tsx` + `sparkline.tsx`** — pure SVG primitives.
9. **Implement `why-only-n-popover.tsx`** — controlled; lists rejected columns with type.
10. **Implement `column-health-rail.tsx`** — pulls from `use-column-stats`; KPI + 4 DQ lines + 30-day sparkline w/ Δ%; renders "stats unavailable" callout when hook reports it.
11. **Implement `column-body.tsx` + step `index.tsx`** — wires Shell, header w/ segmented Cards/Table toggle + "Why only N?" button.
12. **Manual QA** — pick `ltv_30d_total_vnd` in `mf_users` (has count), observe real null %, distinct, samples, histogram, sparkline; switch to a string column → histogram hidden; toggle to Table view → same data tabulated. Switch to a cube without count (per probe) → "stats unavailable" card.
13. Typecheck + tests + commit.

## Success Criteria

- [ ] Step 3 lists eligible columns based on op `accepts`.
- [ ] Selecting a numeric column on a count-enabled cube triggers queries; right rail shows real KPI value, null %, distinct count, samples, histogram, 30-day sparkline.
- [ ] **Stale-token verified:** switching columns mid-fetch does NOT race — prior column's `setState` is skipped via runIdRef.
- [ ] Selecting any column on a cube WITHOUT a `count` measure renders "stats unavailable — add count measure" callout; no broken queries fire.
- [ ] "Why only N?" popover lists rejected columns + types.
- [ ] Card / Table toggle preserves selection across views.
- [ ] String / boolean columns hide histogram + min/avg/max cleanly.
- [ ] No `AbortController` / `AbortSignal` references in new files (grep clean).
- [ ] No `dangerouslySetInnerHTML` in new files.
- [ ] Typecheck + tests green; every new file < 200 LOC.

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Histogram query on 284 M-row `mf_sessions` slow / scans too much | Limit 1000 rows; document POC compromise; surface "estimated · X MB scanned" hint from Cube response if available. Pre-agg work out of scope for this plan. |
| Per-cube probe uncovers many cubes without count → wide "unavailable" UX | Acceptable empty-state. Document in P1 probe results and flag to data team. |
| runIdRef stale-token still lets stale network request finish (no real abort) | True — accepted compromise per Cube SDK reality. Test asserts stale `setState` is skipped; in-flight network completes but is silently discarded. Cube quota impact noted. |
| LRU cache eats RAM on long sessions | Cap 50 entries; simple insertion-order eviction. |
| Sparkline requires time dim that some cubes lack | Hide sparkline + show "no time dim" muted text when cube lacks one. |
| Distinct-count via 1000-row dimension query inaccurate on high-cardinality cols | DQ panel labels as "estimated"; tooltip explains. |
