---
phase: 4
title: "Funnel + retention follow-on improvements"
status: pending
priority: P2
effort: "4-6d (8 sub-features, pick subset)"
dependencies: [2, 3]
---

# Phase 4: Funnel + retention follow-on improvements

## Overview

With retention.yml + ordered_event_funnel cubes now live for all 6 games and the caching layer landed (Phases 2–3), eight follow-on features become cheap and high-value. Pick a subset — they are independent and each shippable in <1 day.

## Suggested sub-features (ranked by demo ROI × effort)

### 4.1 — Starter funnel templates (HIGH ROI, 0.5d)
Pre-populate the funnel wizard with 3 starter funnels per game:
- **Onboarding**: `register → login → first_recharge`
- **Activation**: `register → login` (day-0 close-the-loop)
- **Monetization**: `login → recharge` (any-time)

Implementation: small `funnel-templates.ts` map. Step 1 of the wizard shows a "Start from template" carousel above the typeahead. Pick → autofills steps + window. User can still customize.

**Why high ROI:** removes blank-slate paralysis; shows what's possible immediately.

### 4.2 — Cross-game funnel compare (HIGH ROI, 0.5d)
Reuse the Phase 4 (original pack) `<CompareToggle>` machinery for funnels:
- "Other game" toggle on the funnel result panel.
- Renders two funnel bar lists side-by-side with delta % per step.
- Answers "Which game has the best register→first_recharge funnel?" in one click.

**Why high ROI:** publishers love cross-title comparisons; one of the top-3 questions in every QBR.

### 4.3 — Cohort × Funnel intersection (HIGH ROI, 1d)
On the cohort grid, clicking a cohort row opens a side panel showing funnel completion for that cohort:
- Pick a funnel def (template or saved).
- Server runs the funnel filtered to the cohort's `user_id` set.
- Renders mini funnel bar list + drop-off %.

Closes the loop between "what" (cohort retention) and "why" (which step did they drop at).

**Why high ROI:** the canonical retention diagnosis workflow.

### 4.4 — Retention curve anomalies (MED ROI, 1d)
Extend Phase 2 (original pack) anomaly detector to watch the 6 retention measures (`cohort_size`, `retained_d1/3/7/14/30`) per game. Same z-score logic. Alert when D1 dips ≥2σ from 14-day baseline.

Implementation: add entries to `anomaly-config.ts`; nothing else.

**Why MED ROI:** retention is a leading indicator; ARPDAU drops follow retention drops by 1–2 weeks. But low recurrence (anomalies on retention happen less than on DAU).

### 4.5 — Funnel tile on dashboards (MED ROI, 0.5d)
Add `funnel` to the `viz_type` enum in `dashboard_tiles`. Pin a saved funnel from `/segments/new/funnel` directly to a dashboard. Tile renders the bar list.

**Why MED ROI:** dashboards become more than KPI grids; mixed-viz dashboards tell a richer story.

### 4.6 — Cohort heatmap on dashboards (MED ROI, 0.5d)
Same as 4.5 but for cohort grid. Mini heatmap (4×4 or 7×4) as a dashboard tile.

**Why MED ROI:** companion to 4.5; cohort + funnel + KPI on one dashboard = full ops view.

### 4.7 — Funnel saved-as-segment activation (LOW-MED ROI, 1d)
Segments page already supports CDP activation. With funnels stored as `funnel_json` on segments (already shipped in Phase 6), add:
- "Activate users who completed step N but not step N+1" — saves as a segment with the implicit user-id set.
- Push to CDP via existing pipeline.

**Why LOW-MED:** the "drop-off remediation" play is real but requires marketing tooling integration; demo-impressive but operational lift = TBD.

### 4.8 — Retention curve extrapolation (LOW ROI, 1d)
For not-yet-mature cohorts in the grid (e.g. D30 column for a 5-day-old cohort), extrapolate from the historical average retention curve of comparable cohorts. Surface as a striped cell with the projected value + confidence band.

**Why LOW:** mathematically tractable but methodology-debatable; opens "is your model right?" conversations that detract from the demo.

## Requirements

**Functional**
- Each sub-feature is independently mergeable.
- 4.1, 4.2, 4.3, 4.5, 4.6 reuse cached data from Phases 2/3 (no fresh Trino queries).
- 4.4 piggybacks on existing anomaly cron.
- 4.7 reuses existing CDP push.

