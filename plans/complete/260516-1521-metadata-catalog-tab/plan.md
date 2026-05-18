---
title: "Metadata Catalog Tab (system-meta) — CANCELLED, pivoted"
description: "Cancelled 2026-05-16 after red-team verification. /cubejs-system/v1/meta does not exist on the target Cube backend AND the regular /meta payload lacks meta.*/sql/dataSource/preAggregations/joins[] — the three pillars of the catalog (SQL snippets, hidden members, adaptive facets) have no schema support. Pivoted to enriching the existing Playground sidebar instead."
status: cancelled
priority: P2
branch: "main"
tags: [feature, catalog, internal-tool, cancelled, pivoted]
blockedBy: []
blocks: []
created: "2026-05-16T08:21:53.805Z"
createdBy: "ck:plan"
source: skill
---

# Metadata Catalog Tab (system-meta) — CANCELLED

> **Status:** Cancelled 2026-05-16. See `## Pivot Decision` below.

## Pivot Decision (2026-05-16)

Red-team review (3 hostile reviewers) flagged two critical assumptions. Empirical probe confirmed both:

1. **`/cubejs-system/v1/meta` does not exist on the target Cube backend.** All `/cubejs-system/*` routes returned HTTP 404 with generic Express "Cannot GET" pages (not auth challenges). The entire `/cubejs-system/*` namespace is unavailable on this deployment.
2. **Even on `/cubejs-api/v1/meta`, the rich fields the plan depended on are not populated:**

   | Field | Population (across 11 cubes / 58 measures / 215 dimensions) |
   |---|---|
   | `cube.meta` / `measure.meta` / `dimension.meta` | **0 / 0 / 0** — adaptive Tier 2 facets have nothing to detect |
   | `measure.sql` | **0 / 58** — per-measure SQL snippets (the #1 DA value-add) impossible |
   | `cube.dataSource` | **0 / 11** — "group by data source" facet impossible |
   | `cube.preAggregations` | **0 / 11** — "has pre-aggs" facet impossible |
   | `cube.joins[]` | **0 / 11** — only `connectedComponent: int` exists (no edge list) |
   | Hidden members (`public:false`) | **0 / 11**, **0 / 58** — schema doesn't use the flag |

All three brainstorm pillars (SQL snippets, hidden-member discovery, adaptive `meta.*` facets) collapsed.

## What's left for follow-up

A much smaller scope: enrich the existing Playground sidebar (`src/QueryBuilderV2/QueryBuilderSidePanel.tsx`) with a per-cube / per-measure details popover showing description, aggType, format hint, and connectedComponent group. ~0.5 day work. New plan to be scaffolded separately if pursued.

## Cancelled phase files

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Pipe and Grid](./phase-01-pipe-and-grid.md) | Cancelled |
| 2 | [Search and Facets](./phase-02-search-and-facets.md) | Cancelled |
| 3 | [Detail Drawer](./phase-03-detail-drawer.md) | Cancelled |
| 4 | [Polish and Guards](./phase-04-polish-and-guards.md) | Cancelled |

Phase files retained as historical record of the rejected design.

## Original Overview (superseded)

New top-level nav pill **Metadata** (sibling of Playground + Models) at `/metadata`. Fetches `/cubejs-system/v1/meta` via browser-signed HS256 JWT using `VITE_CUBE_API_SECRET` (env-baked, internal/localhost only). Renders a faceted card grid with adaptive `meta.*` facets. Detail drawer surfaces SQL snippets, sibling measures, and joinable cubes to help Data Analysts discover existing metrics before duplicating them.

**Source brainstorm:** [metadata-catalog-tab-system-meta.md](../reports/metadata-catalog-tab-system-meta.md)

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Pipe and Grid](./phase-01-pipe-and-grid.md) | Pending |
| 2 | [Search and Facets](./phase-02-search-and-facets.md) | Pending |
| 3 | [Detail Drawer](./phase-03-detail-drawer.md) | Pending |
| 4 | [Polish and Guards](./phase-04-polish-and-guards.md) | Pending |

## Key Decisions (locked from brainstorm)

- **Auth:** `VITE_CUBE_API_SECRET` env var, browser-signed JWT. Test raw-secret-as-Bearer first; only add `jose` if Cube backend rejects it.
- **Audience:** Data Analysts exploring schema to build new metrics.
- **Scope:** New page only. No changes to `/build` or `/schema`.
- **Posture:** Internal/localhost only. PROD guard hides the tab in build artifacts.
- **Search UI:** Faceted card grid. Tier 1 facets from Cube built-ins; Tier 2 auto-detected from `meta.*` (≥3 cubes, ≤20 unique values).

## Dependencies

None. No overlap with existing UI redesign plans (`pane-ui-redesign-modern-rounded`, `mid-panel-v2-pixel-polish`, `filter-results-compact-resize`) — those touch the Playground page, this is a new route.

## Total Effort

≈ 1 week focused work (4 phases × 1–2 days each).
