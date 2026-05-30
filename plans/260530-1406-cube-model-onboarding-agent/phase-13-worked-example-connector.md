# Phase 13 — Live worked-example connector (existing model)

**Context:** [plan.md](./plan.md) · v2 Decision 4 (read live from cube-dev model files).
Independent of the connect stack — can land early as the visual baseline. Read-only.

## Overview
- **Priority:** P1 (anchors the whole UX — the thing users imitate).
- **Status:** Planned.
- Surface the **existing Trino connection + the committed cube YAMLs** as a read-only "example"
  connector inside `/data`: its datasets, cubes, dimensions, measures, and joins rendered the same
  way a freshly-modeled source would be — so adding a new source and wiring it in is visualizable.

## Key Insights
- Real model lives at `cube-dev/cube/model/cubes/<game>/*.yml` (per `VITE_CUBE_MODEL_DIR`, startup-
  verified). Games: ballistar/cfm/jus/muaw/ptg/pubg; cubes: active_daily, mf_users,
  ordered_event_funnel, recharge, retention, user_recharge_daily.
- The Trino connector already exists (config-seed, `game_integration`). This phase doesn't
  re-provision it — it *annotates* it with the parsed existing model so its detail view shows the
  real cubes, not an empty Datasets tab.
- Parsing is read-only; reuse the writer's path resolution (`VITE_CUBE_MODEL_DIR`) inverted.

## Requirements
**Functional**
- `existing-model-reader.ts`: parse `model/cubes/<game>/*.yml` → `{ cube, sqlTable, dataSource?,
  dimensions[], measures[], joins[] }[]`. Tolerate missing dirs (a game without views = no views).
- `GET /api/onboarding/example-model?game=` → parsed model for the example connector. Read-only,
  cached via `meta-cache` style (mtime-keyed).
- FE: the Trino connector's detail Datasets/Model tab renders the parsed cubes (read-only badges:
  "existing model", per-field source). Joins shown in the entity-graph view (`view-graph.tsx`).

**Non-functional**
- Strictly read-only; never writes; large-model safe (lazy per-game read).

## Architecture
`existing-model-reader` (YAML parse) → `/api/onboarding/example-model` → FE renders in
`ConnectorDetail` using the same components the builder/triage use (consistency by construction).

## Related Code Files
- **Create:** `server/src/services/existing-model-reader.ts`, route in `onboarding.ts`
  (`GET /example-model`).
- **Modify:** `src/pages/Data/connector-detail.tsx` / `dataset-tables.tsx` (render existing model
  read-only), `src/api/onboarding-client.ts` (fetch example model).
- **Read for context:** `vite-plugins/schema-write-*` (path resolution), `cube-model-writer.ts`,
  `view-graph.tsx`, a sample YAML (`cube-dev/cube/model/cubes/ballistar/mf_users.yml`).

## Implementation Steps
1. `existing-model-reader.ts`: enumerate + parse per-game cube YAMLs → normalized model shape.
2. `GET /api/onboarding/example-model` with mtime-keyed cache; honor active game.
3. Render in connector detail: cubes list + per-cube dimensions/measures/joins, "existing model"
   read-only styling (design tokens; mirror triage field rows).
4. Feed joins into `view-graph.tsx` so the example shows its relationship graph.

## Todo
- [ ] existing-model-reader (read-only YAML parse, missing-dir tolerant)
- [ ] GET /example-model + mtime cache
- [ ] Connector-detail renders existing model (read-only)
- [ ] Entity-graph shows existing joins

## Success Criteria
- Open the Trino connector in `/data` → see the real ballistar (etc.) cubes with their actual
  dimensions/measures/joins, read-only, matching what's committed in cube-dev.
- No write path touched; missing game dir handled gracefully.

## Risks & Mitigation
- **Coupling to cube-dev layout:** isolate path/format assumptions in the reader; if dir absent,
  show "model source not mounted" instead of erroring (mirrors v1 middleware tolerance).
- **YAML drift vs `/meta`:** this reads files (authoring view), not `/meta` (compiled view) — note
  the distinction in UI copy so users understand it's the source model.

## Security
- Read-only, server-side path confined to `VITE_CUBE_MODEL_DIR`; no traversal (slug-validate game).

## Next
Phase 15 merges new sources against this existing model (it's the join target).
