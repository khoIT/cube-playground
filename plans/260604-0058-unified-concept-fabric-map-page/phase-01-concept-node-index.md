# Phase 1: ConceptNode Index + Graph Data Hook

## Context Links
- Original deferred spec: `plans/260603-0324-unified-concept-fabric/phase-05-unified-map.md` (Architecture).
- Red Team C12: `plans/260603-0324-unified-concept-fabric/plan.md` (new index alongside, NOT in-place).
- Reuse: `src/api/concepts-client.ts:86` (`getConceptRelations`), `src/components/concept-hover-card/use-concept-resolution.ts` (module-cached fetch).

## Overview
- Priority: P1 (foundation).
- Status: completed (2026-06-04 — 8/8 tests green, tsc clean).
- Build a NEW discriminated-union `ConceptNode` index keyed by **namespaced ref**, enumerating all 4 layers, plus a hook that supplies the page with nodes (and, for the focused node, edges). Pure data + tests; no UI.

## Key Insights
- `useCartographerIndex` (`use-cartographer-index.ts:14,16,35`) is hard-bound to cube members: `MemberKind='measure'|'dimension'|'segment'`, `CartographerMember` keyed by cube FQN, `byFqn` map. **Do NOT extend it** — its `kind:'segment'` means a *Cube YAML segment*, NOT the app `segments` table. The new index must disambiguate: use `cubeMember` (fields, from `/meta`) vs `appSegment` (from the segments table).
- The relations endpoint `GET /api/concepts/:namespace/:id/relations` (`server/src/routes/concepts.ts:23`) is **per-ref only** — there is no "whole graph" endpoint. `getRelations` (`server/src/services/concept-reverse-index.ts:172`) computes edges for ONE ref. Fetching edges for every node = N+1 storm. Decision: **lazy, focus-scoped edges** — only fetch edges for the currently-focused node via the existing module-cached `useConceptResolution`.
- Node enumeration sources already exist (no new endpoints):
  - **Fields** → `useCatalogMeta()` cubes → measures/dimensions (reuse `resolveMemberNames` from `data-model-tab/use-concepts`).
  - **Metrics** → `useBusinessMetrics()` (`src/pages/Catalog/metrics-tab/use-business-metrics.ts`, already consumed by sidebar `sidebar.tsx:37`).
  - **Glossary** → `listGlossary()` (`src/api/glossary-client.ts:96`).
  - **Segments** → `segmentsClient` list (`src/api/segments-client.ts:29`).

## Requirements
- Functional:
  - `ConceptNode` discriminated union: `{ kind: 'field'|'metric'|'term'|'appSegment'; ref: string; label: string; sublabel?: string; trust?: Trust; ... }` keyed by namespaced `ref` (`data_model/<fqn>`, `business_metrics/<id>`, `glossary/<id>`, `segments/<id>`).
  - `useConceptGraph()` hook: returns `{ nodes: ConceptNode[], byRef: Map, loading, error }` from the 4 list sources; memoised.
  - `useFocusEdges(ref)`: wraps `useConceptResolution(ref)`; maps `ConceptRelations` → typed edge list `{ from, to, kind }[]` for the focused node only.
