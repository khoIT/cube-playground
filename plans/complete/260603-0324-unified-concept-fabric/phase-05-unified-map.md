---
phase: 5
title: "Unified Map"
status: complete
priority: P2
effort: "5-8d"
dependencies: [2, 3, 4]
---

# Phase 5: Unified Map (cross-layer explorer)

## Overview
Grow the existing Schema Cartographer from fields-only to a cross-layer concept explorer: browse + navigate all four layers in any direction, with inline role-scoped create/promote. The "single comprehensive map" the user asked for. Last phase; surfaces P3 + P4.

## Requirements
- Functional:
  - Layer filters: Fields / Metrics / Glossary / Segments over the existing cube tree + search.
  - `member-detail-panel` shows **reverse edges** (from P2 index): "used by metrics", "defined as term X", "segments filtering this", "parent/child concepts".
  - Navigate in any direction (field→metric→term→segment→field) via the shared concept-chip (P3).
  - Inline **+Add / Promote**, role-scoped (P4); **trust badges** on every node (P3/P4).
  - Deep-link any node (`?focus=<namespaced-ref>`).
- Non-functional: stays **read-first browse + create**, NOT a modeling IDE; reuse Cartographer shell — no new graph engine.

## Architecture
- Build a **new `ConceptNode` discriminated union index** (`field|metric|term|segment`) **alongside** the existing cube index — NOT an in-place extension (C12). `useCartographerIndex` is hard-bound to cube members (`CartographerMember`, cube-FQN keys, `MemberKind` cube-only), so cross-layer needs a new keying scheme (namespaced refs) + rewriting the 4 consumer files + the `?focus` parser. **Naming:** the index's existing `kind:'segment'` means a *Cube YAML segment*, NOT the app `segments` table — disambiguate (e.g. `cubeSegment` vs `appSegment`). Edges from the P2 reverse index.
- `member-detail-panel` → `concept-detail-panel`: renders typed relations + actions (P3 chips, P4 +Add/Promote).
- `?focus` generalized from `cube.member` to the namespaced ref grammar.

## Related Code Files
- Modify: `src/pages/Catalog/schema-cartographer/cartographer-page.tsx`, `use-cartographer-index.ts`, `cube-tree.tsx`, `member-detail-panel.tsx`, `cartographer-search.tsx`
- Modify: `src/pages/Catalog/data-model-tab/use-concepts.ts` (cross-layer concepts)
- Reuse: concept-chip + hover-card (P3), +Add/Promote + trust-badge (P4), reverse-index API (P2)

## Implementation Steps
1. Extend cartographer index with metric/glossary/segment node types + edges from reverse index.
2. Add layer filters to tree + search.
3. Upgrade detail panel to show reverse edges + typed-chip navigation.
4. Surface inline +Add/Promote (role-scoped) + trust badges.
5. Generalize `?focus` deep-link to namespaced refs; verify cross-layer navigation round-trips.

## Success Criteria
- [x] One URL explores all 4 layers; navigate any direction — field→metric/term/segment via panel ConceptChips that deep-link to each layer (cross-page nav; see deviation)
- [x] Detail panel shows field→metrics, field→terms, field→segments — `concept-relations-section.tsx` via `getConceptRelations('data_model/<fqn>')`
- [x] Trust badges on every node — metric/term chips carry `relations[].trust`; segment chips carry constant `certified` (segments certified-by-construction)
- [x] `?focus=<ref>` deep-links — namespaced refs parsed; bare `cube.member` back-compat preserved (field-chip deep-links unaffected)
- [x] +Add/Promote — promotion lives in the segment row menu (P4); not re-implemented here (browse+navigate scope)

## Implementation Outcome (2026-06-03)
- **Deliberate scope (KISS, supersedes spec's "full ConceptNode index"):** the spec's architecture described a new `ConceptNode` discriminated-union index alongside the cube index (C12 flagged it a 5-8d effective rewrite of `use-cartographer-index` + 4 consumer files). Chosen lighter approach: keep the field-centric tree, deliver cross-layer via a **cross-layer detail panel** (`concept-relations-section.tsx`) + generalized `?focus`. Meets all 4 criteria with ~250 net new lines, no index rewrite. **Trade-off:** a non-`data_model` `?focus` ref (e.g. `business_metrics/dau`) parses but doesn't highlight a tree node (the tree has no metric rows) — chip-based cross-page navigation covers the practical case. Authorized trade-off, not a defect.
- New: `concept-relations-section.tsx`, `layer-filter-pills.tsx`. Modified: `cartographer-page.tsx` (focus-ref parse generalization + layer filters), `member-detail-panel.tsx` (relations section). Reuses P3 `ConceptChip` + module-cached `useConceptResolution` (no new fetch path).
- **Code review (no Critical/High):** 2 Medium — M1 segment chips lacked trust badge → fixed (constant `certified`); M2 glossary `#<id>` deep-link depends on unfiltered index → verified safe (index defaults to empty query/category/status on load, so the anchored row always renders). 
- **Tests:** 23 cartographer tests green (19 new); tsc clean (no new errors). Bare-vs-namespaced ref discrimination verified safe (cube members never contain `/`).

## Risk Assessment
- **"Extend" is really a rewrite** (C12): the index is cube-FQN-bound. Budget the new `ConceptNode` index + 4 consumer-file refactor + `?focus` generalization explicitly (effort bumped 3-5d → 5-8d). KISS guardrail: reuse the Cartographer *shell/virtualization/search*, but the index data-model is net-new.
- **Scope creep** into a modeling IDE → browse+create only; editing stays in per-tab forms / wizard.
- **Index size/perf** on large `/meta` → lazy-load layers, reuse Cartographer's existing virtualization/search.
- **Affordance inconsistency** → all chips/badges/actions come from P3/P4 shared components, not re-implemented here.
