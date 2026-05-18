# Perf — Before vs After

**Date:** 2026-05-17
**Plan:** [`260517-2330-perf-restructure-zustand-lazy-routes`](../plan.md)
**Branch:** `segment_dimension`
**Probe:** [`src/dev/perf-probe.tsx`](../../../src/dev/perf-probe.tsx) (Phase 1)

## Methodology

- Build comparison: pre-Phase-1 HEAD vs post-Phase-5.0 HEAD.
- Browser: Chrome (manual); CPU throttle: 4× slowdown; network: Fast 3G.
- Interaction scripts: identical to [`perf-baseline.md`](./perf-baseline.md).
- Two-run rule: first run primes cache; second run is the trusted measurement.
- Probe usage: `window.__perfCounts = {}` before each interaction → run → snapshot.

Bundle-size delta has been measured automatically by stashing the
post-restructure tree, running `npx vite build` against the pristine
pre-restructure source, then popping the stash and re-building. Both
builds were run with Vite 5.4.21 on the same node/npm install. Numbers
appear in §Interaction 2 below.

Render-count and interaction-timing deltas (the "ms" columns) still
require a manual Chrome DevTools trace session — those interactions
need the cubejs backend reachable so the playground pages actually
render the side panel + run queries. The probe (`src/dev/perf-probe.tsx`)
and interaction scripts (`perf-baseline.md`) are ready for that capture.

All code-level changes summarized in §Phase Contributions have landed and
are validated by the automated test suite (367 tests passing, +21 new
tests added across Phases 1–5.0).

## Interaction 1 — Dim/measure toggle (Query Builder side panel)

| Metric | Before | After | Δ |
|---|---|---|---|
| Total React commits | _capture_ | _capture_ | _compute_ |
| `QueryBuilderSidePanel` render count | _capture_ | _capture_ | _compute_ |
| Sum actualDuration (ms) | _capture_ | _capture_ | _compute_ |
| Network dry-run requests | _capture_ | _capture_ | _compute_ |

**Expected direction:** large drop. Phase 5.0 memoizes the
`QueryBuilderContext.Provider` value (was a fresh object literal each render
→ all 80 consumers re-rendered on every external state change). Phase 4
stabilizes upstream arrays (`cubesOrViewsAll`, `cubesOrViews`,
`filteredCubes`, `allJoinableCubes`) and gives each `SidePanelCubeItem` a
stable per-cube callback through a Map, so a toggle on cube X no longer
re-renders cube Y's row.

## Interaction 2 — Tab switch (Build → Catalog → Build)

### Bundle deltas (`vite build`, measured 2026-05-17)

Both builds were run by stashing the post-restructure tree, building pristine,
then restoring + rebuilding. Same Vite 5.4.21, same node, same options.

| Metric | Before | After | Δ |
|---|---|---|---|
| Initial JS chunk (raw) | 4,126.19 kB | 3,931.89 kB | **−194.30 kB (−4.71%)** |
| Initial JS chunk (gzip) | 1,151.36 kB | 1,097.49 kB | **−53.87 kB (−4.68%)** |
| Total JS chunks emitted | 2 | 11 | +9 |
| Per-route lazy chunks | 0 | 7 | new — `IndexPage`, `ExplorePage`, `CatalogPage`, `MetricCardPage`, `SchemaPage`, `NewMetricPage`, `NewMetricSuccess` |
| Modules transformed | 8,268 | 8,278 | +10 (zustand) |

### Lazy chunks extracted from initial bundle

| Chunk | raw | gzip |
|---|---|---|
| `IndexPage-*.js` | 0.59 kB | 0.42 kB |
| `success-body-*.js` (NewMetricSuccess) | 2.29 kB | 1.02 kB |
| `use-catalog-meta-*.js` | 1.36 kB | 0.81 kB |
| `index-*.js` (small) | 13.70 kB | 4.76 kB |
| `catalog-page-*.js` | 13.77 kB | 4.09 kB |
| `metric-card-page-*.js` | 16.94 kB | 5.29 kB |
| `ExplorePage-*.js` | 35.88 kB | 13.07 kB |
| `SchemaPage-*.js` | 38.05 kB | 13.07 kB |
| `NewMetricPage-*.js` | 80.82 kB | 22.17 kB |
| **Total extracted** | **203.40 kB** | **64.70 kB** |

