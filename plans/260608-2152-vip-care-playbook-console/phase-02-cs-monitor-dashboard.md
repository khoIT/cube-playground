# Phase 2 · CS Monitor Dashboard (Dashboards / CS)

**Priority:** high — the entry surface.
**Status:** pending. **Gates:** blockedBy 0, 1.
**Reference:** flow prototype surface ① — `plans/260608-2128-vip-care-cs-console-flow/VIP Care CS Console Flow.html`.

## Overview
The read-only portfolio: portfolio strip + 21-playbook grid grouped into 4 NHÓM (collapsible), with per-(game×playbook) **data-readiness badges**. Unavailable rows render greyed with the config visible, dashed metrics, **no query fired**. Live rows are clickable → Phase-3 queue.

## Design constraints (mandatory)
Match `docs/design-guidelines.md`: page-header pattern (`24px 32px`, icon + 20px/700 title, eyebrow), tokens from `src/theme/tokens.css` (`--brand`, semantic soft/ink status pairs), `maxWidth` centered. Mirror `src/pages/Dashboards/index.tsx` and the LiveOps cohort grid. No bespoke spacing/fonts.

## Surfaces & data
- **Portfolio strip:** playbooks live/total, VIPs triggered now, open cases, blended KPI attainment, SLA breaches — from `/api/care/cases` aggregates + registry.
- **Grid rows:** Population now (cohort count, served by preagg rollups on `mf_users`/`user_recharge_daily`/`active_daily`), Fired (period) = `COUNT(care_cases)`, Metric→KPI (watched metric current vs target), Attainment %, trend sparkline, priority badge, **data badge**, status dot.
- **Game switcher** drives the availability resolver → grid re-grades for cfm_vn vs jus_vn.

## Related files
- Create: `src/pages/Dashboards/cs/index.tsx`, `playbook-grid.tsx`, `portfolio-strip.tsx`, `use-care-playbooks.ts` (+ data hook).
- Modify: route table (`src/App.tsx` → `/dashboards/cs`), Dashboards nav entry.
- Read: `src/pages/Dashboards/index.tsx`, `src/pages/Liveops/cohort/index.tsx` (grid pattern), `src/theme/tokens.css`.

## Implementation steps
1. `use-care-playbooks(game)` → registry + status + cohort counts + case aggregates.
2. `portfolio-strip` (5 stats) using existing stat-card style.
3. `playbook-grid`: 4 collapsible groups; row renders by status — available (clickable, live numbers), partial (clickable, badge), unavailable (greyed, dashed, no query).
4. Route + nav under Dashboards → "CS · VIP Care".
5. Cohort-count queries go through the workspace-aware cube proxy; cache; rely on preagg rollouts for sub-second.

## Todo
- [ ] data hook (registry + counts + aggregates)
- [ ] portfolio strip
- [ ] grouped playbook grid w/ 3-state rows + data badges
- [ ] route + nav
- [ ] design cross-check vs Dashboards/Cohort

## Success criteria
- jus_vn: NHÓM 2 rows greyed (no query issued — verify network); spend/churn/anniversary show live counts.
- cfm_vn: same NHÓM 2 greyed pre-mart; flips live post-mart with no code change.
- Visual parity with adjacent pages (token audit clean).

## Risks
- 21 cohort counts/refresh could be slow → depends on the preagg rollout (`plans/260608-1733-user-behavior-cube-preagg-rollout/`); batch counts, cache, and never scan raw `etl_*`.
