---
title: Cube join-graph as default Data Model view
description: >-
  Port the cube-prod model-viewer join graph into the Catalog Data Model surface
  as the first tab + default landing, built FE-only from extended Cube meta
status: completed
priority: P2
branch: main
tags:
  - catalog
  - data-model
  - reactflow
  - frontend
blockedBy: []
blocks: []
created: '2026-06-12T10:56:23.788Z'
createdBy: 'ck:plan'
source: skill
---

# Cube join-graph as default Data Model view

## Overview

Consolidate the ported standalone model-viewer (`/model-view/`, cube-prod port) into the
playground's Data Model surface (`/#/catalog/data-model`). The join-topology graph becomes
the **first tab and default landing** of Data Model: users land on an overview graph of the
active game's cubes (cluster boxes, join edges with key mappings + cardinality), then drill
into cubes via the existing DetailPanel / other tabs / playground.

**Key insight (verified live, 260612):** Cube's `/meta?extended=true` — already fetched by
`useCatalogMeta` — exposes `joins[] {name, relationship, sql}`, `connectedComponent`, and
`aliasMember` on view members. The Python YAML parsing in `model-viewer/gen_model_graph.py`
is therefore unnecessary in-app: the whole feature is **FE-only**, automatically live,
game-scoped, and workspace-aware (local bare names AND prod prefix workspaces) for free.
No server endpoint. Verified: `curl :3004/cube-api/v1/meta?extended=true -H 'x-cube-workspace: local' -H 'x-cube-game: cfm'`.

**Out of scope (user-confirmed):** retiring the standalone `/model-view/` mount (handled
later); layout persistence / publish-to-all (YAGNI — deterministic auto-layout suffices);
merging Concepts + Concept Map.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Join-graph builder lib](./phase-01-join-graph-builder-lib.md) | Completed |
| 2 | [Graph view UI](./phase-02-graph-view-ui.md) | Completed |
| 3 | [Tab IA restructure](./phase-03-tab-ia-restructure.md) | Completed |

Phases are sequential: 2 depends on 1 (builder lib), 3 depends on 2 (the surface it promotes).

## Dependencies

- No cross-plan blockers. `260612-1654-chat-audit-artifacts-section` is committed (c0c3853).
  Concept-map tab already shipped (reactflow@11 in bundle) — reused, not modified.
- Reference implementation: `model-viewer/` (committed port) — `gen_model_graph.py`
  (cluster heuristics, key-label parse), `gen_layouts.py` (cluster grid layout),
  `index.html` (interaction grammar: select→highlight edges, search dim, view highlight).

## Success Criteria

- Clicking sidebar "Data Model" lands on the join graph of the active game (Graph default).
- Graph shows cluster boxes, join edges; selecting a cube highlights its edges with
  `localCol → targetCol` labels + cardinality; clicking opens the existing DetailPanel.
- Grid view (current Cubes cards) reachable via toggle; all 5 existing tabs still reachable.
- Chat field-chip deep links (`/catalog/data-model?focus=…`) still open Schema Cartographer.
- Lint surfaced: isolated cubes + missing join targets visible (the jus `etl_prop_flow` /
  muaw funnel gaps found during smoke-test must be visible).
- `npm run typecheck` clean for touched files; new vitest suites pass; no regression in
  existing catalog-tabs/catalog tests.

## Unresolved Questions

- First-tab label: keeping "Cubes" (least churn). If product wants "Overview"/"Graph",
  one-line label change in `catalog-tabs.tsx`.
