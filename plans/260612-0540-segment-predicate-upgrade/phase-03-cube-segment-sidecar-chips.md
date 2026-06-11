---
phase: 3
title: "Cube-segment sidecar chips"
status: pending
priority: P2
effort: "4h"
dependencies: []
---

# Phase 3: Cube-segment sidecar chips

## Overview
Promote the cube-segment sidecar from a read-only banner to first-class scope chips in the predicate builder: chips for the cube's model-defined segments (from /meta), sidecar ones ON, owner/admin can toggle off or add others. Server gains `cube_segments` PATCH support.

## Requirements
- Functional:
  - Builder shows ALL model-defined segments of the primary cube as chips; ones present in the stored sidecar render active.
  - Owner/admin can toggle; non-owner sees them disabled with tooltip (same gate as predicate edits).
  - Hover/tooltip shows the segment's `title`/description from /meta so "last_30d" is self-explanatory.
  - Save persists the chip set; refresh + cards + profiles all honor the new set.
- Non-functional: untouched segments keep byte-identical `cube_query_json.segments` (no churn from reordering — sort canonically).

## Architecture
- /meta `cubes[].segments` lists model segments (name, title) — extend the phase-2 catalog hook to expose them.
- FE: `editor-view.tsx` already holds `cubeSegments` state (read-only today, parsed by `parseCubeSegmentsFromQueryJson`); replace banner-only render with chips bound to that state.
- Server: add `cube_segments: z.array(z.string().min(1)).optional()` to `segmentPatchSchema` (input schema already has it for create). In the PATCH handler, when provided AND user can administer: rebuild `cube_query_json` via `withCubeSegments({filters}, patch.cube_segments)`; treat a CHANGE as cohort-redefining → same auto-refresh trigger as predicate change. When omitted: existing carry-forward behavior unchanged.
- FE save payload (`editor-view.tsx handleSave`) includes `cube_segments` for predicate segments.

## Related Code Files
- Modify: `server/src/routes/segments.ts` (patch schema + handler), `src/pages/Segments/editor/editor-view.tsx`, `src/pages/Segments/slice-scope/parse-cube-segments.ts` (export canonical sort if missing), new chip component `src/pages/Segments/editor/cube-segment-scope-chips.tsx`
- Tests: extend `server/test/segment-cube-segments-sidecar.test.ts`; new FE test for chip toggling

## Implementation Steps
1. Server: patch schema + handler change (administer-gated, refresh on change, carry-forward when omitted). Extend sidecar test: PATCH with cube_segments rewrites sidecar + enqueues refresh; PATCH without preserves; non-owner 403.
2. Catalog hook: expose model segments per cube (phase 2 hook or standalone if phase 2 not yet merged — keep import surface independent).
3. Chip component: design-token styled (reuse `sliceScopeChip` styles), active/inactive states, owner/admin gate via `segment.can_administer`.
4. Wire into editor predicate step replacing the read-only banner; save includes chip set.
5. E2E sanity: toggle `last_30d` off on a test segment → size grows; toggle back → size returns.

## Success Criteria
- [ ] Chips render with /meta titles; sidecar ones active; non-owner read-only
- [ ] PATCH persists set; refresh recomputes; carry-forward preserved when field omitted
- [ ] Server + FE tests green

## Risk Assessment
- **Silent widening**: removing a chip widens membership — gated owner/admin + auto-refresh makes the effect immediately visible (size KPI). Add a confirm when removing the LAST time-bounding segment (heuristic: name contains date-ish tokens) — cheap guard against the unbounded-scan footgun seen on first refresh of b7a6cae9.
- **Meta drift**: chip for a segment later removed from the model → drift resolver already flags "(cube segment)" drift; no new handling.
