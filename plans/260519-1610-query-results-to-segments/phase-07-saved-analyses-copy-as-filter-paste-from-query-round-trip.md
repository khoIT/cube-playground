---
phase: 7
title: "Saved analyses + Copy as filter + Paste from query round-trip"
status: pending
priority: P2
effort: "4d"
dependencies: [0, 2, 4]
---

# Phase 7: Saved analyses + Copy as filter + Paste from query round-trip

## Overview

Close the Playground ↔ Segments round-trip. Implement the **Saved analyses** tab (user-pinned Cube queries per segment, rendered inline + re-openable in Playground), plus two top-level actions: `Copy as filter` (segment → Playground deeplink with uid IN-filter pre-applied) and `Paste from query` (Playground filters → editor tree, wired in P5 but completed here).

## Requirements

**Functional**
- Saved Analyses tab:
  - Lists `segment.analyses[]` with name, chart-kind icon, created date.
  - Inline renders each as a card (chart per `chart_kind`).
  - Each card has `Open in Playground` action.
  - "Pin current Playground query" entry point (from Playground side — see below).
  - Edit name / delete analysis from the card overflow menu.
- Playground integration — `Pin to segment`:
  - Button in Playground toolbar (next to Save in Settings menu) opens a dropdown of the user's segments.
  - Picking a segment posts `POST /api/segments/:id/analyses` with current `query` JSON + chart kind.
- Detail header `Copy as filter`:
  - Constructs a Cube Query filter `{ member: segment.identity_dim, operator: 'in', values: segment.uids }`.
  - Opens Playground (`/build?query=...`) with this filter merged into a baseline query (measures: `[segment.primary_cube.count]`).
  - User can then add their own dims/measures.
- Saved analysis `Open in Playground`:
  - Same as `Copy as filter` but seeds the saved analysis's query first, then applies the segment uid filter on top.
- Status: each analysis tracks `query_meta_version`; if drifted from current `/meta`, render `status='broken'` card with disabled chart + `Edit in Playground to fix` button.

**Non-functional**
- All Cube queries pass through `useSegmentCubeQuery` from P4 (already cached).
- Pinning a Playground query is one POST; UI shows toast on success.
- `Open in Playground` keeps deep-link query under 8KB URL limit; if longer, falls back to localStorage handoff.
- **Analysis cards reuse P0 chart primitives** (`LineChart`, `BarList`, `Donut`) — never raw recharts directly.