- Non-functional: read-only; reuse existing list hooks (DRY); no new server route (focus-scoped lazy edges, resolved 2026-06-04 — no batch endpoint).
- **reactflow mapping (resolved 2026-06-04):** the `ConceptNode` shape maps 1:1 to a reactflow `Node` (`id = ref`, `type = kind`, `data = {label, sublabel, trust, ...}`, `position` added by P3's `build-layout`). Keep `ref` globally unique so it doubles as the reactflow node id. `useFocusEdges` output maps to reactflow `Edge[]` (`id`, `source`, `target`). P1 stays presentation-agnostic — no reactflow import here; the mapping lives in P3.

## Architecture
```
useCatalogMeta ─┐
useBusinessMetrics ─┤
listGlossary ──────┼─► useConceptGraph() ─► { nodes, byRef }   (all 4 layers, no edges)
segmentsClient ────┘
                         focused ref ─► useFocusEdges(ref) ─► useConceptResolution ─► edges[]
```
- Edges are derived **only for the focused node** → at most 1 relations fetch per focus change, already deduped/cached module-wide. No graph-wide fan-out.
- `byRef` lets the page resolve an edge target ref → its node card for highlight + positioning.

## Related Code Files
- Create: `src/pages/Catalog/concept-map/use-concept-graph.ts` (node enumeration + index).
- Create: `src/pages/Catalog/concept-map/concept-node.ts` (types + ref helpers: `makeFieldRef`, `makeMetricRef`, etc.; reuse `parseFocusRef` grammar).
- Create: `src/pages/Catalog/concept-map/use-focus-edges.ts` (focus → typed edges).
- Create: `src/pages/Catalog/concept-map/__tests__/use-concept-graph.test.ts`, `use-focus-edges.test.ts`.
- Read for context (DO NOT modify): `use-cartographer-index.ts`, `concepts-client.ts`, `use-concept-resolution.ts`, `glossary-client.ts`, `use-business-metrics.ts`, `segments-client.ts`, `cartographer-page.tsx` (`parseFocusRef`/`extractDataModelFqn` — reuse, don't fork).

## Implementation Steps
1. Define `ConceptNode` union + ref-builder/parser helpers in `concept-node.ts`. Reuse the namespaced-ref grammar already used by `getConceptRelations` (`<namespace>/<id>`, split on first slash).
2. Implement `useConceptGraph()`: call the 4 list hooks, map each to `ConceptNode[]`, dedupe into `byRef`. Memoise on the source arrays. Expose combined `loading`/`error`.
3. Implement `useFocusEdges(ref)`: call `useConceptResolution(ref)`; flatten `data.{fields,metrics,terms,segments}` into `{ from: ref, to: <targetRef>, kind }[]`.
4. Unit tests: node counts per layer, ref disambiguation (cube-segment NOT emitted as appSegment), edge mapping from a mocked `ConceptRelations`, empty/loading/error states.

## Todo List
- [x] `concept-node.ts` types + ref helpers
- [x] `use-concept-graph.ts` node enumeration over 4 sources
- [x] `use-focus-edges.ts` over `useConceptResolution`
- [x] Tests for graph + focus-edges (8 tests)
- [x] `tsc` clean

## Success Criteria
- [ ] `useConceptGraph()` returns nodes from all 4 layers with correct `kind` + namespaced `ref`.
- [ ] No cube-YAML segment leaks in as an `appSegment` (disambiguation verified by test).
- [ ] `useFocusEdges` emits typed edges for a focused ref; only 1 relations fetch per focus.
- [ ] Tests green; `tsc` clean.

## Risk Assessment
- **N+1 edge storm** (High): mitigated by focus-scoped lazy edges (no whole-graph fetch — locked decision). If a future requirement wants a fully-drawn web, add a batch relations endpoint — do NOT loop `getConceptRelations` per node.
- **Segment visibility leak** (Med): segment nodes come from the workspace/owner-scoped list client; edges come from the already workspace+owner-filtered `getRelations` (`concept-reverse-index.ts:184`). Do not bypass either.
- **Index size** on large `/meta` (Med): nodes are cheap (label + ref); no per-node fetch. P1 enumerates ALL nodes (graph shape complete); the render-side cap (~50/layer + "show more") lives in P3's `build-layout` (Decision V2) — P1 stays uncapped so search/filter see the full set.

## Security Considerations
- All node/edge data flows through existing authz-scoped clients/endpoints; this phase adds no new fetch path. Personal segments never surface to non-owners (enforced server-side already).

## Next Steps
- Unblocks P2 (page consumes `useConceptGraph` + `useFocusEdges`).
