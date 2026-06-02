# Phase 03 — Settings UI: coverage monitor panel

## Context
- Settings UI pattern: `src/pages/Settings/*-section.tsx`, composed in `settings-page.tsx` / `settings-tabs.tsx`, wrapped in `section-card.tsx`. Hooks like `use-app-settings.ts`.
- **MANDATORY** design rules (`docs/design-guidelines.md`): tokens only (`var(--text-primary)`, `var(--border-card)`, `var(--bg-card)`, semantic `--success-*/--warning-*/--destructive-*`), `var(--font-sans)`, spacing scale, page-header pattern. Cross-check against an existing section before shipping.
- Read-only consumption of `GET /api/business-metrics/coverage` from phase-02.

## Overview
Priority: high. Status: blocked on phase-02.
New section `metric-coverage-section.tsx` (+ `use-metric-coverage.ts` hook) registered in the Settings page. Scaffold action (phase-04) plugs into this shell.

## Requirements
- **Fetch + Refresh:** hook calls `/coverage`; "Refresh" re-runs (this is the "sync to identify gaps" action). Loading + error states.
- **Three views** (tabs or stacked cards):
  1. Broken refs — list per game: metricId, ref, reason; group by game; count badges. Use `--destructive-*` / `--warning-*` tokens by reason.
  2. Uncovered measures — per game: list `cube.member` with a checkbox + "Scaffold draft" CTA (wired in phase-04). Show count.
  3. Availability matrix — metric (rows) × game (cols) grid; cell = ✓ resolves / ✗ broken / – cube-missing using semantic tokens. Virtualize/paginate if >~60 rows.
- Empty/healthy state: "All registry metrics resolve for N games."

## Related files
- Create: `src/pages/Settings/metric-coverage-section.tsx` (< 200 LOC; split matrix into `metric-coverage-matrix.tsx` if needed), `src/pages/Settings/use-metric-coverage.ts`.
- Modify: `src/pages/Settings/settings-page.tsx` + `settings-tabs.tsx` to register the section.
- API client: follow existing fetch pattern used by other settings hooks (check `use-app-settings.ts`).

## Steps
1. Hook `use-metric-coverage` — fetch, refresh, loading/error.
2. Section shell + header matching adjacent sections (icon + 20px/700 title, eyebrow optional).
3. Broken-refs + uncovered cards.
4. Matrix component (semantic-token cells, sticky header col).
5. Register in settings tabs.

## Success criteria
- Renders broken/uncovered/matrix from live endpoint.
- Visually consistent with Dashboards/Cohort/Segments (token + header parity).
- Refresh re-pulls without full page reload.

## Risks
- Matrix size (57 metrics × 6 games = 342 cells) — fine; but guard against future growth (lazy render).
- `/coverage` latency (N× /meta) — show skeleton; do not block other settings.
