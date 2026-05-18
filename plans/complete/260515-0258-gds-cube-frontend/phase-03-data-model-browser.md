# Phase 03 — Data Model Browser (meta-driven)

## Context Links

- Research: [`../reports/research-260515-0243-gds-cube-frontend.md`](../reports/research-260515-0243-gds-cube-frontend.md) §"Data Model Feature — Pragmatic Rewrite", §"Phase 3 — Data Model browser"
- Reference (study only — do NOT port `SchemaPage`):
  - `cube/packages/cubejs-playground/src/pages/Schema/SchemaPage.tsx` (dev-only, dropped)
  - `cube/packages/cubejs-playground/src/QueryBuilderV2/hooks/query-builder.ts` ~ line 332 — meta parsing logic to extract
- Blockers: [phase-01-app-shell-auth.md](phase-01-app-shell-auth.md), [phase-02-playground-port.md](phase-02-playground-port.md) (for "Open in Playground" deep link target).

## Overview

- **Priority:** P1
- **Status:** completed
- **Effort:** 1d
- Replace dev-only `SchemaPage` with a read-only browser of `cubeApi.meta()` output. Tree of cubes & views in sidebar; detail panel with tabs (Members, Joins, Pre-aggregations, Raw JSON). Each member offers "Open in Playground" → deep link.

## Key Insights

- `/cubejs-api/v1/meta` is always available (not dev-only). Single endpoint covers full feature.
- `meta.cubes[i].type === 'view' | 'cube'` available since Cube ≥ 0.32; for older servers treat all as cubes (fallback in hook).
- YAML/raw file content is **not** in meta (lives behind `/playground/files`, dropped). Detail page renders structured info — strictly richer than raw YAML.
- Member shapes inside a cube: `measures[]`, `dimensions[]`, `segments[]`, `preAggregations` (may be undefined), `nestedAlias`, `joins` (sometimes derived; see ref hook).
- Parser logic already in reference `QueryBuilderV2/hooks/query-builder.ts:~332`. Extract into reusable `use-meta.ts` hook so QBv2 + Data Model browser share one source of truth.

## Requirements

**Functional**
- `/data-model` route lists all cubes + views in a sidebar tree, grouped (`Cubes`, `Views`).
- Search box filters tree (substring match on name + title).
- Selecting a cube/view navigates to `/data-model/:cubeName` and renders detail.
- Detail tabs:
  1. **Members** — three subsections: Measures, Dimensions, Segments. Each row: name, type, format, public flag, description, raw SQL (read-only).
  2. **Joins** — list of joined cubes with relationship type.
  3. **Pre-aggregations** — list of pre-aggregations (if present).
  4. **Raw JSON** — pretty-printed JSON of the cube's meta entry.
- "Open in Playground" button on cube/view → navigates to `/playground?query=<encoded-json>` with prefill (default `{ measures: ['<cube>.count'] }` if a `count` measure exists, else first measure; falls back to first dimension).
- Empty state: if `meta()` returns no cubes → friendly message + retry button.
- Error state: if `meta()` fails (401/network) → show error + link to API Settings modal.

**Non-functional**
- All files kebab-case, ≤200 LOC.
- One network call: `cubeApi.meta()` cached for session via React state in hook (refresh button explicit).
- TS strict; full typings reused from `@cubejs-client/core` `Meta` type where possible.

## Architecture

```
/data-model
  └─ <data-model-page>
      ├─ <data-model-sidebar>          (tree + search)
      │   ├─ search input
      │   ├─ <cube-tree-node>          (Cubes group)
      │   └─ <cube-tree-node>          (Views group)
      └─ <Outlet/>                     (renders nothing if no :cubeName)
                                       (renders <cube-detail/> if :cubeName)
/data-model/:cubeName
  └─ <cube-detail>
      ├─ header (name, title, description, type badge)
      ├─ <open-in-playground-button>
      └─ <ant-tabs>
          ├─ Members → <members-tab>
          ├─ Joins   → <joins-tab>
          ├─ Pre-aggregations → <pre-aggregations-tab>
          └─ Raw JSON → <raw-json-tab>
```

