---
phase: 1
title: "Foundation: extended /meta + reachability fix"
status: pending
priority: P0
effort: "0.5d"
dependencies: []
---

# Phase 1: Foundation — extended /meta + reachability fix

## Overview

Gate phase. Fix the broken meta fetch and unblock every downstream surface. Today `cubeApi.meta()` calls `/cubejs-api/v1/meta` without `extended=true`, which strips `joins[]` and `connectedComponent`. The wizard's `useReachableMembers` reads `cube.joins` and silently returns an empty graph — joins-only "Of" picks have always been broken in the new wizard. Sidebar enrichment, catalog clusters, and pre-agg badges all need the extended payload too.

## Requirements

- **Functional:**
  - All `/meta` reads go via `?extended=true`
  - `useReachableMembers` returns join-reachable members again
  - `cube.connectedComponent` available downstream
  - Existing /meta callers don't regress
- **Non-functional:**
  - Single fetch path (no parallel meta + extendedMeta confusion)
  - No new env vars / auth surface

## Architecture

```
AppContext.refreshMeta()
   ↓
fetch('/cubejs-api/v1/meta?extended=true', { headers: Authorization: Bearer cubejsToken })
   ↓
context.meta  (now includes joins[], connectedComponent, preAggregations? — verify)
   ↓
consumers: useReachableMembers, sidebar, future P6-P8
```

`@cubejs-client/core`'s `cubeApi.meta()` doesn't accept `extended` — bypass the SDK with a direct fetch in `refreshMeta`. Keep the same shape downstream.

## Related Code Files

- **Modify:**
  - `src/QueryBuilderV2/hooks/query-builder.ts` — `loadMeta` direct fetch with `?extended=true`
  - `src/QueryBuilderV2/NewMetric/hooks/use-reachable-members.ts` — confirm it reads `cube.joins` (already does)
  - `src/QueryBuilderV2/NewMetric/hooks/__tests__/use-reachable-members.test.ts` — update fixtures with `joins[]`
- **Read for context:**
  - `src/components/AppContext.tsx` — `refreshMeta` wiring
  - `src/QueryBuilderV2/QueryBuilder.tsx` — `setContext({ refreshMeta })` effect

## Implementation Steps

<!-- Updated: Validation Session 1 — added pre-implementation probe; verification confirmed `connectedComponent` is already read at query-builder.ts:1095-1106 (may already work without extended=true; probe first to confirm what's missing). -->

0. **Probe first:** `curl -H "Authorization: Bearer $TOKEN" "$API_URL/v1/meta" | jq '.cubes[] | {name, connectedComponent, joins}'` — see which fields are populated WITHOUT `extended=true`. Then re-run with `?extended=true` and diff. Confirms exactly which fields the change unlocks.
1. Replace `cubeApi.meta()` with direct fetch `${apiUrl}/v1/meta?extended=true` in `loadMeta` (`src/QueryBuilderV2/hooks/query-builder.ts:322-332`). Reuse `apiToken` for `Authorization: Bearer ...`.
2. Type the response: `{ cubes: ExtendedCube[] }` where `ExtendedCube` adds `joins?: { name: string; relationship: string; sql: string }[]` and `connectedComponent?: number`.
3. Manually probe one cube in the dev environment via curl: `curl -H "Authorization: Bearer $TOKEN" "$API_URL/v1/meta?extended=true" | jq '.cubes[0].joins'` — verify `joins[]` is non-empty for joinable cubes.
4. Update `use-reachable-members.test.ts` fixtures so a cube has at least one join — verify reachable items include the joined cube's dimensions/measures.
5. Run `npm test` — confirm all 103 existing tests still pass.

## Success Criteria

- [ ] `loadMeta` fetches with `?extended=true`
- [ ] `cube.joins` is populated for joinable cubes (verified via dev console: `useAppContext().meta.cubes[0].joins`)
- [ ] `useReachableMembers` returns join-reachable items for `mf_users` (it joins to active_daily/recharge per the schema)
- [ ] All existing tests pass
- [ ] Manual smoke: open wizard, pick `mf_users` as source — joined cube members appear in Of dropdown (regression test against v1 wizard)

## Risk Assessment

- **Risk:** `?extended=true` not honored by deployed Cube version → mitigation: probe before coding; if missing, fall back to raw `/meta` (current behavior) and surface as a known limitation in the catalog phase.
- **Risk:** payload size grows — mitigation: ballistar_vn has 4 cubes + 7 views, payload remains small. No virtualization needed at this scale.

## Security Considerations

- Same JWT as existing query-builder calls — no new auth surface.
