# Phase 15 — Cross-source merge at the model layer

**Context:** [plan.md](./plan.md) · v2 Decision 2 (co-locate + same-source joins; visualize +
flag cross-source). Depends on Phase 14 (builder Joins step) + Phase 13 (existing model = join target).

## Overview
- **Priority:** P1.
- **Status:** Planned.
- A **workspace model** spanning cubes from multiple connectors. Same-source joins compile to real
  `joins:` YAML and execute. Cross-`dataSource` links are **declared + flagged** (advisory: Cube
  needs `rollupJoin`/pre-agg; NOT executed in v2) and rendered distinctly in the entity graph.

## Key Insights
- Cube CANNOT do direct SQL joins across `dataSource`s — only `rollupJoin` over pre-aggregations.
  v2 is honest about this: cross-source edges are first-class *intent* in the model graph but
  compile to a flagged/advisory artifact, not an executing join.
- The merge surface is the existing entity-graph view (`view-graph.tsx`) — extend with cross-source
  edge styling + a "needs rollupJoin" badge; don't build a new canvas.
- Co-location = cubes from connector A and connector B both appear in one workspace model namespace;
  each cube carries `data_source:` (Phase 10). The writer already targets per-game dirs — extend the
  target-resolution to be connector/dataSource-aware.

## Requirements
**Functional**
- Builder Joins step (Phase 14) classifies a proposed relationship as **same-source** (emit
  `joins: { sql, relationship }`) or **cross-source** (emit a flagged advisory: `# cross-source —
  requires rollupJoin/pre-agg; not executed`, plus structured metadata in the staged draft).
- Cube YAML gains `data_source:` from the connector's registry id.
- `view-graph.tsx`: render cross-source edges dashed + badged; clicking explains the rollupJoin
  requirement (link to docs).
- Workspace model view: list cubes grouped by connector/dataSource; show which links are live vs advisory.

**Non-functional**
- No false promises: a cross-source join is never silently compiled as if executable.

## Architecture
Builder Joins step → relationship classifier (`join-source-classifier.ts`) → scaffolder emits
same-source `joins:` or cross-source advisory → staged draft carries link metadata → graph renders.

## Related Code Files
- **Create:** `server/src/services/join-source-classifier.ts` (same vs cross-source decision +
  advisory emit).
- **Modify:** `src/pages/Data/triage/view-graph.tsx` (cross-source edges), `cube-model-scaffolder.ts`
  (`data_source:` + advisory join emit), `view-builder.tsx` Joins step (classify + explain).
- **Read for context:** Phase 13 `existing-model-reader` output, `source-type-registry` caps
  (`crossSourceRollupJoin`).

## Implementation Steps
1. `join-source-classifier.ts`: given two cubes + their connectors → `same` | `cross` + advisory text.
2. Scaffolder: stamp `data_source:` per cube; same-source → real `joins:`; cross-source → advisory
   comment + structured metadata in the draft.
3. Builder Joins step: surface candidate links against the existing model (Phase 13); label
   same/cross; explain rollupJoin requirement for cross.
4. `view-graph.tsx`: distinct styling + badge for cross-source edges; click → explanation.
5. Workspace model view groups cubes by dataSource; live vs advisory legend.

## Todo
- [ ] join-source-classifier (same vs cross + advisory)
- [ ] Scaffolder emits data_source + same-source joins + cross-source advisory
- [ ] Builder Joins step: classify + explain against existing model
- [ ] Entity-graph cross-source edge styling + badge
- [ ] Workspace model view grouped by dataSource (live vs advisory legend)

## Success Criteria
- Join two cubes within one source → executing `joins:` YAML, validates via `/load`.
- Link a new-source cube to an existing Trino cube → staged as a flagged cross-source advisory,
  rendered dashed in the graph, with a clear "requires rollupJoin/pre-agg" explanation. Never
  compiled as an executing join.

## Risks & Mitigation
- **User expects cross-source joins to "just work":** UI copy + badge make the engine limit explicit;
  rollupJoin/pre-agg implementation recorded as a v2.5 follow-up (matches Decision 2).
- **data_source default safety:** legacy cubes without `data_source:` keep Trino default (Phase 10).

## Security
- No new mutation surface beyond builder stage/approve (RBAC + grant unchanged).

## Next
Phase 16 (tests + docs); record rollupJoin execution as v2.5 follow-up.
