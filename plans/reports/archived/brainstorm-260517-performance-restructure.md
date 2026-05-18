# Brainstorm — Cube Playground Performance Restructure

**Date:** 2026-05-17
**Status:** Approved by user, ready for `/ck:plan`
**Constraint:** UX is untouched. Internal/architectural changes only.

---

## Problem statement

After recent feature work, the app feels sluggish on three interactions:

1. Clicking a dimension or measure in the Query Builder side panel.
2. Switching between top-nav tabs: Playground / New Metric / Catalog.
3. (Implied) cold first-paint feels heavier than it should.

User wants a full restructure with profiling-first measurement.

## Requirements

| # | Requirement |
|---|---|
| Output | Faster perceived response on the three interactions; identical UX surface. |
| Acceptance | Feel test against profiling baseline captured in Phase 0. No numeric SLA. |
| Scope IN | KeepAliveRoute removal, lazy routes, Zustand store, QueryBuilderContext teardown, SidePanel + NewMetricPage memo cleanups. |
| Scope OUT | Antd 4→5, design-system consolidation, recharts swap, i18n slimming, server-side meta caching. |
| Non-negotiable | UX untouched. URL contract preserved. `/playground/*` shims preserved. State survives tab switch (mandatory — currently provided by KeepAliveRoute). |

## Root-cause analysis (from scout)

| Symptom | Root cause | Evidence |
|---|---|---|
| Dim/measure click lag | `QueryBuilderContext.Provider value` is a fresh object every render → 80+ consumers re-render on every state change | `src/QueryBuilderV2/QueryBuilder.tsx:181` (no useMemo on value) |
| Same | `useQueryBuilder` returns `JSON.parse(JSON.stringify(query))` every render — full deep clone | `src/QueryBuilderV2/hooks/query-builder.ts:1400` |
| Same | SidePanel in-place `.sort()` + incomplete `useMemo` deps | `QueryBuilderSidePanel.tsx:129, 395` |
| Tab-switch lag | KeepAliveRoute mounts every visited page forever; cross-cutting state changes re-render background trees | `src/index.tsx:53` |
| Cold start | No `React.lazy`. antd + recharts + graphiql + prismjs + flexsearch + react-beautiful-dnd + cube-ui-kit all in initial chunk | `src/index.tsx`, `package.json` |
| Step-edit lag in New Metric | Single 500-line function holds all 6 steps inline | `NewMetricPage.tsx` |

## Approaches evaluated

| Option | Notes | Decision |
|---|---|---|
| Surgical fixes only (memoize value, kill clone) | ~80% of click latency, ~0% of tab-switch latency. Cheap but leaves the structural issues in place. | Rejected — user picked full restructure. |
| Lazy routes only | Fixes tab-switch + cold start, leaves click latency. | Subsumed into Phase 1. |
| Drop KeepAlive | Required to make lazy routes useful — but loses state without a store. | Subsumed into Phase 2. |
| use-context-selector | Smallest code diff for the QB problem, but doesn't help with the deep-clone allocation or the 1473-line hook. | Rejected. |
| Split into multiple Contexts | No new dep, but every consumer still edits. Doesn't fix allocation. | Rejected. |
| Zustand store + selector subscriptions | Removes the Provider re-render problem outright; selectors are per-slice; store lives outside React tree → KeepAlive's job done implicitly. | **Picked.** |
| Jotai | Atomic, more surface area to learn, higher migration cost. | Rejected for now. |

## Chosen design — 5 phases

### Phase 0 — Baseline profiling

- Wrap `QueryBuilderSidePanel`, `NewMetricPage`, `ExplorePage` with `<Profiler>` for one session.
- Capture three Chrome Performance traces: cold load → first click; QB dim toggle; tab switch Build → Catalog → Build.
- Capture React DevTools Profiler ranked view of one dim toggle.
- Output: `plans/<plan-dir>/reports/perf-baseline.md` — 3 traces + render-count table.

### Phase 1 — Route-level code split

- Replace `KeepAliveRoute` with `React.lazy` + `Suspense` for `/build`, `/metrics/new`, `/catalog`, `/metric/:cube/:member`.
- Each route → its own chunk; background routes stop running.
- Route-level fallback: existing `<CubeLoader />`.
- `App` shell unchanged.

### Phase 2 — Zustand stores

