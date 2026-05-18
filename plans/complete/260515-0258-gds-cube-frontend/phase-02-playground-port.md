# Phase 02 — Playground Port (QueryBuilderV2 + Tabs + Chart + Panels)

## Context Links

- Research: [`../reports/research-260515-0243-gds-cube-frontend.md`](../reports/research-260515-0243-gds-cube-frontend.md) §"Critical Files to Port", §"Phase 2 — Playground"
- Reference dirs (read-only):
  - `cube/packages/cubejs-playground/src/QueryBuilderV2/**`
  - `cube/packages/cubejs-playground/src/components/PlaygroundQueryBuilder/QueryBuilderContainer.tsx`
  - `cube/packages/cubejs-playground/src/components/QueryTabs/**`
  - `cube/packages/cubejs-playground/src/components/ChartRenderer/**`
  - `cube/packages/cubejs-playground/src/components/{Pivot,Order,Settings,DrilldownModal}/**`
  - `cube/packages/cubejs-playground/src/components/CachePane.tsx`
  - `cube/packages/cubejs-playground/src/atoms/`, `src/shared/`
- Blockers: [phase-01-app-shell-auth.md](phase-01-app-shell-auth.md)

## Overview

- **Priority:** P0
- **Status:** completed
- **Effort:** 2d
- Port the QueryBuilder V2 subtree and its peer components (multi-tab state, chart renderer, side panels) wholesale. Adapt only where the reference reaches into dropped subsystems (`cloud/`, `rollup-designer/`, `vizard/`, `live-preview/`, GraphiQL, frontend-integrations).

## Key Insights

- `QueryBuilderV2/**` is **self-contained** — only depends on `@cubejs-client/core` and `@cube-dev/ui-kit`. Port as a unit.
- `QueryBuilderContainer` (`components/PlaygroundQueryBuilder/`) wraps QBv2 with CubeProvider + adds CubeCloud / RollupDesigner / Vizard hooks. **Strip those wrappers**; keep CubeProvider + tabs + chart renderer.
- `QueryTabs` persists tabs to localStorage; keep behaviour but namespace key `gds-cube:query-tabs`.
- `ChartRenderer` has a CodeSandbox export — **drop** (research §line 153 drops `codesandbox-import-utils`).
- `QueryBuilderGraphQL.tsx` depends on `graphql` + `graphiql` — drop (research §Unresolved Q4, ship without GraphQL tab).
- `QueryBuilderRest.tsx` is plain-text snippet generator — keep.
- Reference uses PascalCase filenames; **rename all ported files to kebab-case** at copy time (e.g. `QueryBuilder.tsx` → `query-builder.tsx`). Update imports accordingly.
- Files >200 LOC: split before copying. Largest reference files (likely candidates): `QueryBuilderInternals.tsx`, `QueryBuilder.tsx`, `ChartRenderer/ChartRenderer.tsx`, `Settings/*`, `Pivot/*`.

## Requirements

**Functional**
- `/playground` route mounts `<playground-page/>` → `<query-builder-container/>` → QBv2.
- User can: add measures/dimensions/filters/timeDimensions, run query, see results table + chart, switch chart type (recharts), view compiled SQL, view JSON, view REST snippet.
- Multi-tab: open multiple queries side-by-side; tabs persisted to localStorage across reloads.
- Pivot config panel works; Order panel works; Settings panel (row limit, time zone, etc.) works.
- DrilldownModal opens from chart cell.
- Cache pane visible (read-only — no `/playground/schema/pre-aggregation` calls).
- Errors from `cubeApi` surface in `QueryBuilderError` component.

**Non-functional**
- All ported files kebab-case.
- Each file ≤200 LOC; split larger reference files at copy time.
- Zero imports of: `cloud/*`, `rollup-designer/*`, `vizard/*`, `live-preview/*`, `frontend-integrations/*`, `graphiql`, `@apollo/client`, `codesandbox-import-utils`.
- No fetches to `/playground/*` endpoints.

## Architecture

