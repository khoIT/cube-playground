---
phase: 3
title: Tab IA restructure
status: completed
priority: P2
effort: 3h
dependencies:
  - 2
---

# Phase 3: Tab IA restructure

## Overview

Make the Cubes surface (now Graph-default with a Grid toggle) the **first tab** and the
**default landing** of `/catalog/data-model`. Schema Cartographer moves to an explicit
`/schema` path. All existing deep links keep working — most critically chat field-chips
(`/catalog/data-model?focus=…` must still reach the Cartographer).

## Requirements

- Functional:
  - Tab order: **Cubes, Schema, Concepts, Models, Concept Map** (5 tabs, Cubes first).
  - Paths: `cubes` owns root `/catalog/data-model`; `schema` → `/catalog/data-model/schema`;
    concepts/models/concept-map unchanged.
  - Within Cubes surface: `Graph | Grid` segmented toggle, **Graph default**; `?view=grid`
    selects grid (URL param, no localStorage — KISS). Grid = existing `CatalogBrowseBody`
    content unchanged.
  - Redirect matrix (in `catalog-page.tsx` dispatch, ahead of subtab render):
    1. `/catalog/data-model` **with `?focus=` param** → `/catalog/data-model/schema` + full
       search string (chat field-chips, and the legacy `/catalog/schema` → root redirect chain
       composes through this — verify both hops preserve `?focus=`).
    2. `/catalog/data-model/cubes` (legacy bookmark of grid) → `/catalog/data-model?view=grid`.
    3. Existing `/catalog/cubes` → `/catalog/data-model/cubes` redirect stays (chains into 2).
    4. `/catalog/schema` redirect (existing) keeps preserving search → now lands per rule 1.
  - `resolveDataModelSubtab`: root (and root + only `?view=`) → `'cubes'`; `/schema` → `'schema'`;
    keep return-shape so `App.tsx` `pushRecent('data-model', …)` behavior is unchanged.
  - Sidebar: no change (already targets `/catalog/data-model`).
- Non-functional: no behavior change for Concepts/Models/Concept Map; KeepAliveRoute semantics
  for /catalog preserved; i18n keys — reuse `tabs.cubes` label (rename deferred, see plan.md
  unresolved question).

## Architecture

```
/catalog/data-model            ──► CubesSurface (Graph default ⇄ ?view=grid)
/catalog/data-model/schema     ──► SchemaCartographerPage (focus deep-links land here)
/catalog/data-model/concepts   ──► DataModelTab           (unchanged)
/catalog/data-model/models     ──► SchemaPage             (unchanged)
/catalog/data-model/concept-map──► ConceptMapPage         (unchanged)
```

`CubesSurface` = thin host in `catalog-page.tsx` (or extracted `cube-graph/cubes-surface.tsx`
if catalog-page nears 200-LOC pressure): reads `?view`, renders lazy `CubeGraphPage` or
`CatalogBrowseBody`, renders the toggle. Toggle navigates via `history.replace` (no history spam).

## Related Code Files

- Modify: `src/pages/Catalog/catalog-tabs.tsx` (TAB_ORDER, TAB_PATHS, resolveDataModelSubtab, labels)
- Modify: `src/pages/Catalog/catalog-page.tsx` (dispatch, redirects, CubesSurface host, lazy import)
- Create: `src/pages/Catalog/cube-graph/cubes-surface.tsx` (view toggle host — keeps catalog-page lean)
- Modify: `src/pages/Catalog/__tests__/catalog-tabs.test.tsx` (exists? extend; else create)
- Read for context: `src/App.tsx:260-295` (pushRecent + recent-items routing assumptions),
  `src/pages/Chat/components/field-chip.tsx:17` (focus deep-link producer),
  `src/pages/Catalog/schema-cartographer/cartographer-page.tsx` (focus param parser)

## Implementation Steps

1. Re-read `catalog-tabs.tsx` + `catalog-page.tsx`; inventory every consumer of
   `resolveDataModelSubtab` and every `<Redirect>` touching catalog paths
   (`grep -rn "data-model\|catalog/schema\|catalog/cubes" src/`).
2. Update TAB_PATHS/TAB_ORDER/labels; root → cubes, `/schema` → schema.
3. Add redirect rules 1–2; verify rules 3–4 compose (manual URL walk + tests).
4. Build `cubes-surface.tsx` toggle host; default graph; `?view=grid` honored; toggle uses
   `history.replace` keeping other params.
5. Update/extend tests: subtab resolution (root, /schema, ?view=grid, ?focus redirect),
   redirect chain `/catalog/schema?focus=x` → `/catalog/data-model/schema?focus=x`,
   tab order render, toggle switches views.
6. Full check: `npm run typecheck`, `npm test` (catalog scope), playwright walk of all 5 tabs +
   field-chip URL + old bookmarks; screenshot graph landing for design cross-check.

## Success Criteria

- [ ] Sidebar "Data Model" lands on Graph view of active game
- [ ] All 5 tabs reachable, order: Cubes, Schema, Concepts, Models, Concept Map
- [ ] `?focus=` URLs (root and legacy /catalog/schema) open Cartographer with focus applied
- [ ] `/catalog/data-model/cubes` and `/catalog/cubes` land on Grid view
- [ ] Existing catalog tests green; new redirect/resolution tests pass; typecheck clean

## Risk Assessment

- **Deep-link regressions** are the main blast radius — the redirect matrix above is exhaustive
  per grep of producers (field-chip is the only in-app `?focus` producer; external bookmarks
  covered by rules 2–4). Tests pin each rule.
- **KeepAliveRoute**: catalog stays mounted across navigation; toggle must derive view from
  location, not one-shot state, or stale view persists after back-nav. Use `useLocation()`.
- **pushRecent**: App.tsx records data-model recents off the root path — confirm payload still
  resolves post-reorder (read before edit).
