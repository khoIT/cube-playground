---
phase: 5
title: "Save-back from playground"
status: pending
priority: P1
effort: "6h"
dependencies: [4]
---

# Phase 5: Save-back from playground

## Overview
Close the loop: when /build holds an `edit-segment` context, show a persistent "Refining: <segment>" banner and give SegmentsSaveBar an "Update segment" primary action that converts the current playground query back into a predicate tree + cube-segment sidecar, PATCHes the segment, and navigates back. Auto-refresh fires via the existing predicate-change path.

## Requirements
- Functional:
  - Banner: segment name, "changes apply on Update", ✕ to exit editing mode (drops context, save bar reverts to create-new behavior).
  - Save bar in edit mode: primary "Update <name>" replaces "Save as segment"; secondary "Save as new" keeps the create path.
  - Update action: playground query → `buildPredicateFromRows`-derived tree (filters + timeDimensions dateRanges) + `query.segments` sidecar → `segmentsClient.update(id, {predicate_tree, cube_segments, type:'predicate'})` → success toast → `history.push('/segments/<id>')`.
  - Manual segment as edit-target: update converts it to live (`type:'predicate'` — supported since aad460a); confirm dialog states the conversion.
  - Conflicts: last-write-wins (locked decision); no updated_at guard.
- Non-functional: tree produced must round-trip — `treeToCubeFilters(tree)` equals the playground filters modulo canonical ordering (asserted by tests); measures/order/limit are NOT persisted (cohort definition is filters+segments only) — banner copy says so.

## Architecture
- Editing context from phase 4 (QueryBuilderContainer state) threaded to `SegmentsSaveBar` via props alongside existing `executedQuery`.
- Reuse `buildPredicateFromRows` (`build-predicate-from-rows.ts:171`) — it already handles filters + dateRange literals + simplification. Identity-IN filters injected by the deeplink for manual segments must be STRIPPED before tree-building (they're cohort echo, not definition) — strip any leaf on the identity dim with op `in`/`equals` when it matches the edit context's identityDim and value count is large; keep deliberate small identity filters (edge: user genuinely filtering 3 uids — accept loss, document).
- `cube_segments` PATCH support lands in phase 3 (server). If phase 3 unmerged, ship the server schema change here — single source: check before duplicating.
- New `playground-edit-segment-banner.tsx` component near QueryBuilderContainer; design tokens only.

## Related Code Files
- Create: `src/components/PlaygroundQueryBuilder/playground-edit-segment-banner.tsx`
- Modify: `src/QueryBuilderV2/segments-save-bar/segments-save-bar.tsx`, `src/components/PlaygroundQueryBuilder/QueryBuilderContainer.tsx`, `src/api/segments-client.ts` (update signature if cube_segments missing)
- Tests: `segments-save-bar/__tests__` — edit-mode rendering, update payload shape, identity-echo stripping, manual→live confirm

## Implementation Steps
1. Thread editing context into save bar; render mode switch (update primary / save-as-new secondary).
2. Banner component + dismiss semantics.
3. Update action: strip identity echo → `buildPredicateFromRows` → payload incl. `cube_segments` from `executedQuery.segments` → PATCH → navigate. Surface PATCH 400 (e.g. translator error) as toast with the server message.
4. Manual→live confirm dialog.
5. Tests per list above; round-trip property test: definition → deeplink query → save-back tree → `treeToCubeFilters` ≅ original filters.

## Success Criteria
- [ ] Full loop on b7a6cae9: open in playground → add `mf_users.total_spend > 100` → Update → segment detail shows new predicate, status refreshing, new cohort size
- [ ] Save-as-new still works in edit mode
- [ ] Identity-echo never appears in a saved predicate (test)
- [ ] Round-trip equivalence test green

## Risk Assessment
- **Lossy translation**: playground expresses things the tree can't (measure filters with grouping, boolean OR across cubes in one filter object). `buildPredicateFromRows` simplification + phase 6 fidelity matrix decides: block Update with explanatory tooltip when query contains untranslatable constructs, never silently drop.
- **Stale edit context** after tab sits open: PATCH may 403/404 (segment deleted/unshared) — handle both with a toast + drop edit mode.
