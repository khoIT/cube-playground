# Phase 2 — Split "New Metric" from "New Data Model" + wire into Catalog

## Overview

- **Priority:** P0 (core ask)
- **Status:** pending
- The existing `/metrics/new?v=2` full-page wizard ALREADY edits cube/measure/dimension/segment YAML (Step 0 picks an `artifactKind`). It is, semantically, a "data-model builder". Repurpose it as such.
- Add a NEW lightweight "Add metric" flow that registers a Business Metric (consumed by `metrics-tab` via `useBusinessMetrics`) without touching YAML. This is the flow users actually want from `/catalog`.

## Key insights

- `business-metric-constants.ts` holds the registry consumed by `MetricsTab`. Adding a new metric = appending a record. (Verify whether it's static or persisted via API in scout — current grep shows it's `metrics-tab/business-metric-constants.ts`, static.)
- The v2 wizard's Step 0 (`artifact-kind-body`) supports `measure | dimension | segment`. Renaming the route does not require touching internal steps.
- The current `/catalog` metrics-tab already has a `<NewMetricLink to="/metrics/new">` button. This is the natural CTA seat; we re-target it.

## Requirements

- Route `/data-model/new?v=2` exists and renders the existing `NewMetricPage`.
- Route `/metrics/new` 301s to `/data-model/new` (preserves any deep links from external docs/PRs).
- New route `/catalog/metric/new` renders a slim "Add Metric" form: name, KPI tier, owner, primary cube, primary measure, description. Persists to the business-metric registry (static-file append disallowed at runtime → see persistence-strategy below).
- `+ New metric` CTA in `metrics-tab.tsx` points to `/catalog/metric/new`.
- A secondary `+ New data model` link in catalog data-model tab points to `/data-model/new?v=2`.

## Persistence strategy for business-metric registry (DECISION: API)

Build a thin client `businessMetricsClient` mirroring `gamesClient` (`api/segments-client.ts`). Endpoint contract:

```
GET    /playground/business-metrics?gameId=<id>   → { metrics: BusinessMetric[] }
POST   /playground/business-metrics               → { metric: BusinessMetric }
DELETE /playground/business-metrics/:slug         → 204
```

- Server backend is not yet implemented. Client gracefully degrades to localStorage (`gds-cube:business-metrics:user`) on 404/network-error so dev UX still works.
- `useBusinessMetrics` merges: static constants ∪ API response (deduped by slug, API wins).
- Migration path: when backend lands, drop the localStorage fallback.

## Architecture

```
src/
  index.tsx                                # add /data-model/new, /catalog/metric/new routes; redirect /metrics/new → /data-model/new
  pages/Catalog/
    metrics-tab/
      use-business-metrics.ts              # merge static + localStorage entries
      add-metric/                          # NEW directory
        add-metric-page.tsx                # slim form, antd Form
        use-add-metric-form.ts             # field state + validation
        index.ts
  api/
    business-metrics-client.ts             # NEW: fetch wrapper + localStorage fallback
      metrics-tab.tsx                      # CTA target → /catalog/metric/new
    data-model-tab/
      data-model-tab.tsx                   # add `+ New data model` link → /data-model/new?v=2
  QueryBuilderV2/NewMetric/full-page/
    NewMetricPage.tsx                      # update header copy: "New Data Model"; no logic change
```

## Implementation steps

1. **Router** — `src/index.tsx`:
   - Add `Route` for `/data-model/new` rendering `NewMetricPage` (reuses existing lazy import; just rename the constant for clarity).
   - Add `Route` for `/data-model/new/success` rendering `NewMetricSuccess`.
   - Add `Route` for `/catalog/metric/new` rendering the new `AddMetricPage` (lazy-loaded).
   - Add `Redirect` from `/metrics/new` → `/data-model/new` and `/metrics/new/success` → `/data-model/new/success`.
2. **NewMetricPage copy** — change the page title / breadcrumb labels from "New metric" to "New data model". Update the success-body redirect target from `/metrics/new?v=2` → `/data-model/new?v=2`.
3. **AddMetricPage scaffold**:
   - Inputs: `name`, `slug`, `tier (1-3)`, `owner`, `cubeName` (select from `useCatalogMeta`), `measureName` (select from chosen cube), `description`.
   - Validate slug unique against merged registry.
   - On submit: write to `gds-cube:business-metrics:user`, fire toast, push `/catalog/concept/measure/{cube}.{measure}`.
4. **Storage layer** — `add-metric-storage.ts`: JSON-safe read/write helpers + schema check.
5. **Registry merge** — `use-business-metrics.ts`: load static constants + parse localStorage, dedupe by slug.
6. **CTA wiring** — `metrics-tab.tsx`: change `<NewMetricLink to="/metrics/new">` → `to="/catalog/metric/new"`.
7. **Header NavPill** — `Header.tsx`: relabel/repoint the `Sparkles` pill from `/metrics/new?v=2` to `/data-model/new?v=2` and change i18n key `nav.newMetric` → `nav.newDataModel`. Add i18n string.
8. **i18n** — add `nav.newDataModel`, keep `nav.newMetric` (used by Add-Metric CTA inside catalog).
9. **typecheck**.

## Related code files

**Create**
- `src/pages/Catalog/metrics-tab/add-metric/add-metric-page.tsx`
- `src/pages/Catalog/metrics-tab/add-metric/add-metric-storage.ts`
- `src/pages/Catalog/metrics-tab/add-metric/use-add-metric-form.ts`
- `src/pages/Catalog/metrics-tab/add-metric/index.ts`

**Modify**
- `src/index.tsx`
- `src/QueryBuilderV2/NewMetric/full-page/NewMetricPage.tsx`
- `src/QueryBuilderV2/NewMetric/full-page/steps/success/success-body.tsx`
- `src/pages/Catalog/metrics-tab/metrics-tab.tsx`
- `src/pages/Catalog/metrics-tab/use-business-metrics.ts`
- `src/pages/Catalog/data-model-tab/data-model-tab.tsx`
- `src/components/Header/Header.tsx`
- `src/i18n/locales/en.ts` (or equivalent)

## Todo

- [ ] Routes for `/data-model/new`, `/catalog/metric/new`, redirects
- [ ] NewMetricPage header copy + success redirect
- [ ] AddMetricPage form
- [ ] Storage helpers
- [ ] Registry merge in `use-business-metrics`
- [ ] Catalog CTA targets
- [ ] Header NavPill relabel
- [ ] i18n strings
- [ ] typecheck

## Success criteria

- Hitting `/metrics/new` redirects to `/data-model/new`.
- `+ New metric` on Catalog opens slim form.
- Submitting writes localStorage; new card appears in MetricsTab immediately.
- `+ New data model` link on Catalog data-model tab opens the full wizard.
- Header pill labelled "New data model".

## Risks

- Existing tests reference `/metrics/new?v=2` deep links (success-body test). Update.
- localStorage quota — keep entries minimal.
- User adds a metric for a cube whose measure name later changes in YAML → stale registry. Out of scope.

## Security

- localStorage is per-browser; no PII added. Same trust level as token/aliases.
