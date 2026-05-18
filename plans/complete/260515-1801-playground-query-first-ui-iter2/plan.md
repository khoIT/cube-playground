---
title: "Playground Query-First UI Iteration 2 — Top Bar, Sidebar Scoping, Filter Strip, Chart Side-Pane"
description: "Iteration-2 layout refinements: settings dropdown, sidebar cube-scoping board, separate filter strip, side-by-side resizable chart pane."
status: in-progress
priority: P2
effort: "~1.5 dev-days"
branch: "main"
tags: [frontend, querybuilder, ui-revamp, iteration-2]
blockedBy: []
blocks: []
created: 2026-05-15
createdBy: ck:plan
source: skill
---

# Playground Query-First UI Iteration 2

## Overview

Builds on iteration-1 (pill-bar + header revamp). Five-phase delivery focused on query composability and large-scale cube discovery — no new routes, no AI assist, no schema editor. Industry-validated against Cube v0.36, Metabase v60, Looker Studio.

Baseline today (post Run-button move): top toolbar already hosts Run+Stop side-by-side, pill bar shows Title+LIVE only. This plan stacks four UX upgrades + a polish phase on top.

## Phases

| Phase | Name | Effort | Status |
|-------|------|--------|--------|
| 1 | [Top Bar Settings Dropdown](./phase-01-top-bar-settings-dropdown.md) | ~2h | Done (in QueryBuilderContainer, not Header — deviation per risk row 2) |
| 2 | [Sidebar Settings Board](./phase-02-sidebar-settings-board.md) | ~3h | Done |
| 3 | [Filter Strip Separate Pane](./phase-03-filter-strip-separate-pane.md) | ~2-3h | Done (existing AccordionCard repurposed; localStorage persistence added) |
| 4 | [Chart Side-Pane Resizable Splitter](./phase-04-chart-side-pane-resizable-splitter.md) | ~6-8h | Done (used ui-kit ResizablePanel; chart was already non-tab so chart-tab removal was a no-op) |
| 5 | [Smoke Test and Polish](./phase-05-smoke-test-and-polish.md) | ~1-2h | Static checks done; runtime smoke pending dev-server session |

## Dependencies

- **Iteration 1 baseline (completed):** `plans/260515-1318-gds-cube-ui-revamp-stitch/` — header, pill bar, sidebar icons, toolbar Run/Stop placement already shipped.
- **No external dependencies.** Reuses existing `@cube-dev/ui-kit`, `useSecurityContext()`, and the iteration-1 layout root in `QueryBuilderInternals.tsx`.

## Locked Decisions

- **D1:** Ship all 4 validated UX changes + polish phase. Run-Query "dedicated row" rejected — current toolbar placement is correct.
- **D2:** Keep iteration-1 filter row inside pill-bar AND add new separate filter strip. Backward compat — accept visual duplication.
- **D3:** Chart pane width = **resizable splitter** (not fixed 30%). Persist width to localStorage.

## Non-Goals

- AI-assist / NL-to-query
- Computed dimension UI
- Inline YAML / schema editor
- Pre-aggregation creation UI
- New routes / page-level navigation changes
- Mobile / sub-1024px viewport optimization

## Source Research

`plans/reports/researcher-260515-1750-playground-query-first-ui-revamp.md`
