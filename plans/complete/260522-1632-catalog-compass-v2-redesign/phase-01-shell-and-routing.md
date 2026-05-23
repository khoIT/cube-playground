---
phase: 1
title: "Shell and routing"
status: done
priority: P1
effort: "2d"
dependencies: []
---

# Phase 1: Shell and routing

## Overview

Restructure `/catalog` into a 4-tab shell. Preserve current Cubes (cluster browser) and Models (SchemaPage) functionality unchanged. Add empty placeholder tabs for Metrics + Data Model so subsequent phases plug into a stable shell. Wire redirect from old `/metric/:cube/:member` route to new concept-URL shape so existing bookmarks survive.

## Requirements

**Functional:**
- 4 tabs in `/catalog` shell: Metrics (default) · Data Model · Cubes · Models
- Tab routes: `/catalog`, `/catalog/data-model`, `/catalog/cubes`, `/catalog/models`
- `/catalog` default route lands on Metrics tab
- Redirect: `/metric/:cube/:member` → `/catalog/concept/measure/:cube.:member` (permanent)
- Existing Cubes + Models tab content rendered unchanged inside new shell
- Tab strip uses existing `CatalogTabs` component pattern (extend, don't replace)

**Non-functional:**
- Zero behaviour regression in Cubes/Models tabs (existing tests pass)
- Routing change must not affect bundle size by > 5% (no new heavy deps)
- All existing deep links (cube detail panel selection via URL hash) preserved

## Architecture

```
src/pages/Catalog/
├── catalog-page.tsx              # existing shell — extend with 4-tab routing
├── catalog-tabs.tsx              # existing — extend resolveCatalogTab + add 2 tabs
├── catalog-grid.tsx              # unchanged (used by Cubes tab)
├── catalog-toolbar.tsx           # unchanged (used by Cubes tab)
├── detail-panel.tsx              # unchanged (used by Cubes tab)
├── metrics-tab/                  # NEW — empty placeholder this phase
│   └── metrics-tab.tsx           # shell + "Coming in Phase 3" copy
├── data-model-tab/               # NEW — empty placeholder this phase
│   └── data-model-tab.tsx        # shell + "Coming in Phase 5" copy
└── ... (existing files unchanged)
```

**Routing map:**

| URL | Component | Phase delivering content |
|---|---|---|
| `/catalog` | `MetricsTab` placeholder | P3 |
| `/catalog/data-model` | `DataModelTab` placeholder | P5 |
| `/catalog/cubes` | existing `CatalogBrowseBody` (renamed mount) | P1 (preserved) |
| `/catalog/models` | existing `SchemaPage` (already wired) | P1 (preserved) |

**Old → new redirects** (one-time, permanent):

| From | To |
|---|---|
| `/metric/:cube/:member` | `/catalog/concept/measure/:cube.:member` (lands on placeholder until P5) |

## Related Code Files

**Create:**
- `src/pages/Catalog/metrics-tab/metrics-tab.tsx` — empty placeholder
- `src/pages/Catalog/data-model-tab/data-model-tab.tsx` — empty placeholder
- `src/pages/Catalog/redirects.tsx` — `<Redirect>` components for legacy URLs
- `src/pages/Catalog/__tests__/routing.test.tsx` — verify all 4 tab routes resolve + redirect works

**Modify:**
- `src/pages/Catalog/catalog-page.tsx` — extend route switch from 2-way to 4-way
- `src/pages/Catalog/catalog-tabs.tsx` — extend `TabKey` to `'metrics' | 'data-model' | 'cubes' | 'models'`; extend `resolveCatalogTab` accordingly
- `src/App.tsx` (or wherever `/catalog` route is registered) — add legacy `/metric/:cube/:member` redirect route

**Delete:** none

## Implementation Steps

1. **Extend `TabKey`** in `catalog-tabs.tsx`: `'metrics' | 'data-model' | 'cubes' | 'models'`. Default still resolves to first tab; rename current `'catalog'` → `'cubes'` everywhere it appears in this file. Translation keys `tabs.metrics`, `tabs.dataModel`, `tabs.cubes`, `tabs.models` — add to locale JSON.
2. **Rewrite `resolveCatalogTab`** to read pathname suffix: `/data-model` → `'data-model'`, `/cubes` → `'cubes'`, `/models` → `'models'`, default → `'metrics'`. Update `go(key)` to push the right URL.
3. **Update `CatalogPage`** in `catalog-page.tsx` to switch on the new 4 keys. Wire `metrics` and `data-model` to the new placeholder components. `cubes` continues to render `CatalogBrowseBody`. `models` continues to render `SchemaPageWithRouter`.
4. **Create `MetricsTab` + `DataModelTab` placeholder components.** Each = a single styled component centred "Coming soon — Phase N delivers this" with a link back to Cubes/Models.
5. **Add legacy redirect.** In the route registration site (likely `src/App.tsx` or `src/pages/index.tsx`), add `<Redirect from="/metric/:cube/:member" to="/catalog/concept/measure/:cube.:member" />` BEFORE any catch-all. The `:cube.:member` synthesis happens inside the redirect component if needed (use a small wrapper that reads params and renders `<Redirect to={...}>`).
6. **Add tests.** In `__tests__/routing.test.tsx`: render `<MemoryRouter>` for each of `/catalog`, `/catalog/data-model`, `/catalog/cubes`, `/catalog/models`, `/metric/orders/revenue_vnd` — assert correct component mounted.
7. **Smoke-test in browser:** load each tab, verify Cubes + Models behave exactly as before. Trigger old metric detail bookmark, confirm redirect lands on placeholder.
8. **Update i18n** — extend locale JSON with new tab labels. Match existing `tabs.catalog` style.

## Success Criteria

- [ ] 4 tabs render in correct order: Metrics · Data Model · Cubes · Models
- [ ] `/catalog` defaults to Metrics tab
- [ ] `/catalog/cubes` shows current cube cluster browser, functionally unchanged
- [ ] `/catalog/models` shows current SchemaPage, functionally unchanged
- [ ] `/metric/orders/revenue_vnd` (or any measure FQN) redirects to `/catalog/concept/measure/orders.revenue_vnd`
- [ ] Routing test passes for all 4 + redirect
- [ ] Existing Catalog tests still pass (no behaviour regression in Cubes tab)
- [ ] Existing translation keys still resolve; new keys added in `en` locale

## Risk Assessment

- **TabKey rename `catalog` → `cubes` is a textual sweep.** Risk: missed references in tests or i18n. **Mitigation:** grep for `'catalog'` string literals in catalog-* files before merging.
- **Redirect for `/metric/:cube/:member` synthesises FQN from two params.** Risk: route lib version may not support computed `to` props. **Mitigation:** Use a small wrapper component that reads `useParams` and renders `<Redirect to={...}>` if direct computed form not supported.
- **Existing bookmarks may include URL hashes for cube selection.** Risk: redirects strip hash. **Mitigation:** preserve `location.hash` in the redirect target.
- **Translation file churn:** `tabs.catalog` may be referenced by other pages. **Mitigation:** add new keys; deprecate `tabs.catalog` only after grep confirms no other consumers.
