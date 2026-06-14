# Phase 06 — Integration, validation, demo verification

**Priority:** P1 (gate) · **Status:** ☐ not started

## Overview
Tie it together: one daily sweep, all 17 targeted playbooks producing non-empty, plausible cohorts on the anchor day, visible in the CS dashboard. Calibrate thresholds, surface the as-of date, update docs.

## Requirements
- A full cfm_vn sweep opens cohorts for all 17 targeted playbooks (01,02,03,04,06,07,08,09,10,11,12,14,15,17,18 + any of 10/11/12 that survived their data caveats). 4 blocked (05,13,16,21) remain `unavailable`.
- CS dashboard By-Playbook + By-VIP show the new playbooks with sane counts; multi-match promotion still works.
- The as-of anchor date is visible to CS (sweep summary / banner) so cohorts aren't mistaken for "today".
- All server + client tests pass; Cube `/meta` clean.

## Implementation steps
1. Restart Cube serving instance (new cubes from 03/04/05) + run a full sweep.
2. Pull `/api/care/playbooks?game=cfm_vn` — assert verdict counts (≈17 available/partial, 4 unavailable).
3. Pull `/api/care/cases?game=cfm_vn` per new playbook — eyeball cohort sizes; flag any that match the entire VIP base (predicate-too-loose smell, like the earlier 7814 collapse) or zero.
4. Calibrate thresholds that produce degenerate cohorts (spike/drop ratios, ladder rank cutoffs, rare/SSR heuristics).
5. Verify in the CS dashboard UI (By-Playbook pills, multi-match promotion, Member-360).
6. Surface anchor date in the sweep summary + a small "data as-of {date}" hint in the dashboard header.
7. Update `docs/` (care coverage map: which playbooks live, on what mart, with what data caveats) + a coverage report in `plans/reports/`.

## Todo
- [ ] full sweep after Cube restart
- [ ] verdict-count assertion (~17/4)
- [ ] per-playbook cohort sanity (no full-base / no-zero)
- [ ] threshold calibration pass
- [ ] CS dashboard UI verification
- [ ] anchor "data as-of" surfaced in UI + sweep summary
- [ ] docs + coverage report

## Success criteria
- 17/21 playbooks produce non-empty, non-degenerate cohorts on the anchor day in the CS dashboard.
- No playbook silently matches the whole VIP base (fail-closed guard + calibration hold).
- Anchor/as-of date is visible; demo reads as "real data, slightly lagged" not "broken".
- Green tests; clean `/meta`.

## Risks
- Cohort sizes off for demo (too big/small). Mitigation: calibration pass; thresholds are config (registry overrides), not code.
- New marts slow the sweep. Mitigation: bounded date slices + pre_aggregations; daily cadence tolerates a slower sweep.
- Anchor masks a genuinely-broken pipeline later (when etl catches up, anchor→today). Mitigation: auto-detect anchor = max(log_date) self-heals.

## Security
Read-only Cube reads; `/api/care` mutations stay editor/admin gated; no secrets; no prod (`second`) push without explicit ask.

## Next
If etl freshness is fixed upstream, anchor auto-advances to today with no code change. Generalize marts to other games (jus_vn, ballistar_vn) as a follow-up. Revisit the trigger engine only if real-time spike/drop is needed beyond daily.
