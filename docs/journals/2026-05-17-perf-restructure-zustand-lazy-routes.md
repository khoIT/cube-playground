# Perf Restructure — Zustand Stores, Lazy Routes, Provider Memo (Phases 1–5.0)

**Date**: 2026-05-17 22:50
**Severity**: Medium
**Component**: QueryBuilderV2 (context, side panel, new-metric wizard), src/pages (routing barrel), src/index.tsx (Suspense + KeepAlive)
**Status**: Phases 1–4 complete; Phase 5.0 surgical-fix complete; 5.A–F deferred behind gate

## What Shipped

Six-phase plan from `plans/260517-2330-perf-restructure-zustand-lazy-routes/` ran in `--auto`. Net result:

- **Phase 1**: Dev-only `<Profiler>` probe (`src/dev/perf-probe.tsx`) + 8 unit tests; 3 target components wrapped.
- **Phase 2**: Rewrote `src/pages/index.tsx` barrel from `export *` to `loadable()` lazy wrappers (the H3 red-team fix). Added top-level `<Suspense>` in `src/index.tsx`. Refactored the `hashchange` handler into a mount-only listener with a meta-load buffer (H9 race).
- **Phase 3**: `src/stores/playground-store.ts` + `qb-ui-store.ts` with the **factory pattern** (one store per `<QueryBuilder>` — C1 prevents multi-tab collapse). `partialize` excludes `query` and a defensive `merge` rejects pollution of non-pref keys (C3). Providers mounted around every QueryBuilder; one-way mirror of `apiToken`/`apiUrl`.
- **Phase 4**: Killed the in-place `cubesOrViews.sort()` in `QueryBuilderSidePanel`. Memoized every upstream array (`cubesOrViewsAll`, `cubesOrViewsFiltered`, sorted `cubesOrViews`, `allJoinableCubes`, `filteredCubes`). `React.memo`-wrapped `SidePanelCubeItem` and fed it per-cube stable callbacks via a Map so a toggle on cube X no longer re-renders cube Y. Extracted `useAutoMetricName` hook from a 18-line inline effect in `NewMetricPage`.
- **Phase 5.0 (surgical fix gate)**: `useMemo`-wrapped the `QueryBuilderContext.Provider value` (was a fresh literal each render — the headline cause of 80 consumers re-rendering on every external state change). Replaced `cubes.sort()` state-mutation with a memoized sorted copy (H8). Rewrote `prepareQuery` non-mutating (C5). Swapped `JSON.parse(JSON.stringify(...))` → `structuredClone(...)` in 4 hot paths.

**Test delta**: 345 → 367 (+22 new tests; 8 perf-probe, 2 lazy-barrel, 6 playground-store, 5 qb-ui-store, 4 bridge-comparator, 4 use-auto-metric-name). One pre-existing flake (`cdp-projection/smoke.test.tsx`) unchanged — verified independent via `git stash` rerun.

## Measured Outcome

Bundle delta via paired `vite build` runs (stash post-restructure → build pristine → pop stash → rebuild):

| Metric | Before | After | Δ |
|---|---|---|---|
| Initial JS chunk (gz) | 1,151.36 kB | 1,097.49 kB | **−53.87 kB (−4.68%)** |
| Initial JS chunk (raw) | 4,126.19 kB | 3,931.89 kB | −194.30 kB |
| Lazy route chunks | 0 | 7 | new |

That's the cold-start parse-cost reduction, proven not asserted.

## The Brutal Truth

The interaction-timing wins (dim-toggle render count, tab-switch ms) are **not measured**. The probe landed in Phase 1 but the actual snapshots need a Chrome DevTools session driven against a live cubejs backend — pages call `/playground/files` and `/playground/token` and won't render the side panel without one. So the headline "is the dim toggle actually faster?" question still has a `_manual capture_` placeholder in the report. The bundle number is honest data; the click-latency number is faith based on the code-level changes (memoed Provider value + stable per-cube callbacks + non-mutating sort).

