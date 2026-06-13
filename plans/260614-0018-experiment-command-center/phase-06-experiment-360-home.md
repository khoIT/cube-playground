# Phase 06 — Experiment-360 Drilldown + Command-Center Home

## Context links
- Report §4.3 item 7 (experiment-360, like care-history-360), §4 home/list.
- Drilldown template: `src/pages/Segments/member360/care-history-360/*` (page + header + timeline + transcript composition).
- List/home template: `src/pages/Dashboards/index.tsx` (DashboardsListPage) or `src/pages/Segments` list.
- Backend: `GET /api/experiments?game` (list), `GET /api/experiments/:id/members/:uid` (drilldown) — Phase 3.
- Shared: `experiments-client.ts`, `experiment-header.tsx` (Phase 4).

## Overview
- **Priority:** P2.
- **Status:** pending.
- Two surfaces: (a) `/experiments` home — list of experiments for the active game with status + quick links to queue/scorecard; (b) `/experiments/:id/members/:uid` — per-member drilldown (arm, LTV/recency, outcome in window, CS contact history) mirroring care-history-360.

## Key insights
- Home = the command-center landing. Card/row per experiment: name, status pill, arm counts, primary-metric lift (if running/completed), links to queue + scorecard. Create-experiment entry (draft form — minimal: name, hypothesis, cohort params, split). Mirror `DashboardsListPage` header + list shape.
- Drilldown reuses the care-history-360 composition idea (header + sectioned detail) but simpler: member's arm, contacted-or-not + action + CSAT, pre/post outcome. Link from scorecard/work-queue rows.
- DRY: create-experiment form posts via `experiments-client.createExperiment`; an "Assign" button on a draft calls `assignExperiment` then routes to the queue.

## Requirements
Functional:
1. `/experiments` — list for active game (uses GameContext); each row links to queue + scorecard; "New experiment" → draft form; draft rows show "Assign" action.
2. Draft form: name, hypothesis, ltv_floor_vnd, lapse_min/max_days, split_pct, window_days, primary_metric, outreach_script. Minimal validation client-side; server zod is authority.
3. `/experiments/:id/members/:uid` — arm, member name/LTV/recency, window outcome (rev/trans/repaid), CS contact history (action, CSAT, time). Membership-gated server-side (Phase 3).

Non-functional: lazy-loaded; tokens; active-game scoping via existing `GameContext`/`getActiveGameId`.

## Data flow
```
/experiments → useExperiments(game) → GET /api/experiments?game → list rows
  "New" → form → POST /api/experiments (draft)
  "Assign" → POST /api/experiments/:id/assign → redirect /queue
/experiments/:id/members/:uid → useExperimentMember(id,uid) → GET .../members/:uid
```

## Related code files
Create:
- `src/pages/Experiments/index.tsx` (home/list — `ExperimentsListPage`)
- `src/pages/Experiments/use-experiments.ts`
- `src/pages/Experiments/experiment-create-form.tsx`
- `src/pages/Experiments/member-detail-page.tsx` (experiment-360)
- `src/pages/Experiments/use-experiment-member.ts`

Modify:
- `src/index.tsx` — routes: `/experiments` (list), `/experiments/:id/members/:uid` (drilldown). Order: longest-prefix routes (queue, scorecard, members) BEFORE bare `/experiments` so the exact list route doesn't swallow children (mirror the `/dashboards/*` ordering in `index.tsx:242-248`).

Read for context: `care-history-360-page.tsx`, `DashboardsListPage` (`src/pages/Dashboards/index.tsx`), `experiment-header.tsx`.

## Implementation steps
1. `use-experiments.ts` — list fetch hook (active game).
2. `index.tsx` (ExperimentsListPage) — header (FlaskConical icon + 20px/700 title) + experiment rows + "New" button. Match Dashboards list styling.
3. `experiment-create-form.tsx` — controlled form → `createExperiment`; on success route to the new experiment.
4. `member-detail-page.tsx` + `use-experiment-member.ts` — compose header + arm badge + outcome section + CS-contact section. Reuse care-history-360 section styling where sensible.
5. Wire routes in `src/index.tsx` with correct ordering (children before parent).
6. Compile + lint; visual cross-check vs Dashboards list + care-history-360.

## Todo
- [ ] `use-experiments.ts`
- [ ] `index.tsx` ExperimentsListPage
- [ ] `experiment-create-form.tsx`
- [ ] `use-experiment-member.ts`
- [ ] `member-detail-page.tsx`
- [ ] route wiring (child-before-parent order)
- [ ] compile clean, visual cross-check

## Success criteria
- `/experiments` lists experiments for active game; create → draft → assign → queue flow works end to end.
- Member drilldown shows arm + outcome + CS contact for an in-arm uid; non-member uid → 404 (server gate).
- Visual parity with Dashboards list + care-history-360.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Route ordering swallows child routes | M×M | List children (queue/scorecard/members) before bare `/experiments`; mirror dashboards ordering. |
| Create form drifts from server zod | L×M | Server zod authoritative; surface its 400 messages in the form. |
| Drilldown over-fetches / leaks PII | L×H | Reuses `/members/:uid` (uid + metrics + action codes only); no PII. |

## Security (PII)
- Drilldown shows uid + numeric outcome + CS action codes/CSAT only. No contact PII. Membership-gated server-side.

## Next steps
Phase 7 tests the full flow + docs.
