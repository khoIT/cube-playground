# Phase 5: Tests, Docs & A11y

## Context Links
- Existing Cartographer tests (pattern to mirror): `src/pages/Catalog/schema-cartographer/__tests__/` (23 tests).
- Docs to update: `docs/codebase-summary.md`, `docs/system-architecture.md`, `docs/project-changelog.md`, `docs/lessons-learned.md` (if a reactflow token-leak / canvas-a11y bug shape recurs).
- Test runner: Vitest (`vitest ^2.1.3`).

## Overview
- Priority: P2.
- Status: completed (2026-06-04 — 30 concept-map tests, full Catalog suite 259 green, prod build green with reactflow code-split into its own chunk, docs + lessons-learned updated). Live visual cross-check is the only remaining manual step.
- End-to-end interaction tests, accessibility pass, and documentation. Per-phase unit tests already exist (P1–P4); this phase is the integration sweep + a11y + docs.

## Key Insights
- TDD discipline: P1–P4 each ship their own unit tests. P5 covers the **integration seams** a single phase can't: focus round-trip across layers, edge redraw on filter change, search+filter+focus interaction.
- A11y (reactflow): the `<ReactFlow>` canvas is mouse/pointer-first. Custom node components must expose keyboard-operable controls (`<button>`/`role` + `aria-label`) and a visible focus ring; reactflow renders edges as DOM SVG — mark them `aria-hidden` (decorative). reactflow supports keyboard pan/zoom via its `<Controls>`; ensure tab order reaches node cards (not trapped in the canvas). Layer pills already have `aria-pressed` + `role="group"` (`layer-filter-pills.tsx:66`). Hover-card must be reachable by keyboard (verify `ConceptHoverCard` focus behavior).
- Reuse `_resetConceptResolutionCache()` (`use-concept-resolution.ts:106`) between tests to avoid module-cache bleed (the relations cache is module-level).

## Requirements
- Functional:
  - Integration test: load with `?focus=business_metrics/<id>` → metric node focused + edges present (closes the documented Cartographer gap).
  - Integration test: click field node → focus + edges to its metrics/terms/segments.
  - Test: layer pill off → column hidden; ≥1 always on.
  - Test: search narrows across layers; focused-but-filtered node clears focus.
  - Test: a layer exceeding the ~50 cap shows a "show N more" affordance; expanding it reveals the rest; header count = true total (Decision V2; unit-test the cap in `build-layout`, integration-test the expander).
  - Test: the lazily-mounted subtab resolves (Suspense fallback → board) without error (Decision V4).
  - A11y: keyboard-navigable nodes, focus ring, aria labels; edges aria-hidden.
- Non-functional: all new tests green; existing 23 Cartographer tests stay green (especially if focus helpers were extracted in P4).

## Architecture
- Test layout mirrors Cartographer `__tests__/`: one file per unit (`use-concept-graph`, `use-focus-edges` from P1; `build-layout`, `base-node` from P3) + an integration file `concept-map-page.test.tsx` here.

## Related Code Files
- Create: `src/pages/Catalog/concept-map/__tests__/concept-map-page.test.tsx` (integration).
- Modify: `docs/codebase-summary.md` (new concept-map surface), `docs/system-architecture.md` (ConceptNode index vs Cartographer index distinction), `docs/project-changelog.md` (entry dated 2026-06-04).
- Possibly Modify: `docs/lessons-learned.md` (only if a reactflow default-style/token-leak or canvas focus-trap issue bites — record the signal).
- Reuse (no edit): `_resetConceptResolutionCache`, existing test utilities.

## Implementation Steps
1. Write integration tests for the four interaction seams above; mock the 4 list clients + relations endpoint.
2. A11y pass: convert clickable cards to keyboard-operable controls, add aria labels, mark SVG `aria-hidden`; verify hover-card keyboard reachability.
3. Run full suite (`vitest run`) — new + existing 23 Cartographer tests must pass.
4. Update docs: codebase-summary, system-architecture (index distinction + route), changelog. Add lessons-learned entry only if a real bug shape emerged.
5. Visual cross-check vs mockup screenshot + adjacent pages (Dashboards/Cohort) per CLAUDE.md design rule.

## Todo List
- [x] Integration tests (focus round-trip across layers, click-focus, layer gating, search narrow, search-clears-focus)
- [x] A11y: keyboard-operable nodes (Enter/Space), aria labels/pressed, role=button, focus ring
- [x] Full suite green (30 concept-map + full Catalog 259, incl. 23 Cartographer) + prod build green
- [x] Docs: codebase-summary, system-architecture, changelog
- [x] lessons-learned entry (reactflow-in-jsdom + no-jest-dom matchers)
- [ ] Final visual cross-check (manual — needs live browser)

## Success Criteria
- [ ] All new unit + integration tests pass; existing Cartographer suite unbroken.
- [ ] Page is keyboard-navigable; edges non-focusable; pills/cards have aria labels.
- [ ] Docs updated; changelog has a 2026-06-04 entry.
- [ ] Visual parity with mockup + design-system consistency confirmed.

## Risk Assessment
- **Module-cache bleed in tests** (Med): the relations cache is module-level (`use-concept-resolution.ts:16`). Mitigation: `_resetConceptResolutionCache()` in `beforeEach`.
- **Cartographer test regression** (Med, if P4 extracted focus helpers): re-run Cartographer suite; the bare-vs-namespaced discrimination is guarded there — keep it green.
- **reactflow in jsdom** (Med): reactflow measures node dimensions via `ResizeObserver`/`getBoundingClientRect`, both stubbed/zero in jsdom. Mitigation: unit-test the pure `build-layout`/`use-focus-edges` logic directly; for the integration test, mock reactflow's measurement or assert on node/edge props rather than rendered geometry. Don't assert pixel positions in jsdom.
- **A11y for reactflow edges/canvas** (Low): edges decorative → `aria-hidden`; ensure tab order reaches node cards and the canvas is not a focus trap.

## Security Considerations
- None new — read-only page, existing authz-scoped data sources.

## Next Steps
- Plan complete. Scope decisions resolved 2026-06-04 (reactflow · Catalog subtab · focus-scoped lazy edges); validation decisions resolved 2026-06-04 (V1 `--layer-*` tokens · V2 ~50/layer cap + "show more" · V3 direct-import focus helpers · V4 lazy-loaded route). Ready to hand to `/ck:cook` per phase order.
