---
title: "Unified Concept Fabric — Standalone Map Page"
description: "A real route rendering the 4-layer concept node-graph (fields · metrics · glossary · segments) deferred from the original fabric plan."
status: completed
priority: P2
effort: 5-7d
branch: feat/admin-hub-govern-observe-split
tags: [catalog, concept-fabric, graph, semantic-layer, ui]
created: 2026-06-04
---

# Unified Concept Fabric — Standalone Map Page

## Overview

Build the **standalone cross-layer concept map** as its own route. The original fabric
plan (`plans/260603-0324-unified-concept-fabric/`) shipped a lighter
*relations-panel-in-Cartographer* approach (see its `phase-05-unified-map.md`
"Implementation Outcome") and explicitly deferred the full node-graph (Red Team C12).
This plan builds the deferred part: a **node graph with explicit cross-layer edges**,
mirroring the locked mockup `plans/260603-0324-unified-concept-fabric/visuals/index.html`
(screen 1).

**This is additive, not a rewrite.** We build a NEW `ConceptNode` index + a NEW page
ALONGSIDE the existing Cartographer (which keeps its field-centric tree + relations
panel). We reuse every shipped cross-layer primitive: `ConceptChip`, `ConceptHoverCard`,
`getConceptRelations`, `LayerFilterPills`, trust badges. The one new dependency is `reactflow`
(user-approved, ~45kb) for the canvas — see Resolved Decisions.

The mockup is a **deterministic 4-column layered layout** (not a free physics sim). We
render it with **`reactflow`**: custom node types per layer in 4 manually-positioned
columns, with reactflow edges drawn focus-scoped. reactflow gives pan/zoom/drag for free;
we supply deterministic column x/y (no auto-layout engine — YAGNI).

## Phases

| Phase | Name | Status | Effort |
|-------|------|--------|--------|
| 1 | [ConceptNode Index + Graph Data Hook](./phase-01-concept-node-index.md) | completed | 1.5-2d |
| 2 | [Map Page Shell, Route & Layout](./phase-02-map-page-shell-and-route.md) | completed | 1-1.5d |
| 3 | [Node Cards, Columns & Edges (reactflow)](./phase-03-nodes-columns-edges.md) | completed | 1.5-2d |
| 4 | [Focus, Deep-Link, Filters & Navigation](./phase-04-focus-deeplink-filters.md) | completed | 1-1.5d |
| 5 | [Tests, Docs & A11y](./phase-05-tests-docs-a11y.md) | completed | 0.5-1d |

## Sequencing & Dependencies

- **P1** is the foundation (data layer) — blocks P2–P4. No UI; pure data + hook + tests.
- **P2** (shell/route) depends on P1's hook signature; blocks P3, P4.
- **P3** (visual nodes/edges) depends on P2 layout containers.
- **P4** (focus/deep-link/filter wiring) depends on P3 rendered nodes.
- **P5** (tests/docs/a11y) depends on P1–P4 final code (TDD: per-phase unit tests
  are written inside each phase; P5 is the end-to-end + a11y + docs sweep).