- `src/stores/playground-store.ts` — query state, executed query, result set, sql, durations, chart type, pivot, api token/url.
  - `persist` middleware on **query state only** (localStorage); result set stays in-memory (store lives outside React tree, so it survives unmount — replicates KeepAlive's UX exactly without quota risk).
- `src/stores/qb-ui-store.ts` — side-panel openCubes, viewMode, filterString, scrollToCubeName.
- `ExplorePage` wired to selectors.
- After this phase: KeepAliveRoute removable safely; UX identical.

### Phase 4 (run before 3) — Targeted memo cleanups

Deliberately before Phase 3 to validate plumbing under load before the 80-consumer migration.

- `QueryBuilderSidePanel.tsx`:
  - replace in-place `.sort()` with `[...arr].sort()`.
  - fix `cubeList` `useMemo` deps.
  - extract `SidePanelCubeItem` rendering as memoized child subscribing to its own cube slice via Zustand selector.
- `NewMetricPage.tsx`:
  - split per-step into `Step1Source`, `Step2Operation`, `Step3Column`, `Step4Filters`, `Step5Identity`, `Step6TestRun`.
  - shell owns only `step` + `draft`.
  - mount only active step.
- `React.memo` + stable callbacks: `SidePanelCubeItem`, `MemberSection`, `Folder`, `ListMemberButton`.

### Phase 3 — QueryBuilderContext teardown (file-by-file)

- Stop deep-cloning `query` in `useQueryBuilder` (line 1400) — `Object.freeze` in dev + read-only type. Drop the `JSON.parse(JSON.stringify)`.
- Move QB state into the Zustand store from Phase 2.
- Keep a thin `useQueryBuilderContext()` shim mapped onto the store so consumers migrate one file at a time, one PR each.
- Split `query-builder.ts` (1473 lines) into:
  - `meta.ts` — meta fetch + parsing.
  - `query-state.ts` — query mutations.
  - `results.ts` — load/run/sql.
  - `derived.ts` — `members`, `queryStats`, `joinable*`.
- 40 files / 80+ call sites migrated incrementally. Strict file-by-file PRs to catch regressions cheaply.

## Order

`0 → 1 → 2 → 4 → 3`. Phase 4 before Phase 3 is deliberate — fixes the most visible hot spots quickly and validates the store plumbing before the big migration.

## Touchpoints

| File | Phase | Change |
|---|---|---|
| `src/index.tsx` | 1 | Replace KeepAliveRoute with React.lazy + Suspense. |
| `src/App.tsx` | — | No change. |
| `src/QueryBuilderV2/QueryBuilder.tsx` | 3 | Remove Provider; selectors. |
| `src/QueryBuilderV2/hooks/query-builder.ts` | 3 | Split, drop clone. |
| `src/QueryBuilderV2/context.tsx` | 3 | Replace with selector hooks (shim). |
| `src/QueryBuilderV2/QueryBuilderSidePanel.tsx` | 4 | memo + dep fix + sort fix. |
| `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx` | 4 | Per-step split. |
| `src/stores/playground-store.ts` | 2 | New. |
| `src/stores/qb-ui-store.ts` | 2 | New. |

## Preserved verbatim (UX-untouched contract)

- URL contract: `?query=…`, `#/build?cube=…&measure=…&time=…&range=…`.
- `hashchange` deep-link handler (`QueryBuilder.tsx:116`).
- `/playground/context` + `/playground/token` shims (`App.tsx`, `index.tsx`).
- KeepAliveRoute's *visible* behavior — result set, executed query, SQL, durations all survive tab switch (now via store).
- antd + cube-ui-kit + styled-components + react-aria markup. No design-system swap.
- i18n, theme, SecurityContext providers in `index.tsx`.

## Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | 80-consumer context migration could regress niche QB flows | Phase 3 file-by-file PRs; shim keeps old API. |
| R2 | "Feel test" acceptance lets a regression slip | Phase 0 profiles + render counts give a quiet baseline to check at end of each phase. |
| R3 | Result set kept in-memory in Zustand store survives tab switch as expected, but is lost on full reload | Same as today — KeepAliveRoute already loses state on reload. UX unchanged. |
| R4 | KeepAliveRoute has a rationale I missed | Re-read `docs/journals/2026-05-17-new-metric-fullpage-rebuild.md` during planning. |
| R5 | Code-split chunks add a flicker on tab switch | Route-level Suspense fallback = `<CubeLoader />` matches App's existing loader. |
| R6 | `JSON.parse(JSON.stringify(query))` removal may expose downstream mutation bugs the clone was masking | `Object.freeze(query)` in dev; tests should catch mutation attempts. |

## Success criteria

- Subjective feel-test PASS on the three pain interactions.
- Phase 0 profile re-run after each phase shows the render-count or interaction-time trending down (informational only, not gating).
- No UX regression — visual diff, navigation, URL, state-survives-tab-switch all identical.
- Bundle size: initial chunk smaller (informational).

## Next steps

1. Run `/ck:plan` (or `/ck:plan --tdd` for the QB migration phases) and pass this report as the brainstorm summary.
2. Plan should produce one phase file per phase above.
3. Phase 0 must run first and produce `perf-baseline.md` before any code change.

## Unresolved questions

- None blocking. R4 (KeepAliveRoute rationale) to verify during planning, not blocking.