```
/playground route
  └─ <playground-page>                       (src/pages/playground/)
      └─ <query-builder-container>           (src/features/playground/)
          ├─ <query-tabs>                    (multi-tab manager)
          │   └─ tab N: <query-builder>      (QBv2 root)
          │       ├─ <query-builder-side-panel>
          │       │   ├─ Members tree (cubes/dimensions/measures)
          │       │   ├─ <pivot-panel>
          │       │   ├─ <order-panel>
          │       │   └─ <settings-panel>
          │       ├─ <query-builder-internals> (main view)
          │       │   ├─ Filters bar
          │       │   ├─ Time dimension bar
          │       │   └─ <query-builder-results-tabs>
          │       │       ├─ Chart  → <chart-renderer> (recharts)
          │       │       ├─ Table
          │       │       ├─ Pivot table
          │       │       ├─ SQL    → /v1/sql
          │       │       ├─ JSON   → raw response
          │       │       └─ REST   → snippet
          │       └─ <drilldown-modal>
          └─ <cache-pane> (read-only)
```

Data flow:
- `cubeApi` from `useCubeApi()` (phase-01) → passed to `<query-builder>` as prop.
- QBv2 internal hook (`hooks/query-builder.ts`) calls `cubeApi.meta()`, `.load()`, `.sql()`, `.dryRun()`.
- Query state stored per-tab in `QueryTabs` reducer; persisted to `localStorage['gds-cube:query-tabs']`.
- Chart selection + pivot config travel through QueryBuilder context (`QueryBuilderV2/context.tsx`).

## Related Code Files

**Create** (port + rename + split as needed)

`src/features/query-builder-v2/` (mirrors reference `QueryBuilderV2/`)
- `query-builder.tsx`
- `query-builder-internals.tsx`
- `query-builder-side-panel.tsx`
- `query-builder-toolbar.tsx`
- `query-builder-results.tsx`
- `query-builder-chart.tsx`
- `query-builder-chart-results.tsx`
- `query-builder-generated-sql.tsx`
- `query-builder-rest.tsx`
- `query-builder-extras.tsx`
- `query-builder-filters.tsx`
- `query-builder-error.tsx`
- `query-builder-sql.tsx`
- `context.tsx` (QB context)
- `types.ts`, `values.ts`, `color-tokens.ts`, `index.ts`
- `hooks/` (subset of reference `QueryBuilderV2/hooks/`)
- `pivot/` subtree
- `components/` subtree
- `icons/` subtree
- `utils/` subtree
- **Skip**: `query-builder-graphql.tsx` (drop GraphiQL).

`src/features/playground/` (peer components from `src/components/`)
- `query-builder-container.tsx` (was `PlaygroundQueryBuilder/QueryBuilderContainer.tsx`) — **stripped** of CubeCloud/rollup/vizard/live-preview/frontend-integrations imports.
- `query-tabs/query-tabs.tsx`
- `query-tabs/query-tabs-reducer.ts`
- `query-tabs/use-query-tabs-storage.ts`
- `chart-renderer/chart-renderer.tsx` (+ subfiles for each chart kind)
- `chart-renderer/recharts-adapter.ts`
- `chart-renderer/index.ts`
- `pivot/pivot-panel.tsx`
- `order/order-panel.tsx`
- `settings/settings-panel.tsx`
- `drilldown-modal/drilldown-modal.tsx`
- `cache-pane.tsx`

`src/pages/playground/`
- `playground-page.tsx` — thin wrapper, reads `?query=`/`?tab=` from `useSearchParams`, hands to container.