Step 5.0 was set up explicitly as a decision gate: ship the surgical fix, measure, then decide whether the 1-week Phase 5.A–F context-teardown migration is even justified. Without the measurement we cannot trip the gate — which means Phase 5.A–F lives in a Schrödinger state.

The KeepAliveRoute is **still mounted**. Phase 5.E was meant to delete it, but it's gated on promoting `cubeApi` + `mutexRef` into the store with AbortController support — work that nobody touched this round. KeepAlive will continue to keep every visited page mounted in the background until that lands.

There's also a TypeScript reality check: `npm run build` fails on **pre-existing** `tsc --noEmit` errors in `@cube-dev/ui-kit` consumers (`TimeDateSelector`, `ValuesInput`, `Options`, several others). We worked around it by running `npx vite build` directly. Unrelated to perf work, but it means the build pipeline has been broken before this session and nobody fixed it.

## How to Improve Further

1. **Capture the manual numbers.** Spin up local cubejs, follow `perf-baseline.md` interaction scripts on pre-restructure HEAD (manually checked out) AND current HEAD. Snapshot `window.__perfCounts`. Fill in the `_manual capture_` columns in `perf-before-vs-after.md`. Without this, the Step 5.0 gate can't trip.

2. **Decide Phase 5.A–F.** Once (1) is done: if the dim-toggle render count dropped ≥50% from baseline, kill the rest of Phase 5. If it didn't, the Provider memo wasn't enough and we need the slice-selector migration on all 80 consumer sites.

3. **CI bundle-size budget.** The `vite build` output is a CI-friendly number. Adding a budget assertion (e.g. fail PR if initial-chunk gz > 1,100 kB) would prevent regressions silently re-inflating the chunk. The `tsc --noEmit && vite build` pipeline needs the pre-existing ts errors fixed before this can be a green CI gate.

4. **Visualize the probe output.** Right now `window.__perfCounts` is a console blob. A 30-line dev-only overlay (rendered when `import.meta.env.DEV` and `?perf=1` is in the URL) showing live commit counts per probe-id would make "is this actually faster?" answerable in 5 seconds during local interaction instead of requiring DevTools choreography.

5. **Backfill the H9 hashchange test.** Phase 2 documented the buffer logic but the test was scoped to barrel-structure only (full QueryBuilder render is too heavy in jsdom). Extracting the buffer into a tiny hook would make it directly testable without rendering the whole tree.

6. **Pre-existing tsc errors.** Out of scope here, but they're blocking `npm run build` from being usable. Worth a separate `/fix --auto` pass on the `@cube-dev/ui-kit` prop-type drift.

## Files Touched

**Created (10)**: `src/dev/perf-probe.tsx` + test, `src/stores/{playground-store,qb-ui-store,index}.ts` + 3 tests, `src/pages/__tests__/lazy-routes-barrel.test.tsx`, `src/QueryBuilderV2/NewMetric/full-page/hooks/use-auto-metric-name.ts` + test, plan docs under `plans/260517-2330-perf-restructure-zustand-lazy-routes/`.

**Modified (10)**: `src/index.tsx`, `src/pages/index.tsx`, `src/pages/Explore/ExplorePage.tsx`, `src/QueryBuilderV2/{QueryBuilder,QueryBuilderSidePanel}.tsx`, `src/QueryBuilderV2/components/SidePanelCubeItem.tsx`, `src/QueryBuilderV2/hooks/query-builder.ts`, `src/QueryBuilderV2/utils/prepare-query.tsx`, `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx`, `package.json` (+ `zustand@5.0.13`).

## Unresolved

- Manual Chrome trace capture for the three pain interactions.
- Phase 5.0 decision gate (waiting on the above).
- Pre-existing tsc errors in `@cube-dev/ui-kit` consumers (out of scope but blocks `npm run build`).
- Branch ambiguity: session-start git status reported `segment_dimension` but current branch is `main` (no checkout happened in this session — possibly a pre-existing branch identity issue).
