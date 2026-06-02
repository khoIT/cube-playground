---
phase: 5
title: "Unified Map"
status: pending
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
- [ ] One URL explores all 4 layers; navigate any direction
- [ ] Detail panel shows field→metrics, metric→terms, field→segments, parent/child
- [ ] +Add/Promote inline + role-scoped; trust badges on every node
- [ ] `?focus=<ref>` deep-links to any node type

## Risk Assessment
- **"Extend" is really a rewrite** (C12): the index is cube-FQN-bound. Budget the new `ConceptNode` index + 4 consumer-file refactor + `?focus` generalization explicitly (effort bumped 3-5d → 5-8d). KISS guardrail: reuse the Cartographer *shell/virtualization/search*, but the index data-model is net-new.
- **Scope creep** into a modeling IDE → browse+create only; editing stays in per-tab forms / wizard.
- **Index size/perf** on large `/meta` → lazy-load layers, reuse Cartographer's existing virtualization/search.
- **Affordance inconsistency** → all chips/badges/actions come from P3/P4 shared components, not re-implemented here.
