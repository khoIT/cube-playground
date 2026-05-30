---
phase: 3
title: "Cube-model scaffolder"
status: complete
priority: P1
effort: "5h"
dependencies: [2]
---

# Phase 3: Cube-model scaffolder

## Overview
Turn an accepted `InferredSchema` into a draft Cube data-model YAML object (cubes /
`sql_table` / dimensions / measures / joins), Zod-validated. Mirrors the
`metric-stub-scaffolder` doctrine but emits a **different artifact** — a Cube model, not a
business metric — in its own module.

## Requirements
- Functional: produce a Cube-model object matching cube-dev's YAML shape (`cubes[]` with `name`, `sql_table`, `dimensions[]`, `measures[]`, `joins[]`); default a `count` measure; map inferred roles to Cube member definitions; id/name slug + collision suffix; serialize to YAML identical in shape to `cube-dev/cube/model/cubes/{game}/*.yml`.
- Non-functional: pure; Zod-valid output guaranteed; never writes to disk (Phase 04/05 handle persistence).

## Architecture
- New `server/src/services/cube-model-scaffolder.ts` — **do NOT extend `metric-stub-scaffolder.ts`** (separate artifact, separate write path).
- New `server/src/types/cube-model.ts` — `CubeModelSchema` (Zod) matching observed YAML structure (verified against `cube-dev/cube/model/cubes/ballistar/active_daily.yml`). Single source of truth for server + frontend.
- Functions:
  - `scaffoldCubeModel(inferred: InferredSchema, takenNames?: Set<string>): { model, cubeName }` — collision suffix like `metric-stub-scaffolder.ts:75-79`.
  - `toYaml(model): string` — emit YAML in cube-dev's exact key style.
- Dimension → Cube dimension (sql `{CUBE}.col`, type); measure candidate → Cube measure (type `sum`/`count`/etc., default `count`); join → Cube `joins[]` with `relationship` + `sql` condition from inferred FK.

## Related Code Files
- Create: `server/src/services/cube-model-scaffolder.ts`, `server/src/types/cube-model.ts`.
- Read for context: `server/src/services/metric-stub-scaffolder.ts:59-96` (doctrine, collision logic), `server/src/types/business-metric.ts:97-116` (Zod-as-contract pattern), `cube-dev/cube/model/cubes/ballistar/active_daily.yml` (target YAML shape), `vite-plugins/schema-write-handler.ts` (how YAML is currently spliced/serialized — match its style).

## Implementation Steps
1. Read a real cube-dev YAML; define `CubeModelSchema` to match exactly (cubes/dimensions/measures/joins/segments/pre_aggregations optional).
2. Implement role→member mapping (dimension/measure/time-dimension).
3. Implement join emission from inferred FK candidates.
4. Add name-slug + collision suffix.
5. `toYaml` matching cube-dev key ordering/quoting (reuse the YAML lib the schema-write handler uses).
6. `CubeModelSchema.parse()` before returning.

## Success Criteria
- [x] Scaffolded model round-trips through `CubeModelSchema` without error.
- [x] Emitted YAML loads in Cube (manually drop into cube-dev, confirm `/meta` lists the cube).
- [x] Output key style matches existing cube-dev YAMLs (diff-clean).
- [x] No coupling to `metric-stub-scaffolder.ts`.

## Risk Assessment
- **YAML shape drift vs Cube version** → derive schema from a live cube-dev file, not docs; Phase 08 round-trip test.
- **Wrong measure aggregation type** → default conservatively to `count`; richer types come from accept/reject + LLM (Phase 07).
