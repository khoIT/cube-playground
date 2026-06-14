# Phase 06 — Calibrate + live-validate + coverage surface + restart (gate)

**Priority:** P1 (gate) · **Status:** ☐ not started

## Context Links
- Calibration: `server/src/care/calibrate.ts`, threshold overrides via `playbook-merge.ts` (registry overrides layer, NOT registry edits).
- Sweep: `care-case-sweep.ts`, `care-sweep-execute.ts`; freshness: `data-freshness.ts` (`/api/care/data-freshness`).
- cfm gate template: plan `260609-1515/phase-06-integration-validation-demo.md`.
- Coverage report goes to `plans/reports/`.

## Overview
Tie it together for jus: restart the serving instance so all new marts load, run a full jus sweep, calibrate any degenerate cohorts (config/overrides — never registry/code), confirm the CS dashboard shows non-empty plausible cohorts with the correct per-game as-of date, write the coverage report.

## Key Insights
- DEV_MODE=false → **no hot-reload**. New marts only serve after restarting `cube_api` AND `cube-refresh-worker` (memory: cube-serving-instance-needs-restart-for-new-rollups). Without the worker restart, new (non-pre-agg) marts still serve, but restart both to be safe and to clear stale meta.
- jus active/recharge anchors differ from cfm's; the per-member anchor (`resolve-data-anchor.ts`) self-resolves — surface the date so CS reads "real data, slightly lagged", not "broken". cfm already ships `/api/care/data-freshness` + header "data as-of {date}".
- Expect degenerate 04/15 (cfm precedent: recharge sparse, activity dense). **Recalibrate, don't just retune**: exclude ratio=0 (→ churn PB14), require a real 30d baseline, pick threshold from the live jus ratio distribution (percentile). Adjust the mart's qualification floor (₫500k / 30h) to jus scale if needed.
- 06 ladder_rank tie handling: if mass-tied top fighting_power inflates `<=10`, add a tiebreak (role_level) or switch RANK→ROW_NUMBER in the Phase-04 mart.

## Data flow
restart → full sweep (`care-case-sweep`) per jus playbook → anchor-resolved windows → cohort rows → `care-case-aggregate-store` → CS dashboard By-Playbook / By-VIP + Member-360; `/api/care/data-freshness` surfaces per-game as-of date.

## Requirements
- A full jus_vn sweep opens non-empty, non-degenerate cohorts for the targeted set: 01,02,03,04,06,09,14,15,18 (+ 07 partial drill-down, 19/20 ops-partial).
- 05,08,10,11,12,13,16,17,21 remain `unavailable` (or deferred) — no fabricated cohorts.
- Per-game as-of date visible for jus; multi-match promotion works; server + client tests pass; jus `/meta` clean.

## Implementation Steps
1. Restart `cube_api` + `cube-refresh-worker` (compose). Confirm jus `/meta` lists all new marts cleanly.
2. Run a full jus sweep (sweep endpoint / scheduled run).
3. `/api/care/playbooks?game=jus_vn` → assert verdict counts (~10 available/partial: 01,02,03,04,06,09,14,15,18 + 07 partial; 19,20 ops-partial; rest unavailable). Target ≈12-13 enabled rows total.
4. `/api/care/cases?game=jus_vn` per new playbook → eyeball cohort sizes. Flag whole-VIP-base matches (predicate-too-loose) or zero.
5. Calibrate degenerate cohorts via registry **overrides** (`playbook-merge.ts`) / calibration JSON — NOT registry source edits: 04 drop, 15 session (recalibrate per jus dist), 06 rank cutoff/ties.
6. Verify in CS dashboard UI: By-Playbook pills, multi-match promotion, Member-360, per-game as-of-date header.
7. Confirm `/api/care/data-freshness?game=jus_vn` returns the jus anchor date(s).
8. Write coverage report → `plans/reports/` (which jus playbooks live, on what mart, with what caveats: 06 power-as-leaderboard, 07 partial coarse-item, deferred/unavailable list). Update `docs/` care coverage map.

## Todo
- [ ] restart cube_api + cube-refresh-worker
- [ ] jus /meta clean, all marts present
- [ ] full jus sweep
- [ ] verdict-count assertion (~12-13 enabled)
- [ ] per-playbook cohort sanity (no full-base / no-zero)
- [ ] calibrate 04/15/06 via overrides (not registry source)
- [ ] CS dashboard UI verification (pills, promotion, 360)
- [ ] per-game as-of date surfaced for jus
- [ ] coverage report in plans/reports/ + docs care map update

## Success Criteria
- ~12-13/21 jus playbooks produce non-empty, non-degenerate cohorts on the anchor day in the CS dashboard.
- No playbook silently matches the whole VIP base.
- jus as-of date visible; demo reads "real data, slightly lagged".
- Green server + client tests; clean jus `/meta`; cfm coverage untouched.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| 04/15 degenerate like cfm | High×Med | Recalibrate (exclude ratio=0, real baseline, percentile), adjust mart floor to jus scale |
| 06 ladder_rank ties → cohort too big | Med×Med | Tiebreak/ROW_NUMBER in Phase-04 mart; calibrate cutoff |
| Calibrating by editing registry source (breaks cfm) | Low×High | Use overrides/calibration layer only (`playbook-merge.ts`) — never edit `playbook-registry.ts` |
| No worker restart → stale meta / new mart not served | Med×Med | Restart both services; verify /meta |
| Accidental push to `second` (prod auto-deploy) | Low×High | Do NOT push; local-only verification |

## Backwards Compatibility
Calibration is config/overrides — additive, reversible. cfm coverage unaffected (per-game). Anchor self-heals to today when jus etl catches up (no code change).

## Security
Read-only Cube reads; `/api/care` mutations stay editor/admin gated; `?game` validated; no secrets; no prod push.

## Next
If jus etl freshness improves upstream, anchor auto-advances. Revisit 07→available (needs rare-item enum), 08/11 (needs derivable signal) only when sources appear. Generalize marts to ballistar_vn etc. as follow-up.
