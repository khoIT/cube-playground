---
title: "CS segment live-count + per-segment sweep + monitor redesign"
description: "Edit a VIP-care playbook condition, preview live match count from Trino, save threshold, sweep that one segment; redesign CS Monitor around live editable segments."
status: pending
priority: P2
effort: ~14h
branch: main
tags: [care, cs-console, cube, sweep, ui-redesign]
created: 2026-06-09
---

# CS segment live-count + per-segment sweep + monitor redesign

On `#/dashboards/cs` the "segments" are the 21 VIP-care playbooks. Goal: edit a
playbook's filter condition, see how many VIPs match against LIVE Trino data
(ad-hoc), save the threshold, then immediately open/lapse cases for THAT ONE
playbook. Plus a full CS Monitor redesign around live, editable segments
(design variants first).

## Critical correctness note (clears a user misconception)
The SQLite store holds case + VIP-profile **snapshots**, NOT raw VIP rows. A live
match count therefore CANNOT come from SQLite — it requires a live Cube/Trino
query. The preview-count path reuses the EXACT sweep compile/gate pipeline
(`mergePlaybooks` → `compileRule` → VIP-base gate → `treeToCubeFilters` →
`loadWithCtx`) so a previewed count == the cohort the real sweep would open.
Cold Trino is 3.5–15s; counts are explicit-click only (never on keystroke).

## Phases

| # | Phase | Status | Effort | Blocks |
|---|-------|--------|--------|--------|
| 1 | [Backend: preview-count + per-segment sweep](phase-01-backend-preview-count-and-per-segment-sweep.md) | pending | ~5h | 2,3 |
| 2 | [Builder: Count matches + Save & sweep segment](phase-02-builder-count-and-save-sweep.md) | pending | ~4h | — |
| 3 | [CS Monitor redesign (variants first)](phase-03-monitor-redesign-live-segments.md) | pending | ~5h | — |

## Dependency graph
- Phase 1 (backend) blocks Phase 2 + Phase 3 React wiring (both call new endpoints).
- Phase 3's design-variant deliverable (static HTML) has NO blocker — can start
  immediately in parallel with Phase 1. The React implementation of Phase 3 is
  blocked by Phase 1 + the user's variant pick.
- Phase 2 and Phase 3-React are independent (different files) once Phase 1 lands.

## Key invariants (do NOT break)
- Existing full-sweep path (`POST /api/care/cases/sweep` from case-ledger "Run
  sweep") and registry/override contracts stay byte-compatible. New behavior is
  additive (optional `playbook` query param; new `preview-count` route).
- Preview-count is READ-ONLY: no case writes, no run record, no profile enrich.
- Per-segment sweep shares the SAME per-(workspace,game) mutex — it must NOT run
  while a full sweep is in flight (and vice-versa).
- DRY: preview-count and sweep both compile via the merge/compile pipeline; do
  not fork a second filter builder.
- Design tokens only (`var(--*)`), no raw hex; follow `docs/design-guidelines.md`
  and the fixed page-header pattern.

## File ownership (no overlap between phases)
- Phase 1: `server/src/care/*`, `server/src/routes/care-cases.ts`,
  new `server/src/routes/care-playbook-preview.ts`, `server/test/*`.
- Phase 2: `src/pages/Dashboards/cs/playbook-builder.tsx`,
  `use-playbook-mutations.ts` (+ new `use-playbook-preview.ts`), builder test.
- Phase 3: `visuals/*.html`, then `index.tsx`, `playbook-grid.tsx` (or new
  `segment-card-grid.tsx`), `use-care-playbooks.ts` (+ new sweep-snapshot hook),
  monitor test.

## Open questions
See per-phase "Open questions" sections; consolidated at end of phase-03.
