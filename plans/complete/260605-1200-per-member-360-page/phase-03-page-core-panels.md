---
phase: 3
title: "Page + Core Panels"
status: pending
priority: P1
effort: "1.5d"
dependencies: [2]
---

# Phase 3: Page + Core Panels

## Overview
Wire the route, make member rows clickable, build the `Member360View` shell + header, and render the eager (non-event) panels via the generic renderers. Page is usable end-to-end for a cfm member minus the behavior section.

## Requirements
- Functional: `/#/segments/:id/members/:uid` renders profile header + KPI strip + core panels (profile, roles, devices, ips, activity timeline, recharge timeline, monthly rollups). Clicking a member uid in the members tab navigates here; back returns to `?tab=members`.
- Non-functional: design-tokens only; page-header pattern matches Dashboards/Cohort; first paint ~0.5s (profile resolves first).

## Architecture
- Route: add `<Route path="/segments/:id/members/:uid" component={Member360View} />` to `src/pages/Segments/segments-page.tsx` (hash router).
- `Member360View`: read `:id`/`:uid` params; `segmentsClient.get(id)` → `game_id` + `identityDim`; render header, then map `member360-panels` (eager subset) to renderers, each calling `useMemberCubeQuery`.
- Renderers (generic, panelType-dispatched):
  - `KpiStrip` — single-row profile measures as stat cards.
  - `DailyTimeline` — date-series table/sparkline (activity, recharge timelines).
  - `DetailTable` — rows table (roles, devices, ips, monthly rollups) with PII chip when `panel.pii`.
- Members tab change: in `src/pages/Segments/detail/tabs/sample-users-tab.tsx`, render the uid cell as a link to the route (keep CSV export + search intact).

## Related Code Files
- Create: `src/pages/Segments/member360/Member360View.tsx`
- Create: `src/pages/Segments/member360/panels/kpi-strip.tsx`, `daily-timeline.tsx`, `detail-table.tsx`
- Modify: `src/pages/Segments/segments-page.tsx` (route), `src/pages/Segments/detail/tabs/sample-users-tab.tsx` (clickable uid)
- Read: `src/pages/Dashboards/index.tsx` (header pattern), `docs/design-guidelines.md`

## Implementation Steps
1. Add the nested route; verify it doesn't shadow `/segments/:id` or `/segments/:id/edit`.
2. Build `Member360View` shell: param parse → segment fetch → header (icon + uid + `cfm` eyebrow) → loading/error/not-found states.
3. Build the 3 eager renderers to tokens.
4. Map eager panels from config → renderers; profile query fires first for the header KPIs.
5. Make uid cell a link in `sample-users-tab.tsx`; preserve existing search/export/sort behavior.
6. Manual smoke: navigate from a real segment member → page renders core panels; back-nav restores tab+section query params.

## Success Criteria
- [ ] Route renders for `/#/segments/:id/members/:uid`; clickable rows navigate; back restores `?tab=members`.
- [ ] Profile header + KPI strip + all core panels render for a real cfm member.
- [ ] PII chip shows on device/ip panels.
- [ ] No regression to members tab (search, CSV export, sample/sort still work).
- [ ] Tokens/page-header match an adjacent page (no drift).

## Risk Assessment
- Route shadowing: nested `:uid` route ordering vs `/edit`. Mitigation: register specific routes before param routes; smoke all segment routes.
- Members tab regression (shared file w/ snapshot plan): keep the change minimal (cell → link); don't touch search/export logic.
- Empty profile (uid not in mf_users): render not-found state, don't crash.
