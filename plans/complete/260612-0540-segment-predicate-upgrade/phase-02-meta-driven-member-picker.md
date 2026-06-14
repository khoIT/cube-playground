---
phase: 2
title: Meta-driven member picker
status: completed
priority: P1
effort: 5h
dependencies: []
---

# Phase 2: Meta-driven member picker

## Overview
Replace the free-text member `Input` in the predicate builder with a searchable, /meta-fed Select grouped by cube (segment cube + its joined cubes), auto-setting the leaf value type. Add value suggestions for low-cardinality string dimensions.

## Requirements
- Functional:
  - Member field = searchable Select; options = dimensions (and filterable measures) of the segment's cube + cubes reachable via its joins, grouped with cube headers.
  - Picking a member auto-sets leaf `type` (string/number/time) from /meta `type`; the manual type Select stays as an override but pre-fills.
  - String dims: on value-input focus, fetch distinct values once (`{dimensions:[dim], limit:50}`) and offer as suggestions; free text still allowed (AutoComplete, not strict Select).
- Non-functional: /meta fetched once per cube (reuse `useCubeMetaMembers` cache pattern); no regression for segments whose cube is missing from /meta (picker degrades to free text).

## Architecture
- New `use-predicate-member-catalog.ts` hook: wraps cubejs `meta()` (same source as `use-preset.ts` auto path), returns `{ groups: [{cube, members:[{name, title, type, kind}]}] }` for primary cube + join-connected cubes. Join reachability from meta's `connectedComponent`/joins info; fallback = primary cube only.
- `predicate-leaf.tsx`: `Input` → antd `Select` with `showSearch`, grouped options, `onChange` also calls `setLeafType(metaType)`. Keep free-text entry via `mode="tags"`-style escape or a small "custom" option so power users aren't blocked by stale meta.
- New `use-dim-value-suggestions.ts`: lazy one-shot distinct-values query per dim, cached per (workspace, game, dim); plugged into `value-input.tsx` for string ops as AutoComplete options.

## Related Code Files
- Create: `src/pages/Segments/editor/predicate-builder/use-predicate-member-catalog.ts`, `src/pages/Segments/editor/predicate-builder/use-dim-value-suggestions.ts`
- Modify: `src/pages/Segments/editor/predicate-builder/predicate-leaf.tsx`, `value-input.tsx`, `predicate-group.tsx` (pass cube + catalog down), `editor-view.tsx` (provide segment cube)
- Read: `src/pages/Segments/detail/tabs/use-cube-meta-members.ts`, `src/pages/Segments/presets/auto-preset.ts` (meta parsing prior art)

## Implementation Steps
1. Build `use-predicate-member-catalog` from `cubejsApi.meta()`; map cube → dimensions/measures with type + title; restrict to primary cube + joined cubes; memoize module-level like `autoPresetCache`.
2. Thread `primaryCube` + catalog through `renderRoot` props (predicate-group → leaf).
3. Swap leaf member Input → grouped searchable Select; auto-set type on pick; preserve existing value when member unchanged.
4. Value suggestions hook + AutoComplete wiring in `value-input.tsx` (string type, equals/in/notIn ops only).
5. Unit tests: catalog grouping from a meta fixture; leaf type auto-set; degraded path (meta unavailable → free text Input).
6. Visual cross-check against design tokens (no new bespoke styles; mirror existing editor Select styling).

## Success Criteria
- [ ] On b7a6cae9 edit, member dropdown lists active_daily dims + mf_users dims with group headers
- [ ] Picking `active_daily.os_platform` auto-sets type=string; value field suggests `pc` etc. on focus
- [ ] Meta-unavailable degrades to today's free-text behavior (test)
- [ ] FE tests + tsc clean

## Risk Assessment
- **Meta payload size**: full /meta per game is large but already fetched by auto-preset path — reuse, don't refetch.
- **Joined-cube validity**: a join existing in meta doesn't guarantee the filter compiles for cohorting; phase 6 e2e covers a cross-cube predicate refresh.
- **High-cardinality value fetch**: cap limit 50 + only on focus; never for number/time types.