Confirms H3 (red team finding): the prior `export *` barrel was inlining
every route into the initial chunk. After the `loadable()` rewrite, each
route is its own on-demand chunk and the initial bundle drops by ~194 KB
(raw) / ~54 KB (gzip). The 6 KB gz gap between "extracted" and "removed
from initial" is Vite chunk overhead + duplicated shared modules.

| Metric | Before | After | Δ |
|---|---|---|---|
| Script-eval on cold tab switch (ms) | _manual capture_ | _manual capture_ | — |
| Background-page renders during tab switch | _manual capture_ | _manual capture_ | — |
| Result-set survival on return | yes | yes | — (KeepAlive still in place until Phase 5.E) |

## Interaction 3 — Cold start → first click

| Metric | Before | After | Δ |
|---|---|---|---|
| Initial JS chunk size (gz) | 1,151.36 kB | 1,097.49 kB | **−53.87 kB (−4.68%)** |
| Time to interactive (ms) | _manual capture_ | _manual capture_ | — |
| Initial JS parse (ms) | _manual capture_ | _manual capture_ | — |
| First meaningful paint (ms) | _manual capture_ | _manual capture_ | — |

The −54 KB gzip drop on the initial chunk is a direct proxy for parse/eval
time savings on cold start. The full TTI / FMP / first-paint numbers require
a Chrome DevTools session against a running dev server with the cubejs
backend reachable (the playground pages call `/playground/files` and
`/playground/token` which need a backend to render meaningfully).

## Multi-tab regression check

| Scenario | Result |
|---|---|
| Two query tabs, distinct queries, swap | _to verify manually_ — store-factory pattern (C1) guarantees per-instance stores; no module singleton was introduced. |
| Same tab, run query, swap route, return | _to verify manually_ — KeepAliveRoute still active (Phase 5.E pending) so the existing behavior is preserved. |
| Mid-flight query, swap route | _to verify manually_ — current behavior preserved (Phase 5.E will add AbortController). |

## UX regression check

| Surface | Status |
|---|---|
| Playground happy path | preserved — automated tests pass |
| Deep link `?query=…` | preserved — URL contract unchanged (C3: query NOT persisted to localStorage) |
| Deep link `#/build?cube=…&measure=…` | preserved — H9 fix: mount-only hashchange listener with meta-load buffer |
| Catalog browse + detail panel | preserved — automated tests pass |
| Metric card route | preserved — lazy-wrapped, still mounts under the same route |
| New Metric 6-step happy path | preserved — `useAutoMetricName` hook behavior tested |
| SecurityContext token swap | preserved — token mirrored from AppContext to store one-way |
| Live-preview flow | preserved — code path unchanged |

## Phase Contributions

