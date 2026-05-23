# Phase 5 — Tests, docs, smoke

## Overview

- **Priority:** P1
- **Status:** pending
- Catch regressions introduced by Phases 1–4 and update repo docs.

## Test coverage to add / update

| File | Why |
|---|---|
| `src/components/Header/__tests__/right-cluster.test.tsx` (if exists; otherwise add) | Search slot removed |
| `src/components/Header/__tests__/user-menu.test.tsx` | Legacy NewMetric menu item removed |
| `src/pages/Catalog/metrics-tab/__tests__/metrics-tab.test.tsx` | CTA target = `/catalog/metric/new` |
| `src/pages/Catalog/metrics-tab/add-metric/__tests__/add-metric-page.test.tsx` (new) | Form submit writes localStorage and redirects |
| `src/pages/Catalog/metrics-tab/__tests__/use-business-metrics.test.tsx` | Registry merge: static + user entries |
| `src/shared/game-scoping/apply-game-filter.test.ts` (new) | Util correctness |
| `src/pages/Explore/__tests__/explore-page.test.tsx` (new or extend) | Game switch updates `?query=` |
| `src/QueryBuilderV2/NewMetric/full-page/__tests__/new-metric-page.test.tsx` (if exists) | Route + header label |

## Manual smoke (after green vitest)

- [ ] `npm run dev`, open `/` → lands on `/build`.
- [ ] Header has Help, Bell, User. ⌘K still opens overlay.
- [ ] `/catalog` → click `+ New metric` → slim form → submit → card appears.
- [ ] `/catalog/data-model` → click `+ New data model` → full wizard.
- [ ] Header pill labelled "New data model" → opens `/data-model/new?v=2`.
- [ ] `/build` with a measure → switch game → query updates, result re-runs.
- [ ] `/metrics/new` deep link → 301 to `/data-model/new`.

## Docs to update

- `docs/codebase-summary.md` — note that `NewMetricPage` is now a Data-Model wizard; Add-Metric lives in Catalog.
- `docs/project-changelog.md` — entries for v1 deprecation, route changes, game filter.
- `docs/system-architecture.md` — diagram update if it covers metric flow.

## Todo

- [ ] All vitest suites green
- [ ] Manual smoke checklist pass
- [ ] Docs updated
- [ ] `/ck:journal` entry

## Success criteria

- 100% test pass.
- Smoke checklist complete.
- Docs synced.