**Visual parity**
- Saved analyses tab cards match the visual language of `screen-detail.jsx` Overview cards within ≤2% pixel delta.
- Toolbar `Pin to segment` dropdown integrates with the existing (P0-retheme'd) QueryBuilder toolbar without breaking the `playground-polish.spec.ts` baseline.

## Architecture

```
src/pages/Segments/detail/
  tabs/
    saved-analyses-tab.tsx
    analysis-card.tsx                  (renders chart + actions)
    analysis-card-menu.tsx
  hooks/
    use-segment-analyses.ts            (list + create + update + delete)

src/QueryBuilderV2/
  components/
    pin-to-segment-button.tsx          (Playground toolbar entry)
    pin-to-segment-dropdown.tsx

src/pages/Segments/detail/
  header/
    copy-as-filter-action.tsx          (button + URL builder)

src/utils/
  playground-deeplink.ts               (shared deeplink builder for both flows)
```

`playground-deeplink.ts` exports `buildDeeplink({ baseQuery, addUidFilter, segmentIdentity })` → `/build?query=...` URL.

## Related Code Files

**Create**
- `src/pages/Segments/detail/tabs/{saved-analyses-tab,analysis-card,analysis-card-menu}.tsx`
- `src/pages/Segments/detail/hooks/use-segment-analyses.ts`
- `src/QueryBuilderV2/components/{pin-to-segment-button,pin-to-segment-dropdown}.tsx`
- `src/pages/Segments/detail/header/copy-as-filter-action.tsx`
- `src/utils/playground-deeplink.ts`

**Modify**
- `src/pages/Segments/detail/detail-view.tsx` — replace Saved analyses `TabPending` with `saved-analyses-tab.tsx`
- `src/pages/Segments/detail/detail-header-actions.tsx` — wire `Copy as filter` button
- `src/QueryBuilderV2/QueryBuilderToolBar.tsx` — add `Pin to segment` button
- `src/api/segments-client.ts` — add `analyses.list/create/update/delete`
- `src/pages/Segments/editor/hooks/use-paste-from-query.ts` (created in P5) — wire to read from URL or context

## Implementation Steps

1. Implement `playground-deeplink.ts`:
   - `buildDeeplink({ baseQuery?, segmentIdentityDim, segmentUids })`.
   - Merges `filters: [...baseQuery.filters, { member: identityDim, operator: 'in', values: uids }]`.
   - URI-encodes; if > 8000 chars, stores `query` in `sessionStorage('gds-cube:pending-deeplink')` and returns `/build?from-segment=<id>`.
2. Modify Playground bootstrap (likely `ExplorePage.tsx`) to read `from-segment` param + pull stored query.
3. Implement `pin-to-segment-button.tsx`:
   - Toolbar button.
   - Opens dropdown listing the user's segments (`segmentsClient.list({ owner: me })`).
   - On segment pick → opens small modal asking analysis name → POST `/api/segments/:id/analyses`.
   - Toast on success: `Pinned to <segment name> →` (link to Detail).
4. Implement `use-segment-analyses.ts` (list + mutations with optimistic updates).
5. Implement `analysis-card.tsx`:
   - Receives `{ analysis, segment }`.
   - Uses `useSegmentCubeQuery(segmentId, { ...analysis.query, scope: 'analysis' })` (auto-scopes uid filter).
   - Renders chart via existing `chart_kind` → component map (reuse from P4 cards where possible).
   - Header: name + chart-kind icon + overflow menu.
6. Implement `analysis-card-menu.tsx` — Rename, Delete, Open in Playground.
7. Implement `saved-analyses-tab.tsx`:
   - Grid of `analysis-card`s.
   - Empty state: "No analyses yet — pin one from Playground".
8. Implement `copy-as-filter-action.tsx`:
   - Builds deeplink with empty base query (or `{ measures: [primary_cube.count] }`).
   - Opens in new tab (`target="_blank"`) or current tab — pick one (recommend current; user can cmd-click for new).
9. Wire all entry points (Playground toolbar, Detail header, analysis card menu).
10. Implement broken-analysis surfacing:
    - On render, compare `analysis.query_meta_version` to current `/api/meta/version`.
    - On mismatch → grey out card + show "Edit in Playground to fix" CTA.
11. Add tests:
    - `playground-deeplink.test.ts` — short query goes in URL; long query uses sessionStorage path.
    - `use-segment-analyses.test.ts` — optimistic add survives server error rollback.

## Success Criteria

- [ ] Playground toolbar shows `Pin to segment ▾`; selecting a segment + naming creates an analysis row.
- [ ] Saved Analyses tab in segment Detail renders the pinned charts with uid filter applied.
- [ ] `Open in Playground` from an analysis card opens `/build` with the saved query + uid filter pre-applied.
- [ ] `Copy as filter` from Detail header opens Playground with the uid IN-filter seeded.
- [ ] Long uid lists (>5,000 uids serialized → >8KB URL) use sessionStorage handoff without truncation.
- [ ] Renaming + deleting an analysis works with optimistic UI.
- [ ] Analysis cards whose `query_meta_version` is stale surface a broken state.
- [ ] Playwright visual diff passes ≤2% for `detail-saved-analyses` screen at both viewports.
- [ ] `playground-polish.spec.ts` still passes with the new `Pin to segment` toolbar entry.

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Cube query in URL hits browser URL length limit | sessionStorage handoff fallback; documented threshold. |
| Saved analyses with renamed measures break silently | Track `query_meta_version`; surface broken state; CTA to repair. |
| Optimistic mutations on analyses get out of sync with server | Reconcile after each server response; toast on rollback. |
| Pin-to-segment dropdown lists too many segments | Virtualize + search; cap shown to 50 with "more…" link to Library. |
| `Copy as filter` overwrites in-progress Playground state | Confirm dialog if Playground has unsaved changes; or always open in new tab if `cmd`-click — opted: current tab with confirm. |
| Round-trip introduces a circular dependency between Playground and Segments | Keep deeplink builder in `src/utils/`; both surfaces import the same helper. |