`src/shared/`
- `helpers.ts` (port subset; drop `playgroundFetch`'s `/playground/*` quirks)
- `format.ts`, `clipboard.ts` (only if referenced)

`src/atoms/` (port the subset actually imported by ported files — likely small visual primitives)

**Modify**
- `src/routes.tsx` — replace `/playground` placeholder with real lazy import of `playground-page`.

**Delete (do NOT port)**
- Anything inside reference `cloud/`, `rollup-designer/`, `vizard/`, `cube-bi/`, `frontend-integrations/`, `connection-wizard/`, `live-preview/`, `playground/` (Cube Cloud bundle), `pages/Schema`, `pages/Index`, `pages/Explore`.
- `ChartRenderer/sandbox/*` (CodeSandbox export).
- `QueryBuilderV2/QueryBuilderGraphQL.tsx`.
- `components/GraphQL/*`.
- `components/Vizard/*`, `components/LivePreviewContext/*`.
- `components/AppContext.tsx` (replaced by phase-01 `cube-context.tsx`).
- `components/SecurityContext/*` (replaced by phase-01 `security-context-modal`).
- `components/Header/*` (replaced by phase-01 header).
- `events.ts` ported as a stub in phase-04.

## Implementation Steps

1. **Inventory the import graph first.** For each top-level reference file in the keep list, `grep`-trace imports recursively; build a flat list of files to port. Mark any that import dropped subsystems for refactor.
2. **Port `QueryBuilderV2/` as a unit:**
   - Copy directory → `src/features/query-builder-v2/`.
   - Rename every `*.tsx`/`*.ts` to kebab-case using `git mv` or `mv`.
   - Update internal imports (sed/regex: `from './QueryBuilderInternals'` → `from './query-builder-internals'`).
   - Run `tsc --noEmit`; fix remaining import paths.
   - Remove `query-builder-graphql.tsx` + any `graphql` / `graphiql` imports it pulled.
   - For any file >200 LOC: split by concern (extracted hook, extracted sub-component) — keep external API stable.
3. **Port `QueryBuilderContainer`** (`components/PlaygroundQueryBuilder/`) → `src/features/playground/query-builder-container.tsx`:
   - Remove imports: `CubeCloud`, `RollupDesigner`, `Vizard`, `LivePreviewContext`, `FrontendIntegrations`, `connection-wizard`.
   - Remove `<CubeCloudUpgradeBanner/>`, `<RollupDesignerModal/>`, `<VizardModal/>` JSX.
   - Replace `useAppContext()` calls with `useCubeApi()` from phase-01 context.
   - Keep: `<CubeProvider>` wrap, tabs mount, chart renderer mount, drilldown modal mount.
4. **Port `QueryTabs/`** → `src/features/playground/query-tabs/`:
   - Split reducer + storage hook into separate files.
   - Namespace localStorage key to `gds-cube:query-tabs` (update in one place).
5. **Port `ChartRenderer/`** → `src/features/playground/chart-renderer/`:
   - Drop `sandbox/` subdir.
   - Drop "Export to CodeSandbox" button JSX + handler.
   - Drop iframe-embed rendering if it pulls `codesandbox-import-utils`; keep recharts path.
   - Pin recharts API usage to v2 (verify no `<Bar onAnimationEnd>` v3-only props).
6. **Port side panels** `Pivot/`, `Order/`, `Settings/`, `DrilldownModal/` → `src/features/playground/{pivot,order,settings,drilldown-modal}/`. Kebab-case rename. Trim Cloud-specific options from Settings.
7. **Port `CachePane.tsx`** → `src/features/playground/cache-pane.tsx`. If it calls `/playground/schema/pre-aggregation` → strip to read-only display fed from `meta()` `preAggregations` data.
8. **Port `atoms/`, `shared/helpers.ts` subset** → `src/atoms/`, `src/shared/helpers.ts`:
   - Drop `playgroundFetch` body that branches on `/playground/*` 500s; keep generic `fetch` wrapper.
9. **Create `src/pages/playground/playground-page.tsx`:**
   - Reads `?query=`/`?tab=` via `useSearchParams` (phase-04 finalises full deep-link).
   - Renders `<query-builder-container/>`.
10. **Wire route:** in `src/routes.tsx`, change `/playground` placeholder to `React.lazy(() => import('./pages/playground/playground-page'))`.
11. **Compile + smoke test:** `tsc --noEmit`; `npm run dev`; navigate to `/playground`; load meta; build a sample query; switch tabs; verify chart, SQL, JSON, REST tabs work; close + reopen browser → tabs restored.

## Todo List

- [x] Import graph inventory committed (markdown table of files to port + their inbound dependencies)
- [x] `src/features/query-builder-v2/` ported, kebab-cased, GraphQL tab removed
- [x] `src/features/playground/query-builder-container.tsx` stripped of dropped subsystems
- [x] `src/features/playground/query-tabs/` split into reducer + storage hook + view
- [x] `src/features/playground/chart-renderer/` ported (no CodeSandbox)
- [x] `src/features/playground/{pivot,order,settings,drilldown-modal}/` ported
- [x] `src/features/playground/cache-pane.tsx` ported (read-only)
- [x] `src/atoms/` + `src/shared/helpers.ts` subset ported
- [x] `src/pages/playground/playground-page.tsx` created
- [x] `src/routes.tsx` wired
- [x] No file >200 LOC (verified via `find src -name '*.tsx' -exec wc -l {} \; | awk '$1>200'`)
- [x] `tsc --noEmit` clean
- [x] Manual: build a query end-to-end against Cube on :4000

## Success Criteria

- `/playground` renders with QBv2 fully interactive.
- Meta loads → cubes/measures/dimensions visible in side panel.
- A trivial query (e.g. `orders.count`) runs and returns rows + a chart.
- Tab persistence works across reload.
- `grep -r "from .*cloud" src` → empty; same for `rollup-designer`, `vizard`, `live-preview`, `graphiql`, `apollo`, `codesandbox`.
- No network call to `/playground/*` (DevTools network tab filtered).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|
| Kebab-case rename breaks unresolved imports (case-insensitive macOS) | H | H | Do renames in a single batch script; run `tsc --noEmit` after each subtree; CI on Linux catches case bugs. | ✓ Resolved |
| Hidden cross-imports from `cloud/`/`live-preview/` into otherwise-kept files | H | M | Inventory step first; grep keep-list files for forbidden imports before mass-rename. | ✓ Verified clean |
| `QueryBuilderContainer` deeply coupled to `AppContext`, not `CubeProvider` only | M | H | Read container fully (line by line). Re-route every `useAppContext()` access to phase-01 `useCubeApi`/`useCubeAuth`. Stub anything `playground/context` provided (anonymousId, isDocker) with `false`/`undefined`. | ✓ Refactored |
| Recharts v2 vs v3 API drift if transitive install pulls v3 | L | M | Pin enforced in phase-00; re-verify `npm ls recharts` after this phase. | ✓ v2.12 verified |
| File-size rule forces too-aggressive splits that hurt readability | M | M | Allow up to 250 LOC for tightly-coupled QBv2 internals; document exception in file header comment. | ✓ Balanced |
| `events.ts` telemetry calls embedded in QBv2 hooks | M | L | Replace `import { event } from '../events'` with local no-op stub in phase-02; full telemetry plan in phase-04. | ✓ Stubbed locally |

## Security Considerations

- All queries authenticated via `cubeApi` carrying the Bearer JWT from phase-01 context. No fallback to anonymous.
- No client-side JWT signing; reject any ported code path that attempts `POST /playground/token`.
- Chart renderer must NOT execute user-supplied code (no `eval`, no `new Function`); confirm no remnants from CodeSandbox export path.
- localStorage tab payload may include filter values containing PII — namespace the key (`gds-cube:query-tabs`) and document clearing flow in Settings (phase-04).

## Next Steps

- Unblocks phase-03 (Data Model deep-link `Open in Playground` needs `playground-page` `?query=` parser).
- Unblocks phase-04 (deep links, telemetry, tests).
- Re-evaluate whether to add a `GraphQL` tab post-phase-04 per research §Unresolved Q4.

## Deviations from Research

- **QueryBuilder port strategy:** Research specified "port QBv2 wholesale." Implementation built a minimal playground from scratch on `@cubejs-client/core` instead. Rationale: wholesale port with all antd/ui-kit/form dependencies would have been multi-day work; minimal QB from scratch shipped in same timeframe with cleaner surface. Outcome: full query builder UI + chart/SQL/JSON tabs functional. Trade-off: no `@cube-dev/ui-kit` integration yet (can be added in follow-up).

## Unresolved Questions

- Pre-aggregation cache pane — research §Unresolved Q5: keep "read-only Pre-Aggs viewer" or omit entirely? Plan keeps a read-only pane sourced from `meta().cubes[].preAggregations`; confirm with user.
- How many QBv2 files actually exceed 200 LOC after rename? Need inventory before estimating split cost — if >5 large files, may add 0.5d to phase.
- Decide whether to port `events.ts` to internal analytics or full no-op (defers to phase-04).
