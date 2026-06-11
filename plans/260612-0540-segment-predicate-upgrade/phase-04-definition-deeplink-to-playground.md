---
phase: 4
title: "Definition deeplink to playground"
status: pending
priority: P1
effort: "4h"
dependencies: []
---

# Phase 4: Definition deeplink to playground

## Overview
Repoint "Open in Playground" to carry the segment's DEFINITION (predicate filters + cube-segment sidecar + identity dim + count measure) plus an edit-target marker, replacing the broken frozen-uid deeplink (`?from-segment=` has no consumer — `QueryBuilderContainer.tsx:182` comment only; uid-IN payloads >8000 chars always hit that dead path today).

## Requirements
- Functional:
  - Button on detail header + editor predicate step opens `#/build?query=<definition>&edit-segment=<id>`.
  - Definition query: `{ measures:[<cube>.count], dimensions:[identityDim], filters: treeToCubeFilters(tree), segments: sidecar, timeDimensions: [] }` — small, always inlineable.
  - Playground boots with the query applied AND recognizes `edit-segment` → exposes `{segmentId, segmentName}` editing context (consumed in phase 5).
  - Manual segments: definition = `{identityDim IN uids}` only when the inline URL fits; otherwise button disabled with tooltip "cohort too large to explore by ids — convert to live first" (composes with the convert fix, aad460a).
- Non-functional: remove the dead `from-segment` emission path or implement its sessionStorage consumer — no half-wired branches left.

## Architecture
- **[RED-TEAM C2]** Build the definition from `predicate_tree_json`, NOT `cube_query_json` — the stored query has relative dates already expanded to literal tuples (`translator.ts:114-131`); deeplinking it and saving back would freeze rolling windows forever. New FE util `predicate-tree-to-cube-query.ts` maps tree leaves → filters/timeDimensions preserving relative literals (`inDateRange` leaf value "last 30 days" → `timeDimensions[].dateRange: "last 30 days"`). Sidecar `segments` still come from `cube_query_json`.
- Rework `src/utils/playground-deeplink.ts`: new `buildDefinitionDeeplink({segment, tree, cubeSegments, identityDim})`; keep pure-module contract.
- **[RED-TEAM major]** Boot query MUST satisfy the save-bar render gates (`QueryBuilderResults.tsx:1609,829` — bar renders only in uid/expansion mode): include `identityDim` in `dimensions` with a sane `limit` (e.g. 100) so mode='uid' activates and Update is reachable. Document the row-per-user trade-off in code.
- **[RED-TEAM major]** Implement the sessionStorage fallback FOR REAL (oversize definitions from expansion-born segments): emit `?edit-segment=<id>` and a stashed payload; QueryBuilderContainer consumes it (pattern: `from-chat-artifact` at `:177`). Also migrate the other dead-path caller `saved-analyses-tab.tsx:43`.
- **[RED-TEAM major]** Deeplink carries `game_id` + workspace; QueryBuilderContainer compares against the active game context and warns/switches before applying — filters referencing cubes absent from the booted /meta must not silently no-op.
- `QueryBuilderContainer.tsx`: parse `edit-segment` param at boot (alongside existing `?query=` handling); stash `{segmentId, segmentName, returnedFrom}` in component state/context for phase 5's banner + save bar. Follow the existing `from-chat-artifact` pattern at `:177` for param consumption.
- Detail header (`detail-header-actions.tsx:39`): swap `buildPlaygroundDeeplink` call for the definition variant; drop the `uid_list.length === 0` disable in favor of definition availability.

## Related Code Files
- Modify: `src/utils/playground-deeplink.ts` (+ its `__tests__`), `src/pages/Segments/detail/components/detail-header-actions.tsx`, `src/pages/Segments/editor/editor-view.tsx` (button in predicate step), `src/components/PlaygroundQueryBuilder/QueryBuilderContainer.tsx`
- Read: existing `?query=` + `from-chat-artifact` boot handling in QueryBuilderContainer

## Implementation Steps
1. FE `predicate-tree-to-cube-query.ts`: tree → `{filters, timeDimensions}` preserving relative date literals; unit tests incl. every leaf op.
2. Deeplink util: `buildDefinitionDeeplink` from `predicate_tree_json` (+ sidecar `segments` from `cube_query_json`, identityDim, game_id); records injected echo filters for phase 5's deterministic strip; unit tests (definition inlines; manual small-list inlines; oversize → sessionStorage payload; manual oversize without tree returns `{disabled, reason}`).
3. Replace dead `from-segment` branch with a real sessionStorage consumer in QueryBuilderContainer (pattern of `from-chat-artifact`); migrate `saved-analyses-tab.tsx:43` caller + existing tests.
4. QueryBuilderContainer: consume `edit-segment` → editing context (incl. echo-filter record + game guard); verify boot applies filters + segments + identity dim and the save bar's uid-mode render gate is satisfied.
5. Wire detail-header + editor buttons; disable states + tooltips.
6. Manual check on b7a6cae9: lands in /build with `os_platform=pc` filter + `last_30d` segment active + `mf_users.user_id` dimension (post phase 1) and a live count.

## Success Criteria
- [ ] b7a6cae9 "Open in Playground" boots /build with its definition applied — no empty playground
- [ ] `edit-segment` context available to the save bar (asserted via test)
- [ ] Dead from-segment path gone; deeplink tests green

## Risk Assessment
- **Identity dim in dimensions makes the boot query heavy** (one row per user). Mitigation: boot with measures-only (`count`) and the filters/segments applied; identity dim available but not pre-selected — decide during impl, note in code why.
- **Param collisions**: `query=` + `edit-segment=` must compose; keep `edit-segment` purely additive so existing `?query=` flows are untouched.
