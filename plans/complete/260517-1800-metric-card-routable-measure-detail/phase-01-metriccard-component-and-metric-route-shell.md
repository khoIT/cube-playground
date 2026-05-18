---
phase: 1
title: "MetricCard component and /metric route shell"
status: completed
priority: P0
effort: "0.5d"
dependencies: []
---

# Phase 1: MetricCard component and /metric route shell

## Context Links

- Reusable hook: `src/pages/Catalog/use-catalog-meta.ts` (already fetches `/cubejs-api/v1/meta?extended=true`)
- Existing route registration: `src/index.tsx:91` (KeepAliveRoute for `/catalog`)
- Existing detail surface for patterns: `src/pages/Catalog/detail-panel.tsx`
- Wizard chip styling to reuse: `src/pages/Catalog/measure-row.tsx:65-75`
- Page exports: `src/pages/index.tsx`

## Overview

Land the shell: a new `MetricCard` component that renders a single measure from `CatalogCube + CatalogMeasure`, and a `MetricCardPage` route at `/metric/:cube/:member` that resolves the URL param against `useCatalogMeta()` cubes and mounts the card. No catalog wiring yet (P2). No derived sections yet (P3). No Try-it deep-link yet (P4).

Demoable end-state: type `/metric/active_daily.dau` in the URL bar → card renders with name, title, aggType, format, description, provenance.

## Priority

P0 — gates P2/P3/P4. Establishes the component API the later phases extend.

## Key Insights

- `useCatalogMeta` returns `{ cubes, loading, error }` — `MetricCardPage` filters to the single matching cube + measure on each render. No new state.
- The fqn convention is dotted: `active_daily.dau`. URL-decode is needed (browsers leave dots intact, but explicit `decodeURIComponent` covers edge cases).
- For an unknown fqn (typo, deleted measure), render a 404 panel with a "Back to Catalog" link.
- Component is **composable** — built as `MetricCard({ cube, measure })`. The route page is a thin wrapper; future surfaces (catalog detail panel inline, wizard find-similar, hover-card) can reuse the same component.
- Visual style follows `detail-panel.tsx` patterns — same `Section`, `SectionTitle`, `Chip`, `Code` primitives. Card lives in `src/pages/Catalog/` to share styled-components naturally.

## Requirements

### Functional
- New file `src/pages/Catalog/metric-card.tsx` exports `MetricCard` component with props `{ cube: CatalogCube, measure: CatalogMeasure }`.
- Card renders sections (each conditional on data):
  - Header: full fqn (mono) + title + aggType chip + format chip + Wizard chip (if `measure.meta?.source === 'wizard'`)
  - **What it is**: `measure.description` (paragraph) — hidden when absent
  - **Where it lives**: cube name (clickable → future, plain text for now) + cluster label ("Connected · cluster 1" if `cube.connectedComponent` is defined; "Standalone" otherwise) + cube description
  - **Provenance** (footer-ish row): if `measure.meta?.source` present, render "Authored by `<author>` via `<source>`" with optional `created_at` timestamp
- New file `src/pages/Catalog/metric-card-page.tsx` exports `MetricCardPage` (route entry):
  - Reads `useParams<{ cube: string; member: string }>()` from react-router-dom (two-segment route confirmed in Validation Session 1)
  - Reconstructs `fqn = ${cube}.${member}`
  - Reads `{ cubes, loading, error }` from `useCatalogMeta()`

<!-- Updated: Validation Session 1 - route shape is /metric/:cube/:member (two segments), not /metric/:fqn single-param -->

  - Loading → spinner / "Loading…" text
  - Error → error panel with retry hint
  - Cube not found → 404 panel with "Back to Catalog" link
  - Measure not found → "Measure not in cube" panel with "Back to Catalog" link
  - Otherwise → mounts `<MetricCard cube={...} measure={...} />`
- Route registered in `src/index.tsx` at `/metric/:cube/:member` — use `KeepAliveRoute` like `/catalog` for consistent UX (cards stay mounted across tab switches).
- `MetricCardPage` exported from `src/pages/index.tsx`.

### Non-functional
- Card component pure (no fetches inside) — takes data via props.
- Page wrapper owns the fetch + URL parsing.
- File sizes under 200-line ceiling per project rule.

## Architecture

```
URL: /metric/active_daily.dau
        │
        ▼
   KeepAliveRoute mount
        │
        ▼
   MetricCardPage
        ├─ useParams() → fqn string
        ├─ decodeURIComponent + split → cubeName, memberName
        ├─ useCatalogMeta() → { cubes, loading, error }
        ├─ find cube where cube.name === cubeName
        ├─ find measure where measure.name === fqn
        │   ├─ loading? → <Loading />
        │   ├─ error? → <ErrorPanel />
        │   ├─ no cube? → <NotFound /> ("Cube not found")
        │   ├─ no measure? → <NotFound /> ("Measure not in cube")
        │   └─ else → <MetricCard cube measure />
        ▼
   MetricCard
        ├─ <Header> name + title + chips
        ├─ <Section "What it is"> description
        ├─ <Section "Where it lives"> cube info + cluster
        └─ <Provenance> author + source + ts
```

## Related Code Files

- **Create:**
  - `src/pages/Catalog/metric-card.tsx` — component (~120 LOC target)
  - `src/pages/Catalog/metric-card-page.tsx` — route entry + URL parsing (~80 LOC target)