**Non-functional**
- No new server tables (4.5 + 4.6 use `dashboard_tiles.viz_type` enum extension; 4.7 uses existing `segments`).
- Tests: each sub-feature ships with 5–10 tests minimum (pivot logic, server-side filter, UI).
- All ship behind the cache; 0 new Cube `/load` calls from browser.

## Recommended subset for the demo

**Ship 4.1, 4.2, 4.3** (≈2d). Together they tell the complete story: "here's a funnel — compare it across games — pick a cohort and see where they dropped." Skip 4.4 / 4.8 unless retention is a stated demo focus. Defer 4.5–4.7 to a follow-up sprint.

## Related Code Files

### 4.1 — Funnel templates
- **Create** `src/pages/Segments/funnel-builder/funnel-templates.ts` + tests
- **Modify** `src/pages/Segments/funnel-builder/step-events.tsx` — render carousel above typeahead

### 4.2 — Cross-game funnel compare
- **Modify** `src/pages/Segments/funnel-builder/step-result.tsx` — mount `<CompareToggle mode="game-only">`
- **Reuse** `src/QueryBuilderV2/compare/use-compare-results.ts` — generalize to accept a "funnel" resolver, OR add `useCompareFunnels` alongside

### 4.3 — Cohort × Funnel
- **Modify** `src/pages/Liveops/cohort/cohort-grid.tsx` — row click handler
- **Create** `src/pages/Liveops/cohort/cohort-funnel-panel.tsx` — side panel with funnel selector + result
- **Modify** `server/src/routes/liveops.ts` — `POST /api/liveops/funnel` accepts optional `cohort_filter: { install_date: 'YYYY-MM-DD', game: '<id>' }` → server queries `retention` cube for the user_id set, intersects with funnel WHERE clause

### 4.4 — Retention anomalies
- **Modify** `server/src/services/anomaly-config.ts` — add 6 retention measures per game

### 4.5 + 4.6 — Funnel/cohort tiles
- **Modify** `src/pages/Dashboards/tile.tsx` — `viz_type` switch: case `'funnel'` → `<FunnelBarList>`; case `'cohort'` → `<CohortGrid compact />`
- **Modify** `src/pages/Dashboards/pin-to-dashboard-button.tsx` — appear in funnel result panel + cohort grid header
- **Modify** `server/src/services/dashboard-store.ts` — extend viz_type CHECK constraint via migration 014

### 4.7 — Funnel activation
- **Create** `src/pages/Segments/funnel-builder/activate-step-segment.tsx` — UI for "completed step N but not N+1"
- **Modify** `server/src/routes/segments.ts` — save derived segment with auto-generated funnel-completion predicate
- **Reuse** existing CDP push (no server changes there)

### 4.8 — Curve extrapolation
- **Create** `src/pages/Liveops/cohort/extrapolate-retention.ts` — fit a simple decay model on mature cohorts; project not-mature cells
- **Modify** `src/pages/Liveops/cohort/cohort-grid.tsx` — render projected cells with stripe + tooltip

## Success Criteria (recommended subset)

- [ ] 4.1: 3 templates per game render in wizard Step 1; selection autofills.
- [ ] 4.2: Funnel compare toggle works against another game; deltas correct.
- [ ] 4.3: Click cohort row → funnel panel opens; funnel count ≤ cohort_size for every step.
- [ ] No new Cube `/load` from browser on any of the three.
- [ ] All tests pass; no regressions in segments, liveops, or playground suites.

## Risk Assessment

- **Risk:** 4.3 cohort-filtered funnel requires the retention cube AND the funnel cube to be deployed (they are now).
  **Mitigation:** detection check at panel open; show "Deploy retention/funnel cubes per docs" empty state otherwise.
- **Risk:** 4.7 activation creates segments that drift from the funnel definition as new events arrive.
  **Mitigation:** segments table already has refresh job — extend refresh to recompute funnel-completion membership.
- **Risk:** 4.8 extrapolation is misleading more than informative.
  **Mitigation:** ship with explicit "projected" label + confidence band; or just skip it.
- **Risk:** users want all 8 → scope creep.
  **Mitigation:** plan explicitly recommends 4.1+4.2+4.3 subset. Document defer rationale in commit message.
