---
phase: 2
title: "Schema snapshot + inference"
status: complete
priority: P1
effort: "6h"
dependencies: [1]
---

# Phase 2: Schema snapshot + inference

## Overview
Pure logic that turns raw column profiles into an inferred model skeleton — which columns
are dimensions vs measures vs time-dimensions, candidate primary keys, and candidate joins —
each tagged with a confidence score so the UI can ask only about low-confidence calls.

## Requirements
- Functional: classify each column; detect PK (unique + `*_id`/`id` naming); detect FK/join candidates (naming `*_id` matching another table's PK + value-overlap heuristic); flag time dimensions (date/timestamp types); emit confidence 0–1 per decision.
- Non-functional: pure module (no I/O), deterministic, fully unit-testable.

## Architecture
- New `server/src/services/raw-schema-inference.ts`.
- Heuristics:
  - **Dimension:** low approx-distinct ratio string/enum, or boolean, or PK/FK.
  - **Measure candidate:** numeric with high distinct ratio and not an id.
  - **Time dimension:** date/timestamp type.
  - **PK:** `isUnique` (approxDistinct ≈ rowCount) AND name in {`id`, `{table}_id`}.
  - **Join:** column `x_id` whose stem matches another profiled table name/PK; confidence boosted by sampled value-overlap.
- Output `InferredSchema` mirroring the `snapshotFromMeta` shape idea (`metric-ref-validator.ts:65-78`): typed sets/arrays of `{cube, dimensions[], measures[], timeDimensions[], joins[], confidenceByField}`.
- Confidence thresholds centralized as constants (reused by UID to decide accept-auto vs ask).

## Related Code Files
- Create: `server/src/services/raw-schema-inference.ts`, extend `server/src/types/raw-schema.ts` with `InferredSchema`.
- Read for context: `server/src/services/metric-ref-validator.ts:28-109` (snapshot shape, parseFqn), `ColumnProfile` from Phase 01.

## Implementation Steps
1. Define `InferredSchema` + `InferredField` types (role, confidence, rationale).
2. Implement column-role classifier from `ColumnProfile` stats.
3. Implement PK detection (uniqueness + naming).
4. Implement join inference (naming match across tables + optional sample-overlap boost).
5. Centralize confidence thresholds; attach a short `rationale` string per decision.
6. Unit tests with synthetic profiles (deferred to Phase 08, but write fixtures here).

## Success Criteria
- [x] Given fixture profiles, classifier yields expected roles + confidences.
- [x] PKs and at least one cross-table join detected on a realistic fixture.
- [x] Module is pure (no import of db/fetch); 100% deterministic on fixed input.

## Risk Assessment
- **Over-eager join inference** → keep joins as *suggestions* with confidence; never auto-accept low-confidence joins (UI gate in Phase 06).
- **Heuristic brittleness across games** → thresholds as named constants, tuned with fixtures; LLM refines later (Phase 07).
