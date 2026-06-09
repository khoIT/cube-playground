---
phase: 4
title: "Behavior Section"
status: pending
priority: P1
effort: "1.5d"
dependencies: [3]
---

# Phase 4: Behavior Section

## Overview
Add the collapsible "Behavior" section: the 11 event-stream panels, lazy-queried on expand with a guardrail-aware (≤31d) date-range picker, plus the playerid bridge that resolves a user's role_ids before querying playerid-keyed panels.

## Requirements
- Functional: expanding "Behavior" reveals event panels for the selected ≤31d window (default last 30d). playerid-keyed panels query by `playerid IN (user's role_ids)`; login/logout query by `clientsdkuserid = user_id`. Changing the date range re-queries the section.
- Non-functional: panels query only on expand (protect Trino); every event query carries a bounded `timeDimensions.dateRange` satisfying `cube.js` guardrail; clamp any range >31d before sending.

## Architecture
- `EventStreamTable` renderer (panelType `eventStream`): takes panel + uid + resolved playerids + dateRange; builds query with `timeDimensions: [{ dimension: panel.dateMember, dateRange }]` + identity filter keyed by `panel.identityKey`.
- Date control: `BehaviorDateRange` component, default `[today-29, today]` (30d inclusive), hard-clamp span to ≤31d, expose presets last_7d/last_30d.
- playerid bridge: on section expand, fire `user_roles_panel` once for the uid → collect `role_id`s → pass as playerids to playerid-keyed panels. If 0 roles → playerid panels show empty-state (not error); login/logout still work via user_id.
- Lazy: section content mounts/queries only when expanded (config `lazy: true`).

## Related Code Files
- Create: `src/pages/Segments/member360/panels/event-stream-table.tsx`
- Create: `src/pages/Segments/member360/behavior-section.tsx`, `behavior-date-range.tsx`
- Modify: `src/pages/Segments/member360/Member360View.tsx` (mount Behavior section)
- Read: `cube-dev/cube/cube.js` (guardrail bounds: `MAX_RANGE_DAYS`, BEHAVIOR_VIEWS)

## Implementation Steps
1. Build `behavior-date-range.tsx` with ≤31d clamp + presets; default last 30d.
2. Build `behavior-section.tsx`: collapsed by default; on expand, resolve role_ids via `user_roles_panel`, then render event panels.
3. Build `event-stream-table.tsx`: query with bounded dateRange + identity filter (playerid vs clientsdkuserid per config).
4. Wire into `Member360View`.
5. Verify guardrail: a panel query always includes a ≤31d range; confirm an over-range request is clamped client-side (and that the server would otherwise reject it).
6. Edge cases: user with 0 roles (empty playerid panels, no crash); stale event tables (empty for recent dates — allow picking a historical in-range window).

## Success Criteria
- [ ] Behavior section collapsed by default; expanding queries event panels for the window.
- [ ] All event queries carry a ≤31d `dateRange`; >31d is clamped before send.
- [ ] playerid bridge resolves role_ids once; playerid panels return data; 0-role user → empty-state.
- [ ] login/logout panels return data via clientsdkuserid=user_id.
- [ ] Changing date range re-queries; no unbounded scan ever sent.

## Risk Assessment
- Guardrail rejection (HTTP 500) if a range slips through unbounded → client-side clamp + always-set dateRange; assert in a test.
- N event queries on expand could still be heavy → fire them concurrently but only on expand; consider per-panel collapse if a single panel is slow (money_flow 1.35B rows).
- Stale event data makes panels look broken → empty-state copy distinguishes "no events in window" from error.
