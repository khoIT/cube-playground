---
phase: 1
title: "Prototype (huashu)"
status: complete
priority: P1
effort: "1-2d"
dependencies: []
---

# Phase 1: Prototype (huashu hi-fi)

## Overview
Clickable HTML hi-fi (via `huashu-design` skill) of the novel surfaces, to validate UX + the affordance language BEFORE any code. De-risks P3/P5.

## Requirements
- Functional: clickable mockups of (a) cross-layer map (Fields/Metrics/Glossary/Segments with reverse edges), (b) term **hover-card** with typed actions (Define / Slice by field / Open segment / See metric), (c) **trust badges** (draft/certified/deprecated) + visibility (personal/shared/org), (d) inline **+Add / Promote** affordances, role-scoped.
- Non-functional: matches `docs/design-guidelines.md` tokens (Inter, `var(--*)`, page-header pattern); side-by-side with an existing page (Dashboards/Cohort) for drift check.

## Architecture
Static HTML/CSS (huashu output) — no backend. Encodes the affordance vocabulary the later phases implement: chip treatment per object type (metric ▦ / concept ⓘ / field code-chip / segment ◑), hover-card layout, badge styles.

## Related Code Files
- Create: `plans/260603-0324-unified-concept-fabric/visuals/*.html` (prototype artifacts)
- Read for fidelity: `src/theme/tokens.css`, `src/pages/Dashboards/index.tsx`, `src/pages/Catalog/schema-cartographer/cartographer-page.tsx`

## Implementation Steps
1. Invoke `huashu-design` with the brainstorm report + design-guidelines as context.
2. Produce 3 hi-fi screens: cross-layer map, term hover-card (whale example), authoring/promote flow with badges.
3. Self-review against an adjacent live page for token/typography/spacing drift.
4. Capture chosen affordance decisions (chip glyphs, badge colors, action ordering) as notes for P3/P5.

## Success Criteria
- [x] 3 clickable hi-fi screens in `visuals/`, token-compliant — `visuals/index.html` (tabbed: cross-layer map · term hover-card · authoring/promote); rendered error-free, screenshots in `visuals/screen-{1,2,3}-*.png`
- [x] Affordance vocabulary (chips, badges, actions) decided + noted — `visuals/affordance-decisions.md`
- [x] User sign-off before P2 build starts — signed off 2026-06-03; affordance vocabulary approved, P2 unblocked

## Risk Assessment
Prototype drift from real data shapes → use the whale/dolphin/spender real example, not lorem. Keep it throwaway (no premature componentization).
