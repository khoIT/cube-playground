---
title: "GDS Cube UI Revamp — Stitch Mockup Adoption"
description: "Reskin GDS Cube playground to match standalone Stitch mockup. Theme + chrome rewrite + new pill bar. Keep QBv2 logic untouched."
status: completed
priority: P2
effort: 6-8d
branch: main
tags: [ui, revamp, theme, querybuilder-v2, stitch]
created: 2026-05-15
completed: 2026-05-15
---

# GDS Cube UI Revamp — Stitch Mockup Adoption

## Goal

Adopt the visual language of the standalone Stitch mockup (`Cube Playground _standalone_.html`) without changing QueryBuilderV2 behaviour. Cube backend stays read-only.

## Sources

- Mockup research: `plans/reports/research-260515-1254-ui-revamp-stitch-standalone-mockup.md`
- Backend constraints: `plans/reports/research-260515-1311-cube-api-rename-support.md`

## Locked Decisions

D1 Cube/View rename = **client-side alias only** (localStorage). YAML untouched.
D2 Icon picker = **lucide-react free-text** popover.
D3 Show real cube name as monospace label beneath alias.
D4 Views get icons too (same hook).
D5 Pill bar = 4 rows: **Dimensions → Measures → Time → Filters**. Time keeps granularity chip.
D6 Right rail = **OUT OF SCOPE v1**. Keep existing QueryTabs strip.
D7 antd overrides = **stylesheet overrides**, not Less recompile.
D8 Geist via Google Fonts CDN in `index.html`.
D9 RequestMetricModal / AI-assist = OUT OF SCOPE.
D10 Don't touch rollup designer, Security Context, or QBv2 tab content beyond restyle.

## Phases

| # | File | Status | Effort | Depends |
|---|---|---|---|---|
| 1 | `phase-01-tokenisation.md` | completed | 1d | — |
| 2 | `phase-02-top-bar.md` | completed | 0.5d | 1 |
| 3 | `phase-03-schema-sidebar.md` | completed | 2d | 1 |
| 4 | `phase-04-query-state-pill-bar.md` | completed | 2d | 1, 3 |
| 5 | `phase-05-results-and-chart-panel.md` | completed | 1.5d | 1 |
| 6 | `phase-06-polish-and-smoke-test.md` | completed | 0.5d | 1–5 |

Status values: `pending` | `in-progress` | `completed`.

## Key Dependencies

- Phase 1 unblocks all visual work (tokens drive everything).
- Phases 2, 3, 5 can run in parallel after 1 — different files.
- Phase 4 depends on Phase 3 only for the `use-cube-alias` hook (member labels).
- Phase 6 gates merge.

## File Ownership

| Phase | Owns |
|---|---|
| 1 | `src/theme/*`, `index.html`, `src/index.css` |
| 2 | `src/components/Header/*` |
| 3 | `src/QueryBuilderV2/QueryBuilderSidePanel.tsx`, `src/hooks/use-cube-alias.ts`, new `src/QueryBuilderV2/components/cube-row-editor.tsx`, new `src/QueryBuilderV2/components/icon-picker.tsx` |
| 4 | new `src/QueryBuilderV2/QueryStatePillBar.tsx` + `src/QueryBuilderV2/components/member-pill-row.tsx`, edits in `src/QueryBuilderV2/QueryBuilder.tsx` (mount point only) |
| 5 | `src/QueryBuilderV2/QueryBuilderResults.tsx` (tab reorder only), `src/QueryBuilderV2/QueryBuilderChartResults.tsx` (restyle), `src/QueryBuilderV2/QueryBuilderChart.tsx` (panel wrap) |
| 6 | smoke + screenshots only |

No two phases edit the same file beyond the QueryBuilder.tsx mount point in phase 4.

## Out of Scope (deferred)

- Rename = real file write (needs `:rw` mount + sidecar).
- Right rail (saved queries panel).
- AI-assist / RequestMetric workflow.
- Rollup designer / Add Security Context redesign.
- Test suite — smoke only.

## Success Criteria

- Dev server boots, `/build` + `/schema` work, queries against `:4000` execute end-to-end.
- Header, sidebar, query card, results panel visually match mockup tokens.
- Cube alias rename + icon survives reload.
- No console errors. `npm run build` (`tsc --noEmit && vite build`) passes.

## Risks (top 3)

| Risk | Mitigation |
|---|---|
| antd 4 Less variables fight CSS custom-property overrides | Phase 1 isolates override stylesheet, target specific class names |
| Mixing UI-kit + raw JSX styling fragments visuals | Use UI-kit primitives in new chrome; restrict raw JSX to Header pill row |
| Pill bar duplicates side panel state, confuses UX | Highlight selected in both surfaces; pill bar = mutations source-of-truth |
