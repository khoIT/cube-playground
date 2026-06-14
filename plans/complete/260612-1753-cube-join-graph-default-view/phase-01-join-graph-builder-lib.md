---
phase: 1
title: Join-graph builder lib
status: completed
priority: P2
effort: 4h
dependencies: []
---

# Phase 1: Join-graph builder lib

## Overview

Pure-TS, DOM-free library under `src/pages/Catalog/cube-graph/` that turns the already-fetched
`CatalogCube[]` (from `useCatalogMeta`, `/meta?extended=true`) into a renderable join graph:
nodes, deduped edges with key labels + cardinality, cluster assignment, deterministic cluster-grid
layout, view→cube composition, and model lints. TS port of `model-viewer/gen_model_graph.py`
(cluster heuristics, key-label parse) + `gen_layouts.py` (grid layout), adapted to meta shapes.

## Requirements

- Functional:
  - Build graph from `CatalogCube[]`: nodes = `type !== 'view'` cubes; edges from `cube.joins[]`,
    deduped per unordered cube pair (keep first; collect both directions' keyLabels for drawer use).
  - Key label from meta join SQL. **Meta SQL format differs from YAML**: verified shape is
    `` "`${CUBE}.user_id = ${mf_users}.user_id`" `` (backtick-wrapped, `${ref}.col` tokens).
    Regex: `/\$\{(\w+)\}\.(\w+)/g`; resolve `CUBE`/self-name → local col, target name → target col;
    label `localCol → targetCol`; fallback to raw SQL squashed.
  - Cardinality from meta `relationship` vocabulary (NOT the YAML one): `belongsTo` → `N:1`,
    `hasMany` → `1:N`, `hasOne` → `1:1`. Unknown → omit glyph.
  - Cluster heuristic = port of `cluster_of()` from `model-viewer/gen_model_graph.py` incl. the
    `base_name()` prefix-strip. Accept optional `gamePrefix` (from
    `workspace?.gamePrefixMap?.[gameId]`, single-`_` boundary like `use-catalog-meta.ts` filtering)
    so prod prefix workspaces (`cfm_vn_mf_users`) cluster identically to local bare names.
  - Layout = port of `gen_layouts.py`: `DEFAULT_ANCHORS` conceptual (col,row) per cluster,
    `grid_dims`/`block_size`, centered blocks, per-node positions + per-cluster bounding rects
    (for cluster box rendering). Constants NODE_W=230 NODE_H=42 GAP=26 COL_GAP=120 ROW_GAP=110
    as starting values.
  - View composition: for `type === 'view'` cubes, derive composed cube set from distinct
    `aliasMember` prefixes across the view's dimensions+measures (verified present in extended meta).
  - Lints: `isolated` (cube with zero edges either direction) and `missingTarget`
    (join target absent from cube set — possible on prefix workspaces after filtering).
- Non-functional: pure functions, no React imports, memo-friendly (stable output for stable input).
  Files ≤200 LOC each (project rule) — hence the 3-module split.

## Architecture

```
CatalogCube[] ──► build-join-graph.ts ──► JoinGraph {nodes, edges, clusters, lints}
                       │                        │
                       │ cluster_of/base_name   ▼
                       │                  cluster-grid-layout.ts ──► positions + clusterRects
                       ▼
                  view-composition.ts ──► Map<viewName, Set<cubeName>>
```

## Related Code Files

- Create: `src/pages/Catalog/cube-graph/build-join-graph.ts` (types + node/edge/cluster/lint builder)
- Create: `src/pages/Catalog/cube-graph/cluster-grid-layout.ts`
- Create: `src/pages/Catalog/cube-graph/view-composition.ts`
- Create: `src/pages/Catalog/cube-graph/__tests__/build-join-graph.test.ts`
- Create: `src/pages/Catalog/cube-graph/__tests__/cluster-grid-layout.test.ts`
- Read for context: `src/pages/Catalog/use-catalog-meta.ts` (CatalogCube/CatalogJoin types),
  `model-viewer/gen_model_graph.py`, `model-viewer/gen_layouts.py`,
  `src/lib/cube-member-resolver.ts` (existing logical↔physical naming helpers — reuse if it
  already covers prefix stripping rather than re-implementing).

## Implementation Steps

1. Define types: `JoinGraphNode {name, title, description, cluster, lint?}`,
   `JoinGraphEdge {id, source, target, keyLabel, cardinality, missingTarget}`,
   `JoinGraph {nodes, edges, clusterRects, lints}`.
2. Port `base_name` + `cluster_of` (hub/bridge/session/behavior/recharge/activity/mapping/profile/other);
   meta cubes use `joins[].name` as target (vs Python's `target`).
3. Implement key-label parser against the verified backticked meta SQL shape; unit-test both
   backticked and bare SQL strings.
4. Edge dedup per unordered pair; lints computed in same pass.
5. Port grid layout; return node positions AND cluster bounding rects (+padding, label slot).
6. `view-composition.ts`: aliasMember prefix extraction with `cube.member` split on first `.`.
7. Tests: fixture `CatalogCube[]` mirroring cfm shapes (mf_users hub, user_roles bridge,
   etl_login session, etl_game_detail behavior, recharge, isolated game_key_metrics) + a
   prefixed-name variant (`cfm_vn_*` with `gamePrefix: 'cfm_vn'`). Assert clusters, key labels,
   cardinality mapping, dedup, isolated/missingTarget lints, deterministic positions,
   view composition from aliasMember.

## Success Criteria

- [ ] All listed modules exist, ≤200 LOC each, no React/DOM imports
- [ ] Vitest suites pass; cover bare + prefixed naming, both lint kinds, sql label fallback
- [ ] `npx tsc --noEmit` clean
- [ ] Fixture parity spot-check: same cluster assignment as Python generator for cfm names

## Risk Assessment

- **Meta SQL shape drift** (backticks are a Cube serialization detail): parser must fall back
  to squashed raw SQL, never throw. Covered by tests.
- **Prefix workspaces**: `use-catalog-meta` filters by `${prefix}_` single underscore — reuse the
  exact same boundary rule or clusters silently bucket to "other". Test pinned.
- `cube-member-resolver.ts` may already own prefix logic — check before writing new (DRY).
