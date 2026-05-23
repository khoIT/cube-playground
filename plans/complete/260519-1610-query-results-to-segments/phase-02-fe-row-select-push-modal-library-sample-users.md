---
phase: 2
title: "FE row-select + push modal + Library + Sample Users"
status: pending
priority: P1
effort: "1w"
dependencies: [0, 1]
---

# Phase 2: FE row-select + push modal + Library + Sample Users

## Overview

<!-- Updated: Validation Session 1 - MSW dropped; P2 starts after P1 ships -->
Add the `/segments` route, header pill, row-selection mode on `QueryBuilderResults`, the push-to-segment modal, the Library list view (KPIs + search + filter + sort + owner column), and the Detail shell with the **Sample users** tab. Other detail tabs are stubbed and filled by P4. FE consumes the typed API contract from P1. **P2 is gated on P1 shipping** — no mock service worker; the FE talks to the real Fastify server.

## Requirements

**Functional**
- `/segments` route added to `src/index.tsx` via `KeepAliveRoute`.
- `Header.tsx` renders a `Segments` `NavPill` between `/build` and `/metrics/new`.
- `QueryBuilderResults.tsx` gains a row-selection mode:
  - Leading checkbox column + indeterminate header state.
  - Enabled when the executed query includes any mapped identity dimension (read from `/api/settings/identity-map`).
  - Selection cleared on query re-run; preserved across pagination of the same result set.
  - Bottom action bar appears with `[N user_ids selected]  [Clear]  [Copy IDs]  [Export]  [Save as segment ▾]`.
- Push modal:
  - Tabs: `Create new` / `Append to existing`.
  - `Create new`: name field, selection summary (count + top countries/tiers/channels + avg of one numeric column), Static/Live toggle, type description.
  - `Append to existing`: dropdown of static segments only.
  - Submits to `POST /api/segments` or `POST /api/segments/:id/append`.
  - Post-submit toast with `View segment →` link.
- Library view:
  - 4 KPI tiles (Live count / Static count / Total uids / In use — placeholder zero in v1).
  - Search input, type filter tabs, sort dropdown.
  - Table columns: Segment (name + description + tags), Type (live badge / static), Last refresh (relative + next-refresh countdown for live), Size (+delta), Trend (dash in v1), Owner.
  - `Import IDs` and `New segment` buttons (Import wired in P3; `New segment` navigates to editor route in P5).
- Detail view shell:
  - Breadcrumbs + title + cube badge + action buttons (Export IDs, Copy as filter (P7), Edit predicate (P5), overflow).
  - 4 KPI tile slots wired to preset data (P4 fills bodies; v1 shell renders placeholders).
  - Tab strip: Overview / Engagement / Monetization / Retention / Sample users / Saved analyses / Predicate.
  - **Sample users** tab fully implemented in P2: paginated table of `min(50, segment.size)` randomly-sampled uids; `Export all IDs` + `Reshuffle` actions.
  - Other tabs render `<TabPending phase="4|5|7"/>` placeholders.
- Owner header wiring: read from `localStorage('gds-cube:owner') || 'anonymous'`; attached to all `/api/*` fetches via a shared client.

**Non-functional**
- `QueryBuilderResults.tsx` ≤ 200 lines after the row-select extraction; new selection logic in `query-builder-results-selection.tsx` (hook + UI sub-components).
- All FE network calls go through `src/api/segments-client.ts` (typed against `src/types/segment-api.ts`).
- **All visual primitives reused from `src/pages/Segments/visuals/` (P0)** — `LiveBadge`, `MemberPill`, `Tag`, `SelectionBar`, `KpiTile`, `Breadcrumbs`. No raw antd primitives where a P0 equivalent exists.
- Components consume tokens from `src/theme/tokens.css`; no inline `style={}` for color/spacing.

**Visual parity**
- Library screen matches `~/Downloads/cube-segment/screen-library.jsx` baseline within ≤2% pixel delta (Playwright diff at 1440×900 + 375×812).
- Push modal matches mock's `PushModal` (`screen-playground.jsx`).
- Selection action bar matches mock's `ActionBar`.
- Detail header (title + cube badge + actions) and Sample users tab table match `screen-detail.jsx` baselines for those regions.

## Architecture

```
src/
  pages/
    Segments/
      index.tsx                          (route shell; switches Library | Detail by URL)
      library/
        library-view.tsx                 (page-title, KPI tiles, toolbar, table)
        library-kpi-tiles.tsx
        library-toolbar.tsx
        library-segment-row.tsx
        live-badge.tsx
      detail/
        detail-view.tsx                  (header + KPI strip + tab strip)
        detail-breadcrumbs.tsx
        detail-header-actions.tsx
        tabs/
          sample-users-tab.tsx
          tab-pending-placeholder.tsx    (P4/P5/P7 fill these later)
      push-modal/
        push-modal.tsx
        selection-summary.tsx
  components/
    QueryBuilderResults/
      query-builder-results-selection.tsx (extracted: row-select column + action bar)
  api/
    api-client.ts                        (shared fetch wrapper + X-Owner header)
    segments-client.ts                   (typed endpoints)
  types/
    segment-api.ts                       (shared types from P1)
  hooks/
    use-identity-map.ts                  (caches /api/settings/identity-map)
    use-segment-selection.ts             (zustand or context for cross-table selection)
```