File ownership is disjoint per phase (see each phase's Related Code Files) — no two
phases edit the same file, so P3/P4 could be split across two devs after P2 lands.

## Cross-Plan References

- Builds on **`plans/260603-0324-unified-concept-fabric/`** (complete). That plan's
  P2 registry/reverse-index, P3 chips/hover-card, P4 authoring/trust are the substrate.
  This plan consumes them; it does not modify server-side registry logic.
- Red Team finding **C12** (that plan) is the reason this is its own page with a NEW
  index — honored here.

## Resolved Decisions (user, 2026-06-04)

1. ✅ **Graph library = `reactflow`** (~45kb). Overrides the planner's hand-rolled-SVG
   recommendation. Custom node types per layer, 4 manually-positioned columns (deterministic
   x/y — no dagre/auto-layout engine), reactflow edges drawn focus-scoped. Pan/zoom/drag come
   free. Install pinned in P3. Custom node components still use design tokens (CLAUDE.md rule).
2. ✅ **Route = new Catalog subtab** `/catalog/concept-map` (beside Schema/Concepts/Cubes/
   Models, reuses `CatalogPage` host + KeepAlive + `useCatalogMeta`). ~3-line dispatch change.
3. ✅ **Edge fan-out = focus-scoped lazy edges** — only the focused node fetches + draws its
   edges via the existing per-ref relations API (module-cached). No N+1, no new server endpoint.

## Remaining Sub-Decision

- **Auto-layout engine (dagre):** NOT adopted. Columns use hand-computed deterministic x/y.
  Revisit only if intra-column ordering needs edge-crossing minimization (YAGNI for now).

## Validation Log

### Verification Results (2026-06-04)
- Claims checked: 23 · Verified: 22 · Failed: 1 · Unverified: 0
- Tier: Full (5 phases)
- Confirmed live: Catalog subtab dispatch (`catalog-page.tsx:213`), `catalog-tabs.tsx`
  (`resolveDataModelSubtab`/`DataModelSubtabs`), hash routing (`index.tsx:109,205`),
  cube-bound `MemberKind` + `byFqn` (`use-cartographer-index.ts:14,31`), focus helpers
  exported (`cartographer-page.tsx:82,103,109`; filter-clear guard `:155-157`),
  per-ref relations (`concepts-client.ts:86`, `concepts.ts:23`, `concept-reverse-index.ts:172,184`),
  module cache + reset (`use-concept-resolution.ts:16,106`), certified-segment + `to=` targets
  (`concept-relations-section.tsx:141,93,115,136`), `LayerFilterPills`/`ALL_LAYERS` + a11y
  (`layer-filter-pills.tsx:66,73`), `ConceptChip`/`ConceptHoverCard`/`CartographerSearch`,
  all 4 enumeration sources (`use-business-metrics`, `glossary-client.ts:96`,
  `segments-client.ts:29`, `data-model-tab/use-concepts` → `resolveMemberNames`),
  page-header pattern (`Dashboards/index.tsx:17-19`), 23 Cartographer tests,
  React 18.3.1 + react-router-dom 5.3.4, `reactflow` correctly absent.
- **Failed (1):** layer swatch tokens `--field-ink/--metric-ink/--concept-ink/--segment-ink`
  do NOT exist in `tokens.css`. Resolved by Decision V1 below (add dedicated `--layer-*` tokens).

### Validation Decisions (user, 2026-06-04)
- **V1 — Layer colors:** Add 4 dedicated `--layer-field / --layer-metric / --layer-glossary /
  --layer-segment` tokens (with dark-mode pairs) in `tokens.css`. NOT the QB-token fallback.
  → affects P2 (legend/swatches) + P3 (node colors).
- **V2 — Big columns:** Cap each layer at ~50 nodes on first load with a "show N more" expander
  (reactflow virtualizes viewport, not node count). → affects P1 (graph shape unchanged) + P3
  (build-layout honors a per-layer cap; board renders the expander).
- **V3 — Focus helpers:** Direct import of the exported `parseFocusRef`/`extractDataModelFqn`/
  `useFocusFromQuery` from `cartographer-page.tsx`. No extraction, no Cartographer refactor.
  → affects P4 (drop the extract alternative).
- **V4 — Bundle:** Code-split the concept-map subtab via `React.lazy` + `Suspense` at the
  `catalog-page.tsx` dispatch site so reactflow's ~45kb loads only when the tab opens.
  → affects P2 (mount) + P3 (reactflow sits behind the lazy boundary).

### Whole-Plan Consistency Sweep (2026-06-04)
- Re-read `plan.md` + all 5 phase files; grep-swept for superseded terms.
- Reconciled: removed stale route "OPEN QUESTION"/"Held pending Q2" + top-level-route/sidebar
  alternative (P2), the focus-helper "extract" alternative (P4), "(open Q3)" batch-endpoint label
  (P1), "approves a dependency (see open questions)" (overview — reactflow now approved), the
  deferred-capping note (P1/P3 — V2 is in-scope), `--*-ink` swatch tokens → `--layer-*` (P2/P3).
- Remaining `--*-ink` / "no extraction" mentions are intentional (recording the failed claim and
  stating V3). **Zero unresolved contradictions.** Plan is execution-ready.