- **Modify:**
  - `src/index.tsx` — register `/metric/:cube/:member` route under `KeepAliveRoute`
  - `src/pages/index.tsx` — export `MetricCardPage`
- **Read for context (no edits):**
  - `src/pages/Catalog/use-catalog-meta.ts` — type definitions + hook signature
  - `src/pages/Catalog/detail-panel.tsx` — styled-component patterns
  - `src/pages/Catalog/measure-row.tsx` — chip styling

## Implementation Steps

1. **Confirm `react-router-dom` API.** Project uses v5 per the 1940 plan validation log — `useParams<{ fqn: string }>()` from `react-router-dom` returns the URL param. Verify with a quick grep against `src/index.tsx`.
2. **Create `metric-card.tsx`** — pure component:
   - Reuse styled-components patterns from `detail-panel.tsx` (`Section`, `SectionTitle`, `Chip`, `Code`, `Row`).
   - Header: render `measure.name` as `<Code>`, `measure.title` as muted secondary text, aggType + format as `<Chip>`s, Wizard chip when `measure.meta?.source === 'wizard'` (copy styling from `measure-row.tsx:65-75`).
   - Sections wrapped in styled `<aside>` or `<main>` container.
   - All sections conditional on data presence — no empty rows.
3. **Create `metric-card-page.tsx`** — route entry:
   - `useParams<{ cube: string; member: string }>()` — two segments, react-router-dom v5.
   - Reconstruct fqn: `const fqn = `${cube}.${member}`;`.
   - `useCatalogMeta()` → handle loading/error/notfound branches with simple inline panels (no separate components needed — keep file lean).
   - Find cube via `cubes.find(c => c.name === cube)` and measure via `cube.measures.find(m => m.name === fqn)`.
   - Mount `<MetricCard cube={foundCube} measure={foundMeasure} />` on the happy path.
4. **Register the route in `src/index.tsx`**:
   - Import `MetricCardPage` from `./pages`.
   - Add `<KeepAliveRoute key="metric" path="/metric/:cube/:member"><MetricCardPage /></KeepAliveRoute>` block near the `/catalog` registration (line 91 area).
   - **Note on KeepAliveRoute behaviour:** verification confirmed visiting multiple metric URLs reuses ONE component instance (Route pattern matches across cubes/members). `useParams` changes trigger re-render but `useCatalogMeta` state persists — actually a small win (no refetch on navigation between cards).
5. **Export from `src/pages/index.tsx`** — add `export { MetricCardPage } from './Catalog/metric-card-page';`.
6. **Smoke test** (manual):
   - Visit `/#/metric/active_daily.dau` → card renders with description "Daily active users (HLL approx_distinct)", `countDistinctApprox` chip.
   - Visit `/#/metric/active_daily.bogus` → "Measure not in cube" panel + Back link.
   - Visit `/#/metric/bogus.something` → "Cube not found" panel + Back link.
   - Visit during initial load → "Loading…" briefly visible.

## Todo List

- [ ] Verify `react-router-dom` v5 `useParams` usage pattern matches `src/index.tsx`
- [ ] Create `metric-card.tsx` with Header + What-it-is + Where-it-lives + Provenance sections
- [ ] Create `metric-card-page.tsx` with URL parsing + state branches
- [ ] Register `/metric/:cube/:member` route in `src/index.tsx`
- [ ] Export `MetricCardPage` from `src/pages/index.tsx`
- [ ] Smoke: known fqn → renders
- [ ] Smoke: typo cube → 404 panel
- [ ] Smoke: typo measure → 404 panel
- [ ] Smoke: pasted-URL cold load → "Loading…" → card

## Success Criteria

- [ ] `/metric/active_daily.dau` renders the card with all base sections populated
- [ ] Card width / styling visually consistent with existing catalog DetailPanel
- [ ] Wizard-authored measures (where `meta.source === 'wizard'`) show the Wizard chip + provenance row
- [ ] Unknown fqn shows a clear 404 panel, not a crash
- [ ] No new fetches beyond `useCatalogMeta()`'s existing one
- [ ] Both files under 200 LOC

## Risk Assessment

- **Risk:** `useCatalogMeta()` re-fetches on every `MetricCardPage` mount, defeating the catalog's existing cache. Mitigation: the hook is mounted independently per page; if perf matters, hoist to a context later. For POC scale (11 cubes), the re-fetch is ~50KB and <100ms — acceptable.
- **Risk (RESOLVED via two-segment route):** Earlier draft used `/metric/:fqn` with a dotted single param — dots in URL path patterns are an edge case in react-router-dom v5. Switching to `/metric/:cube/:member` (Validation Session 1 decision) eliminates the issue. Cube member names are restricted to `[a-zA-Z0-9_]` per Cube spec; both segments are URL-safe without encoding.
- **Risk (RESOLVED via validation):** `KeepAliveRoute` behaviour with `:cube/:member` dynamic params. Confirmed during validation: visiting multiple metric URLs reuses ONE component instance (same Route pattern). `useParams` changes trigger re-render but `useCatalogMeta` state caches across navigation — a small perf win, not a bug.

## Security Considerations

- No new auth surface. Same JWT path the catalog uses (`useAppContext()` → `cubejsToken` via `useCatalogMeta`).
- Route is fully shipped (no PROD guard) per plan-level decision — consistent with `/catalog`.
- URL params are URI-decoded but otherwise unused for code paths (no SQL injection vector, no `dangerouslySetInnerHTML`, no eval).