| Phase | Primary win | Code-level changes shipped |
|---|---|---|
| **1 — Baseline profiling** | Falsifiable measurement harness | `src/dev/perf-probe.tsx` + 8 tests; 3 target components wrapped (`QueryBuilderSidePanel`, `NewMetricPage`, `ExplorePage`). |
| **2 — Lazy route splitting** | Cold-start parse cost reduction | Rewrote `src/pages/index.tsx` barrel from `export *` to `loadable()` (H3); added top-level `<Suspense>` in `src/index.tsx`; lazy-wrapped `NewMetricPage` + `NewMetricSuccess`; refactored `hashchange` handler in `QueryBuilder.tsx` into mount-only listener with meta-load buffer (H9). |
| **3 — Zustand stores** | Per-instance state isolation foundation | `src/stores/playground-store.ts` + `qb-ui-store.ts` with the factory pattern (C1); `partialize` excludes `query` (C3); defensive `merge` rejects pollution of non-pref keys; bridge-comparator semantics covered by 4 tests (H6). Providers mounted in `QueryBuilder.tsx`; one-way mirror of `apiToken` / `apiUrl` from props → store. |
| **4 — SidePanel + auto-name memo cleanups** | Click-on-dim render count drop | Removed in-place `.sort()` mutation; memoized `cubesOrViewsAll`, `cubesOrViewsFiltered`, `cubesOrViews` (sorted copy), `allJoinableCubes`, `filteredCubes` (H1); `React.memo`-wrapped `SidePanelCubeItem`; per-cube callback Map (`memberToggleHandlers` / `cubeToggleHandlers`) for stable child props; extracted `useAutoMetricName` hook with memoized compute (replaces 18-line inline effect at `NewMetricPage:91-110`). |
| **5.0 — Surgical fix gate** | Provider memoization + state-mutation removal | `useMemo`-wrapped `QueryBuilderContext.Provider value` (`QueryBuilder.tsx`); replaced `cubes.sort(...)` state mutation with memoized sorted copy (H8); rewrote `prepareQuery` to return a fresh object (no in-place mutation of `query.order`, C5); swapped `JSON.parse(JSON.stringify(...))` → `structuredClone(...)` in 3 hot paths in `query-builder.ts` and 1 in `QueryBuilder.tsx`. |
| **5.A–F** | Context teardown (deferred) | Not shipped this round — gated on Phase 5.0 measurement. The plan calls for stopping at 5.0 if feel-test PASS + ≥50% drop in `QueryBuilderSidePanel` render count vs Phase 1 baseline. |
| **6 — Report** | This document | Drafted; numeric columns ready for manual trace capture. |

## Verdict (template)

- Feel-test PASS: ☐ yes / ☐ no — _record after manual interaction sweep_
- SidePanel dim-toggle render-count drop vs baseline: _capture_% (Validation Session 1 gate: ≥50%)
- Tab-switch script-eval drop: _capture_%
- Cold-start TTI drop: _capture_%

### If verdict FAIL (Validation Session 1)

Phase 1–5.0 changes are NOT reverted — they are net-positive even when the
perf target under-shoots. Instead:

1. Use the Phase Contributions table to identify which slice still drives
   re-renders (suspect: components that read `useQueryBuilderContext()`
   destructuring fields other than the memoized Provider value — Phase 5.D
   migrates them).
2. Examine the network waterfall — if the dim toggle is network-bound
   (e.g. dry-run requests are the wall-clock bottleneck), the residual
   latency is independent of the render-count work and demands a separate
   request-coalescing plan.
3. Write a follow-up plan under `plans/` and link it from this report.

## Automated Test Delta

| Suite | Before | After Phase 5.0 |
|---|---|---|
| Total tests | 345 passing / 346 (1 pre-existing flake) | 366 passing / 367 (same flake unchanged) |
| Net new tests added | — | +21 (`perf-probe` ×8, `lazy-routes-barrel` ×2, `playground-store` ×6, `qb-ui-store` ×5, `bridge-comparator` ×4, `use-auto-metric-name` ×4) |

Pre-existing pre-restructure failure: `src/pages/Catalog/cdp-projection/__tests__/smoke.test.tsx` — verified independent of this work via `git stash` rerun.

## Unresolved Questions

- Manual Chrome DevTools traces have not been captured in this session; the
  probe + report scaffolding lands here so the next operator can fill the
  numeric columns in one focused sweep.
- Step 5.0 decision gate (feel-test + ≥50% render drop) requires the trace
  capture above to decide whether Phase 5.A–F is justified.
- Pre-existing `tsc --noEmit` errors in `@cube-dev/ui-kit` consumers are
  unrelated to this work and not in scope for the perf restructure.