Data flow:
```
useCubeApi()                                       (phase-01 context)
   │
   ▼
useMeta()  ─► state { cubes, views, byName, loading, error, refetch }
   │           cached in component state; one call per mount
   │
   ├─► <data-model-sidebar>  reads cubes + views, renders tree, filters by search
   └─► <cube-detail>         reads byName[params.cubeName], renders tabs

<open-in-playground-button>
   on click → const q = buildSeedQuery(cube)
            → navigate(`/playground?query=${encodeURIComponent(JSON.stringify(q))}`)
```

`buildSeedQuery(cube)`:
- if `cube.measures` includes one named `*.count` → `{ measures: [<that>] }`
- else if any measure → `{ measures: [<first>] }`
- else if any dimension → `{ dimensions: [<first>] }`
- else `{}` (empty — playground opens blank tab for that cube)

## Related Code Files

**Create**
- `src/hooks/use-meta.ts` — wraps `cubeApi.meta()`, returns `{ cubes, views, byName, loading, error, refetch }`. Handles `type` fallback. ≤120 LOC.
- `src/hooks/use-meta.types.ts` — local `CubeMeta`, `ViewMeta`, `MemberMeta` typing (re-exports/refines `@cubejs-client/core` `Meta`).
- `src/pages/data-model/data-model-page.tsx` — layout (sidebar + outlet). ≤150 LOC.
- `src/pages/data-model/data-model-sidebar.tsx` — tree + search. ≤180 LOC.
- `src/pages/data-model/cube-tree-node.tsx` — single node renderer.
- `src/pages/data-model/cube-detail.tsx` — detail wrapper + tab host. ≤180 LOC.
- `src/pages/data-model/tabs/members-tab.tsx`
- `src/pages/data-model/tabs/joins-tab.tsx`
- `src/pages/data-model/tabs/pre-aggregations-tab.tsx`
- `src/pages/data-model/tabs/raw-json-tab.tsx`
- `src/pages/data-model/open-in-playground-button.tsx`
- `src/pages/data-model/build-seed-query.ts` — pure fn + unit-testable.
- `src/pages/data-model/data-model-empty-state.tsx`
- `src/pages/data-model/data-model-error-state.tsx`

**Modify**
- `src/routes.tsx` — add real lazy imports for `/data-model` and `/data-model/:cubeName` (replace placeholder); nest `:cubeName` under `/data-model` so sidebar stays mounted.

**Delete** — none (no ported reference code in this phase).

## Implementation Steps

1. Implement `src/hooks/use-meta.ts`:
   - `useCubeApi()` → if absent, return `{ loading: true }`.
   - `useEffect` on `cubeApi` identity: `cubeApi.meta().then(m => …)`.
   - Normalise: `const all = m.meta?.cubes ?? []`.
   - Partition: `cubes = all.filter(c => c.type !== 'view')`, `views = all.filter(c => c.type === 'view')`.
   - `byName = Object.fromEntries(all.map(c => [c.name, c]))`.
   - Expose `refetch()` that resets state + re-calls.
2. Implement `src/pages/data-model/build-seed-query.ts` (pure fn, deterministic — easy vitest target in phase-04).
3. Implement `data-model-page.tsx` with React-Router v6 nested routes:
   - Layout: `<div className="flex">` → sidebar (fixed width) + main `<Outlet/>`.
   - Wrap in `<use-meta-provider>` if multiple consumers per page (else call `useMeta()` once and pass cubes/views via context-lite or props).
4. Implement `data-model-sidebar.tsx`:
   - Antd `Input.Search` controlled.
   - Group headers "Cubes (N)", "Views (N)".
   - Each node is `<cube-tree-node>` → `<NavLink to={'/data-model/' + cube.name}>`.
   - Active styling for current `:cubeName`.
5. Implement `cube-detail.tsx`:
   - `useParams<{ cubeName: string }>` → look up in `byName`.
   - If not found → show "Cube not found" panel + back link.
   - Render header (name, title, description, `type` badge `cube`/`view`).
   - Render `<open-in-playground-button cube={cube}/>`.
   - Render antd `<Tabs>` with the four tabs (lazy mount tab content).
6. Implement four tab components: render plain tables of members/joins/pre-aggregations; format SQL with `sql-formatter` (already installed phase-00).
7. Implement `open-in-playground-button.tsx`:
   - Uses `useNavigate()` + `build-seed-query`.
   - Encodes payload, pushes `/playground?query=<encoded>`.
   - The playground page (phase-02 wrapper) reads `?query=` via `useSearchParams` and seeds a new tab; if not yet implemented, phase-04 closes that loop. Phase-03 ships the navigation; phase-04 makes it land in a fresh tab.
