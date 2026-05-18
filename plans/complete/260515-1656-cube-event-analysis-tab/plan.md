---
title: 'Cube Event Analysis Tab — Breakdown, Distribution, Funnel'
description: >-
  Add an Analysis tab to QueryBuilderInternals with three product-analytics
  modes (Breakdown, Distribution, Funnel) that work out-of-the-box against any
  standard Cube event cube — no backend YAML edits, no pre-aggregations
  required.
status: completed
priority: P2
branch: main
tags:
  - frontend
  - querybuilder
  - analytics
blockedBy: []
blocks: []
created: '2026-05-15T09:59:36.405Z'
createdBy: 'ck:plan'
source: skill
---

# Cube Event Analysis Tab — Breakdown, Distribution, Funnel

## Overview

Add a new `Analysis` tab to `QueryBuilderInternals.tsx` next to Results/SQL/JSON/REST/GraphQL. Tab hosts a mode picker (Breakdown | Distribution | Funnel) and renders mode-specific UI that reuses the pill-bar query state. All three modes work on any cube exposing `event_type` + `timestamp` + `user_id` semantics — zero backend setup. Empty states ship with a "Try sample" button that auto-fills inputs against the first usable cube.

Source research: `plans/reports/research-260515-1611-cube-event-exploration-gaps-vs-product-analytics.md`.
Locked decisions (2026-05-15):
- **D1** v1 ships Breakdown + Distribution + Funnel. Cohort + Sankey deferred.
- **D2** Surface = new `Analysis` tab in QueryBuilderInternals (not pill-bar mode-switcher).
- **D3** Funnel impl = client-side N parallel `cubeApi.load()` queries against any event cube.
- **D4** Onboarding = empty-state per mode with one-line description + "Try sample" button.
- **D5** True ordered-sequence funnel ships as **opt-in template cube + UI auto-detect** (phase 6). Multi-query "all events" path stays the zero-setup default; ordered path activates silently when the template is deployed. Closes the phase-4 fidelity gap without forcing backend work for the v1 happy path.

## Phases

| Phase | Name | Status |
|-------|------|--------|
| 1 | [Scaffold Analysis tab and mode router](./phase-01-scaffold-analysis-tab-and-mode-router.md) | Completed |
| 2 | [Breakdown mode](./phase-02-breakdown-mode.md) | Completed |
| 3 | [Distribution mode](./phase-03-distribution-mode.md) | Completed |
| 4 | [Funnel mode](./phase-04-funnel-mode.md) | Completed |
| 5 | [Empty states Try sample and smoke](./phase-05-empty-states-try-sample-and-smoke.md) | Completed |
| 6 | [Ordered funnel cube template and auto-detect](./phase-06-ordered-funnel-cube-template-and-auto-detect.md) | Completed |

## Dependencies

- Existing pill-bar (phase-04 of `260515-1318-gds-cube-ui-revamp-stitch`) — merged.
- Cube API: `context.cubeApi.load(query)` (verified `hooks/query-builder.ts:269`).
- Meta exposure: `context.meta` + `context.usedCubes` (verified `hooks/query-builder.ts:176, 214`).
- Chart lib: `recharts@^2.12.7` (already present).
- antd 4 controls (Radio.Group, InputNumber, Empty) — already present.

## Key Files Touched

| File | Touch | Why |
|------|-------|-----|
| `src/QueryBuilderV2/QueryBuilderInternals.tsx` | modify (1-3 LOC per phase) | Add `'analysis'` to Tab union, mount `<AnalysisPanel/>` |
| `src/QueryBuilderV2/analysis/analysis-panel.tsx` | NEW | Tab body, mode router |
| `src/QueryBuilderV2/analysis/mode-picker.tsx` | NEW | Radio group + mode state |
| `src/QueryBuilderV2/analysis/breakdown-mode.tsx` | NEW | Reuses results-grid renderer |
| `src/QueryBuilderV2/analysis/distribution-mode.tsx` | NEW | Client-side bucketing + recharts histogram |
| `src/QueryBuilderV2/analysis/funnel-mode.tsx` | NEW | Step picker + N-query orchestrator + drop-off renderer |
| `src/QueryBuilderV2/analysis/use-funnel-queries.ts` | NEW | Hook wrapping multi-load orchestration |
| `src/QueryBuilderV2/analysis/sample-detector.ts` | NEW | Inspect meta to suggest event-type dim + first cube |
| `src/QueryBuilderV2/analysis/detect-ordered-funnel.ts` | NEW (phase 6) | Scan `meta.cubes` for the opt-in ordered-funnel template |
| `src/QueryBuilderV2/analysis/use-ordered-funnel-query.ts` | NEW (phase 6) | Single-query ordered-funnel hook (drop-in for `use-funnel-queries`) |
| `docs/ordered-funnel-cube-template.md` | NEW (phase 6) | Canonical Postgres YAML template + setup checklist + dialect notes |

All new files < 200 LOC. Each phase keeps existing context API untouched.

## Non-Goals

- Cohort retention (research §6 — defer to true v2).
- Sankey / path analysis (architectural mismatch).
- Computed-dimension UI / inline YAML editor in the playground.
- Pre-aggregation creation UI (the opt-in funnel template doc *recommends* one for scale but doesn't ship a UI for it).
- New routes — Analysis lives inside `/build` page.

## Success Metric

**v1 happy path:** a user lands on `/build`, clicks **Analysis**, picks any mode, hits **Try sample**, and sees a real chart/table within 2 clicks — no manual cube selection, no docs.

**Ordered funnel upgrade path:** a data engineer copies one YAML cube from `docs/ordered-funnel-cube-template.md` into their Cube backend, restarts, refreshes the playground — funnel-mode silently flips to ordered single-query semantics. Zero code change in the playground.
