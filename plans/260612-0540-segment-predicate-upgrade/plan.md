---
title: 'Segment predicate upgrade: discoverable filters + playground round-trip'
description: >-
  Make segment predicates explorable (meta-driven picker, editable cube-segment
  scope) and close the build↔segment loop: refine a segment's definition in the
  playground and save it back
status: completed
priority: P2
branch: main
tags:
  - segments
  - predicate-builder
  - playground
  - identity-map
blockedBy: []
blocks: []
created: '2026-06-11T22:54:45.218Z'
createdBy: 'ck:plan'
source: skill
---

# Segment predicate upgrade: discoverable filters + playground round-trip

## Overview

Born from the b7a6cae9 (`pc online last 30 days`, jus_vn/active_daily) investigation. Three confirmed gaps:

1. **Preset-less cubes are second-class.** No `cube_identity_map` row for `active_daily` → no pivot to the mf_users preset → "Auto preset" chip, uid-only Members tab, no 360. The join exists in the model (`jus/active_daily.yml:12`).
2. **Predicate builder is blind.** Member field is a free-text `Input` (`predicate-leaf.tsx:35`); cube-segment scope (`active_daily.last_30d` sidecar) is a read-only banner. Users can't discover what's filterable.
3. **The build↔segment loop is broken.** `?from-segment=` deeplink has NO consumer (only a comment at `QueryBuilderContainer.tsx:182`); any segment whose uid-IN query exceeds 8000 chars (i.e. nearly all) opens an empty playground. There is no path from playground back into an existing segment's predicate.

**Core deliverable (user-stated): the round-trip, end-to-end.** One "Open in Playground" button carrying the segment's DEFINITION (predicate filters + cube-segment sidecar + identity dim) with an edit-target; full QueryBuilder exploration; "Update segment" save-back that PATCHes the predicate and auto-refreshes. Phases 1–3 make the in-editor experience self-sufficient; 4–5 are the loop; 6 proves it.

**Locked decisions (user-confirmed 2026-06-12):**
- Pivot sweep covers ALL jus_vn cubes joining mf_users (not just active_daily); accepts uid-space re-cohort.
- Member picker offers segment cube + joined cubes.
- Sidecar chips: toggle existing + add from model, owner/admin-gated.
- ONE playground button (definition mode); frozen-uid mode retired (it was already broken).
- Save-back: editing banner + save-bar update mode; conflicts last-write-wins.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Identity-anchor pivot sweep](./phase-01-identity-anchor-pivot-sweep.md) | Completed |
| 2 | [Meta-driven member picker](./phase-02-meta-driven-member-picker.md) | Completed |
| 3 | [Cube-segment sidecar chips](./phase-03-cube-segment-sidecar-chips.md) | Completed |
| 4 | [Definition deeplink to playground](./phase-04-definition-deeplink-to-playground.md) | Completed |
| 5 | [Save-back from playground](./phase-05-save-back-from-playground.md) | Completed |
| 6 | [Round-trip E2E + red-team fixes](./phase-06-round-trip-e2e-red-team-fixes.md) | Completed |

Order: 1–3 independent of 4–5 (parallel-safe by file ownership); 5 depends on 4; 6 depends on all.

## Key prior art (verified this session)

- `treeToCubeFilters` (server `services/translator.ts`) — tree → Cube filters; sidecar re-attach via `withCubeSegments` (`routes/segments.ts:609`).
- `buildPredicateFromRows` (`src/QueryBuilderV2/segments-save-bar/build-predicate-from-rows.ts:171`) — playground query (filters + timeDimensions dateRange) → predicate tree. THE reverse translator; save-back reuses it.
- Tree already supports time ops (`inDateRange`/`beforeDate`/`afterDate`, `operators.ts`).
- PATCH `/api/segments/:id` accepts `predicate_tree` + (since aad460a) `type`; predicate change auto-enqueues refresh. Patch schema does NOT yet accept `cube_segments` (phase 3/5 server work).
- `useCubeMetaMembers` + `physicalMember` — /meta validation plumbing the picker reuses.
- Refresh honors the sidecar end-to-end (`refresh-segment.ts:157` spreads stored `cube_query_json` incl. `segments`).

## Red-team amendments (2026-06-12, report: reports/from-red-team-to-planner-roundtrip-plan-attack-report.md)

Three criticals folded into phases:
- **C1 — `cube_identity_map` is GLOBAL** (`cube TEXT PRIMARY KEY`): `active_daily` exists in 7 game models; a "jus sweep" rebinds identity for all of them (cfm's vopenid namespace would break). Phase 1 now starts with a cross-game collision audit; if any game's join semantics differ → game-scoped identity-map migration is a phase-1 pre-step.
- **C2 — relative-date freeze**: `cube_query_json` holds dates already expanded to literals; deeplinking from it then saving back permanently freezes rolling windows. Phase 4 now builds the deeplink from `predicate_tree_json` (which retains relative literals) via an FE tree→query mapping.
- **C3 — no silent-drop guard**: `buildPredicateFromRows` silently nulls unsupported operators → a zero-edit round-trip could widen the cohort. Phase 5 now specifies an explicit translatability gate (construct-consumption diff) + deterministic identity-echo tagging (no heuristics).

Majors folded: save-bar render-gate visibility (phase 4 boot query), cross-cube sidecar chips read-only (phase 3), PATCH precedence spec (phase 3), `applyGameFilter` echo strip + workspace/game mismatch guard (phase 5), sessionStorage deeplink fallback with real consumer + `saved-analyses-tab.tsx:43` migration (phase 4), six extra fidelity rows (phase 6).

## Dependencies

None cross-plan. Tangent: `260609-2323-coalesce-same-source-care-sweep-queries` consumes `treeToCubeFilters` output server-side — phases here don't change translator semantics, only authoring UX.
