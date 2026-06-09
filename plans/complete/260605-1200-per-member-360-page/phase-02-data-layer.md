---
phase: 2
title: "Data Layer"
status: pending
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 2: Data Layer

## Overview
The data foundation: a `useMemberCubeQuery` hook (single-uid live Cube query, reusing the bare↔prefix resolver) and a `member360-panels` config registry describing all 26 cfm views (title, view, members, panel type, identity key, date-range need). No UI yet.

## Requirements
- Functional: given `(gameId, uid, query)`, hook returns logical-named rows for that user from `/cube-api/v1/load`, physicalizing on prefix workspaces and logicalizing the response. Config registry enumerates every cfm 360 panel with enough metadata to render + query it generically.
- Non-functional: no duplication of resolver internals (reuse exported helpers); hook handles loading/error/empty; respects max-3 in-flight throttle like the segment hook.

## Architecture
- `useMemberCubeQuery(gameId, query, uid, opts?)`: builds a copy of `query`, ADDs `{ member: identityDim, operator: 'equals', values: [uid] }`, physicalizes via `resolveGamePrefix` + physicalize helper from `src/lib/cube-member-resolver.ts`, calls `cubejsApi.load`, logicalizes rows back. Does NOT apply segment slice filters (unlike `useSegmentCubeQuery`) — member detail = full history. Reuse the resolver helpers and the cube client already used by `use-segment-cube-query.ts:110`.
- `member360-panels.ts`: exported array of `Member360Panel`:
  ```ts
  interface Member360Panel {
    id: string;
    title: string;
    view: string;              // e.g. 'user_profile'
    members: string[];         // dimensions + measures (logical, view-prefixed)
    panelType: 'kpiStrip' | 'dailyTimeline' | 'detailTable' | 'eventStream';
    identityKey: string;       // 'user_id' | 'playerid' | 'clientsdkuserid'
    needsDateRange: boolean;   // true for BEHAVIOR_VIEWS event panels
    pii?: boolean;             // device/ip panels
    lazy?: boolean;            // event panels: query on expand
    dateMember?: string;       // e.g. 'user_matches_panel.log_date'
  }
  ```
  Populate from `cube-dev/cube/model/views/cfm/user_360.yml` (26 views; member lists already inventoried in the brainstorm doc). Mark the 11 `BEHAVIOR_VIEWS` (per `cube-dev/cube/cube.js`) `needsDateRange: true, lazy: true`. Set `identityKey` per view: `clientsdkuserid` for login/logout, `playerid` for the role-bridge panels, `user_id` for the rest.

## Related Code Files
- Create: `src/pages/Segments/member360/use-member-cube-query.ts`
- Create: `src/pages/Segments/member360/member360-panels.ts`
- Read/reuse: `src/lib/cube-member-resolver.ts` (`resolveGamePrefix`, physicalize/logicalize), `src/pages/Segments/detail/use-segment-cube-query.ts` (client + throttle pattern)

## Implementation Steps
1. Confirm exported helper names/signatures in `cube-member-resolver.ts`; reuse, don't re-implement.
2. Write `useMemberCubeQuery` — single-uid filter, physicalize → load → logicalize, with loading/error/empty states.
3. Build `member360-panels.ts` from the cfm `user_360.yml` view inventory; set panelType/identityKey/needsDateRange/pii/lazy per view.
4. Unit-test (per TDD norm for the resolver path): hook builds correct filter + physicalizes/logicalizes; config has every view exactly once; all `BEHAVIOR_VIEWS` flagged `needsDateRange`.

## Success Criteria
- [ ] `useMemberCubeQuery` returns logicalized rows for a real cfm uid (verified against direct Trino value).
- [ ] `member360-panels.ts` enumerates all 26 cfm views; every `cube.js` BEHAVIOR_VIEW has `needsDateRange: true`.
- [ ] No resolver-internal duplication; reuses exported helpers.
- [ ] Hook + config unit tests pass.

## Risk Assessment
- Config/guardrail drift: a behavior view missing `needsDateRange` → unbounded scan rejected by `cube.js` at runtime. Mitigation: a test asserts config's needsDateRange set == `cube.js` BEHAVIOR_VIEWS set (import or mirror the list with a sync test). This also pre-empts the known M1 follow-up.
- Prefix vs game_id workspace: local dev returns null prefix; ensure logicalize is idempotent (resolver already tested for this).