`Header.tsx` modified to add the `NavPill`. `src/index.tsx` modified to route `/segments` and `/segments/:id`.

## Related Code Files

**Create**
- `src/pages/Segments/**` (~12 files above)
- `src/components/QueryBuilderResults/query-builder-results-selection.tsx`
- `src/api/{api-client,segments-client}.ts`
- `src/hooks/{use-identity-map,use-segment-selection}.ts`
- `src/i18n/locales/{en,vi}.json` — add `nav.segments` + segment-page strings

**Modify**
- `src/components/Header/Header.tsx` — add `NavPill` + mobile menu entry
- `src/QueryBuilderV2/QueryBuilderResults.tsx` — wire the row-select extraction (keep file under 200 lines)
- `src/index.tsx` — add `<KeepAliveRoute path="/segments">` block + `SegmentsPage` lazy import
- `src/pages/index.tsx` — export `SegmentsPage` via `loadable()`

## Implementation Steps

1. Add `nav.segments` to i18n locales + import strings.
2. Add the `NavPill` to `Header.tsx` (desktop + mobile menus) and the route to `src/index.tsx`.
3. Implement `api-client.ts`: `fetch` wrapper that attaches `X-Owner` from localStorage and parses error envelope into typed `ApiError`.
4. Implement `segments-client.ts` with one function per endpoint, typed against `src/types/segment-api.ts`.
5. Implement `use-identity-map.ts`: cached `/api/settings/identity-map` fetch keyed by current `/meta` hash.
6. Implement `query-builder-results-selection.tsx`:
   - Hook `useResultsSelection(rows, identityColumn)` — exposes `selected: Set<string>`, `toggle`, `toggleAll`, `clear`, `someSelected`, `allSelected`.
   - Leading checkbox column added to the existing `GridTable` via `gridColumnsTemplate` extension.
   - Bottom action bar component.
7. Modify `QueryBuilderResults.tsx` to invoke the selection hook + render the action bar when the executed query includes a mapped identity dim. Keep file ≤ 200 LoC by lifting helpers/sub-components out.
8. Implement `push-modal.tsx`:
   - Antd `Modal` host + two-tab control.
   - `Create new` form (name + Static/Live toggle).
   - `Append to existing` (dropdown of static segments via `segmentsClient.list({ type: 'static' })`).
   - On submit, calls correct endpoint; closes; emits a toast.
9. Implement `selection-summary.tsx`: aggregates top 3 values for up to 3 categorical columns + avg of one numeric column; receives raw `selectedRows`.
10. Implement `Library` view:
    - `library-kpi-tiles.tsx` (KPI grid).
    - `library-toolbar.tsx` (search input + type filter tabs + sort select + Import + New).
    - `library-segment-row.tsx` (row in a CSS grid; renders `LiveBadge`, size + delta, owner avatar).
    - `library-view.tsx` orchestrates state + calls `segmentsClient.list`.
11. Implement `Detail` view shell:
    - Reads `id` from `useParams`.
    - Calls `segmentsClient.get(id)`; loading + error states.
    - Renders breadcrumb + header + KPI strip (placeholders) + tab strip.
    - Implement `sample-users-tab.tsx`: paginated table of `segment.sample_users` (server returns shuffled sample on GET).
    - Other tabs render `TabPending` with the phase number they'll be filled by.
12. Update `vite.config.ts` if proxy not already set (P1 owns the proxy config).
13. Add unit tests for `useResultsSelection`, `selection-summary` aggregation, and library filter/sort logic.

## Success Criteria

- [ ] Header shows `Segments` pill; clicking navigates to `/segments` library view.
- [ ] On a query containing `mf_users.user_id` (or any mapped identity dim), Results table shows checkboxes; selecting rows reveals the action bar.
- [ ] `Save as segment` opens the modal; submitting Create new persists a static or live segment via `POST /api/segments`.
- [ ] `Append to existing` lists only static segments and successfully POSTs to `/append`.
- [ ] Library renders KPIs, search filters by name/desc, type tabs filter the table, sort orders correctly.
- [ ] Detail loads on `/segments/:id`; Sample users tab renders 50-row sample with pagination + Reshuffle.
- [ ] Other detail tabs render `TabPending` placeholders without console errors.
- [ ] All FE network calls attach `X-Owner` header.
- [ ] Playwright visual diff passes ≤2% for `library`, `push-flow`, `detail-sample-users` screens at both viewports.
- [ ] No regressions on existing-screen `playground-polish.spec.ts` after this phase merges.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `QueryBuilderResults.tsx` already > 1300 LoC (verified: 1346 LoC); selection extraction may regress copy-cell behavior | Snapshot-test existing cell copy interaction before extraction; preserve event handlers. |
| Antd `Modal` z-index collisions with existing `Tabs.tsx` toggles | Use P0 retheme'd antd Modal (overrides in `antd-overrides.css`); test against `/build` route's existing modals. |
| Visual diff flakes on table row hover / focus state randomness | Disable animations + force hover states off in `screens.spec.ts`; mask known-flaky regions. |
| Owner header from localStorage can be spoofed | Documented limitation (see P1 risk row); revisit when real auth is added. |
| Selection state lost when user paginates Results | Keep `selected` keyed by row id; pagination only re-renders, doesn't unmount. |
