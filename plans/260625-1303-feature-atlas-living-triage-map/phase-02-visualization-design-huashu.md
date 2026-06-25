---
phase: 2
title: "Visualization design (huashu)"
status: completed
priority: P2
effort: "1d"
dependencies: [1]
---

# Phase 2: Visualization design (huashu)

## Overview

Design the interactive atlas visualization as hi-fi HTML variants via the **huashu-design** skill, fed by the real `atlas.yaml` from Phase 1. Output: 2-3 visual directions the user picks/mixes, plus one chosen working HTML prototype that is *already interactive* (so triage value lands before the React port). This follows the house workflow "design important/new surfaces with huashu hi-fi HTML variants before React".

Explicitly **not raw Mermaid** — user found raw Mermaid hard to see/interact/discover.

## Requirements

- Functional:
  - Render Surface → Feature → Direction as a navigable tree/graph (not a flat list).
  - **Directions render as dashed/ghost leaf nodes** off each feature → expansion arrows are visible (ideation surfaced, not buried in text).
  - Feature node visual encodes `health` (color) + `status` (badge/shape).
  - Filter chips: status, health, surface. Free-text search.
  - Click feature → detail drawer: summary, drawbacks list, directions list, clickable deps, links (plan/code/memory paths).
- Non-functional:
  - Must align with `docs/design-guidelines.md` tokens (so the eventual React port matches Dashboards/Segments/Cohort). Variants may explore, but the chosen one converges on `var(--*)` tokens.
  - Reads the actual `atlas.yaml` (or a JSON snapshot of it) so the prototype shows real ~60-node density — stress-test legibility at scale, the whole reason Mermaid was rejected.

## Architecture

- Invoke `huashu-design` to embody the prototype/visualization expert; generate variants exploring layout for ~60 nodes (e.g. radial cluster, indented collapsible tree, force/cluster graph like cube-graph, columned kanban-by-status).
- Feed it `atlas.yaml` density + the design constraints (tokens, Surface→Feature→Direction, dashed direction leaves, drawer).
- Self-contained HTML (inline CSS/JS) — runnable in browser without the app.
- The chosen variant becomes the visual contract for Phase 3 (which reuses `reactflow` + `concept-detail` drawer rather than the prototype's raw DOM).

## Related Code Files

- Create (design artifacts): under the plan's `visuals/` dir, e.g. `plans/260625-1303-feature-atlas-living-triage-map/visuals/atlas-variant-*.html`
- Read: `src/feature-atlas/atlas.yaml` (real data for the prototype)
- Read: `docs/design-guidelines.md`, `src/theme/tokens.css` (token alignment)
- Reference (interaction prior art to match feel): `src/pages/Catalog/cube-graph/cube-graph-page.tsx`, `src/pages/Catalog/concept-detail/concept-detail-page.tsx`

## Implementation Steps

1. Export/snapshot `atlas.yaml` to a JSON the HTML prototype can inline.
2. Invoke `huashu-design` with constraints (Surface→Feature→Direction, dashed direction leaves, health/status encoding, filters, drawer, tokens) → produce 2-3 variants at real node density.
3. Review variants specifically for **legibility + discoverability at ~60 nodes** (the Mermaid failure mode). Reject any that get cramped.
4. User picks/mixes → converge to one prototype; align colors/spacing to design tokens.
5. Capture the chosen variant + a short "visual contract" note (node anatomy, states, drawer layout, filter behavior) for Phase 3 to implement against.

## Success Criteria

- [ ] 2-3 hi-fi HTML variants produced from real `atlas.yaml` density.
- [ ] Chosen prototype is interactive (expand/collapse or pan/zoom, filter chips, click→drawer) and legible at ~60 nodes.
- [ ] Directions clearly visible as dashed leaf nodes; health/status visually distinct.
- [ ] Chosen variant aligns to `design-guidelines.md` tokens; "visual contract" note written for P3.
- [ ] User approves the chosen direction.

## Risk Assessment

- **Prototype ≠ final tech** — huashu raw-DOM interactions may not map 1:1 to reactflow. Mitigation: treat the prototype as a *visual+UX contract*, not code to port verbatim; P3 implements the feel with the app's graph stack.
- **Density still loses at 60 nodes** — if even a custom viz is cramped, fall back to collapse-by-default (surfaces collapsed, expand on demand) + strong filtering. Decide collapse strategy here, not in P3.
- **Token drift** — variants may use bespoke styling. Mitigation: converge the chosen one to tokens before declaring done.
