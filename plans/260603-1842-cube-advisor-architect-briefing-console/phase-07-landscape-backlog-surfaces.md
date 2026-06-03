---
phase: 7
title: "Landscape + Backlog surfaces"
status: pending
priority: P2
effort: "1d"
dependencies: [4, 6]
---

# Phase 7: Landscape + Backlog surfaces

## Overview
The two secondary dashboard surfaces: **Landscape** consolidates the *existing* feature/plan state of the ecosystem (your explicit ask), and **Backlog** shows full idea history with status filters. Together with Briefing they make one console: current state + open ideas + history.

## Requirements
- Functional:
  - **Landscape**: read-only view of existing features + plans, sourced from `cube-playground/docs/codebase-summary.md`, README routes/surfaces, and `cube-playground/plans/` (+ `plans/complete/`). Grouped by area; shows status (shipped / in-flight / planned). Refreshable.
  - **Backlog**: all ideas across runs, filter by category + status (new/accepted/dismissed/snoozed/shipped/already-planned), sortable by score/recency; status mutation inline.
- Non-functional: Landscape derives from files at request time (no manual upkeep); cheap to compute (cache per request).

## Architecture
- `GET /api/landscape`: backend scans the configured cube-playground paths → parses `codebase-summary.md` headings + README "Surfaces"/"Routes" + `plans/*/plan.md` frontmatter (title/status) → returns a grouped inventory. Pure parse functions, unit-tested against fixtures.
- Backlog reuses `GET /api/ideas` (no status filter cap) + `PATCH /api/ideas/:id` from Phase 4.
- Frontend: `Landscape.tsx` (grouped cards/table), `Backlog.tsx` (filterable table), nav between the three surfaces.

## Related Code Files
- Create: `backend/src/landscape/scan-landscape.ts` (parse summary/README/plan frontmatter), `backend/src/routes/landscape.ts`
- Create: `frontend/src/pages/Landscape.tsx`, `frontend/src/pages/Backlog.tsx`, nav/shell update in `App.tsx`
- Create tests: `backend/test/scan-landscape.test.ts`, `frontend/test/Backlog.test.tsx`
- Fixtures: `backend/test/fixtures/codebase-summary.sample.md`, `plan-frontmatter.sample.md`

## TDD — Tests First
1. `scan-landscape.test.ts`: given sample summary + README + plan frontmatter fixtures → returns the expected grouped inventory with correct statuses; tolerates a missing file (degrades, doesn't throw).
2. `Backlog.test.tsx` (RTL): renders ideas, filters by status/category, triggers status mutation; empty state when no ideas.
3. Implement until green.

## Implementation Steps
1. Implement `scan-landscape.ts` parse functions + `landscape.ts` route (with per-request cache).
2. Build `Landscape.tsx` grouped view.
3. Build `Backlog.tsx` filterable table reusing Phase 4 APIs.
4. Add top-nav across Briefing / Landscape / Backlog.
5. Green tests; manual smoke.

## Success Criteria
- [ ] `scan-landscape.test.ts` + `Backlog.test.tsx` green
- [ ] Landscape shows real cube-playground features/plans grouped with accurate statuses, and refreshes from files
- [ ] Backlog lists all ideas with working category/status filters + inline status changes
- [ ] Three surfaces navigable in one console

## Risk Assessment
- `codebase-summary.md`/README structure may change → parsers target stable headings and degrade gracefully (missing section ≠ crash); covered by fixtures.
- Plan frontmatter variance across plans → see hardening below (parse BOTH frontmatter and prose).

## Red Team Hardening (applied)
- **Parse BOTH plan shapes** (#13): only **3 of 6** active `plans/*/plan.md` have YAML frontmatter; the rest use a freeform `**Status:**` prose line (e.g. `plans/260601-1319-…/plan.md`). The parser must read YAML frontmatter when present AND fall back to the `**Status:**` prose convention — defaulting everything-without-frontmatter to "planned" would mislabel shipped/in-flight work and defeat Landscape's purpose. Fixtures MUST include a frontmatter-less plan and a `**Status:**`-prose plan. (`plans/complete/` is healthier: ~44/49 have frontmatter.)
- **README has three distinct shapes** (#A6): `Surfaces:` is a lowercase inline label + bold bullets (README:5), `## Routes` is a heading whose body is a pipe TABLE (README:79), and `docs/codebase-summary.md` uses real `##/###` headings. A naive heading scanner misses Surfaces. Either enumerate all three shapes with a fixture each, OR (simpler) derive the feature inventory primarily from `codebase-summary.md` headings and treat README as secondary. Decide in step 1.
- **Volatile source** : `codebase-summary.md` changes often (edited 2026-06-03) → parser tolerates structure shifts (missing section degrades, never throws); covered by fixtures.