8. Implement empty-state + error-state components; error-state links to the API Settings modal (call `useSecurityContextModal().open()` from phase-01).
9. Wire routes in `src/routes.tsx`:
   ```
   <Route path="/data-model" element={<data-model-page/>}>
     <Route path=":cubeName" element={<cube-detail/>}/>
   </Route>
   ```
10. Smoke test: against Cube on :4000, `/data-model` loads; sidebar lists cubes/views; click → detail renders all tabs; "Open in Playground" navigates with seeded query.

## Todo List

- [x] `src/hooks/use-meta.ts` + `use-meta.types.ts`
- [x] `src/pages/data-model/build-seed-query.ts` (pure fn)
- [x] `src/pages/data-model/data-model-page.tsx`
- [x] `src/pages/data-model/data-model-sidebar.tsx` + `cube-tree-node.tsx`
- [x] `src/pages/data-model/cube-detail.tsx`
- [x] Four tab components: members / joins / pre-aggregations / raw-json
- [x] `src/pages/data-model/open-in-playground-button.tsx`
- [x] `src/pages/data-model/data-model-empty-state.tsx` + `data-model-error-state.tsx`
- [x] `src/routes.tsx` updated with nested routes
- [x] Manual: meta load → tree → detail → deep link works against :4000
- [x] `tsc --noEmit` clean

## Success Criteria

- `/data-model` shows tree of cubes + views from current Cube backend.
- Selecting a cube updates `:cubeName` URL and shows full detail with all four tabs populated.
- "Open in Playground" lands on `/playground` with a seeded query that runs successfully without further user input (when a `*.count` measure exists).
- Search filter narrows tree as user types; no API re-calls.
- Network panel shows exactly one `/cubejs-api/v1/meta` call per page mount (cached within the page).
- Page tolerates older Cube versions (no `type` field) — everything appears under "Cubes".

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation | Status |
|---|---|---|---|---|
| `meta()` shape differs across Cube versions (e.g. missing `type` field) | M | M | Fallback in `use-meta.ts`: treat undefined `type` as `cube`. Cover with vitest case in phase-04. | ✓ Implemented |
| Large `meta` (hundreds of cubes) — render perf | L | M | Virtualise tree only if observable lag; antd Tree handles 500+ nodes acceptably. Defer optimisation. | ✓ N/A (acceptable) |
| `?query=` URL param too long for some browsers (>2KB) | L | M | Encode JSON; consider `base64`-url if seeds grow; phase-03 seeds are tiny (single measure), risk minimal. | ✓ Low risk |
| "Open in Playground" lands on `/playground` before phase-02 finishes wiring `?query=` parser | M | M | Phase ordering: phase-02 finalises `useSearchParams` parsing on `playground-page`. If shipped before that, button still navigates — empty tab opens cleanly. | ✓ Both phases complete |
| Cube includes `*.count` but it is hidden (`shown: false`) — seed picks invisible measure | L | L | `build-seed-query` filters `m.isVisible !== false` before picking. | ✓ Implemented |

## Security Considerations

- All data sourced from authenticated `cubeApi`; no anonymous endpoint hit.
- Raw JSON tab may show `meta` payload containing SQL strings — acceptable: Cube only exposes SQL that the authenticated principal is allowed to see (security context applied server-side).
- Deep-link `?query=` is user-generated by clicking; no XSS surface (we never `innerHTML` the value, only `JSON.parse`).
- "Open in Playground" must `encodeURIComponent` the payload — prevents URL injection if cube/measure names contain reserved chars.

## Next Steps

- Unblocks phase-04 deep-link reception logic in `playground-page` (consumes `?query=`).
- Future: optional second list-view layout (table of all measures across cubes) — not in scope.

## Unresolved Questions

- Should sidebar group by **schema folder** (cube tagged with `schemaName`) instead of flat `Cubes/Views`? Not surfaced by `/meta`; defer until user requests.
- "Pre-aggregations" tab — surface refresh status? Status lives behind `/cubejs-api/v1/pre-aggregations` (auth-gated). Plan keeps tab read-only (definitions only) for now.
- Should we expose `meta.cubes[i].sql` (cube-level SQL) on a dedicated tab vs inside Raw JSON? Plan keeps it inside Raw JSON; revisit if usability suffers.
