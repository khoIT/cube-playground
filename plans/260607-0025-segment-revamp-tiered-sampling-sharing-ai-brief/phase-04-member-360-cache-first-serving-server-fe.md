---
phase: 4
title: "Member-360 cache-first serving (server+FE)"
status: pending
priority: P2
effort: "1d"
dependencies: [3]
---

# Phase 4: Member-360 cache-first serving (server+FE)

## Overview
Serve the precomputed core panels to the member-360 page: new gateway endpoint returning the
cached panel map; FE hydrates core panels from cache instantly and only falls back to live Cube
queries on miss/stale. Behavior (lazy) panels always stay live.

## Requirements
- Functional: `GET /api/segments/:id/members/:uid/panels` → `{ panels: { [panelId]:
  { rows, fetched_at, status, error? } }, cached: boolean }`; FE renders cached rows with an
  "as of" caption; live fallback preserved for cache miss, stale (>36h), or `status='error'`.
- Non-functional: zero behavior change for games/segments without cache; no double-fetch
  (cache hit must suppress the live query for that panel).

## Architecture
- Gateway route in `segments.ts` (or `segment-members.ts` split if LOC pressure): `guardSegment`
  read-access, then `member360-cache-store.getForMember(segmentId, uid)`.
- FE: extend `use-member-cube-query.ts` minimally — new hook `use-cached-panel-source.ts`
  fetches the panel map once per page mount (single HTTP call), exposes
  `getCached(panelId) → rows | null`; `member-panel.tsx` consults it before issuing the live
  query. Stale/missing/error → existing live path untouched.
- Freshness: cached `fetched_at` older than 36h (24h cadence + 12h grace) treated as miss.
- UI affordance: small muted caption on cached panels — "precomputed · as of {relative}"
  (i18n `segments.member360.cachedAsOf`); live panels unchanged. Members-tab per-row chip from
  Phase 2 gets real data: endpoint `GET /api/segments/:id/member-cache-status` returning
  per-uid ok/partial/none counts (cheap aggregate over cache table).

## Related Code Files
- Modify: `server/src/routes/segments.ts` (2 GET endpoints; split if >200 LOC delta)
- Modify: `server/src/services/member360-cache-store.ts` (getForMember, statusBySegment)
- Create: `src/pages/Segments/member360/use-cached-panel-source.ts`
- Modify: `src/pages/Segments/member360/member-panel.tsx`,
  `src/pages/Segments/detail/tabs/tiered-members-table.tsx` (chip wiring)
- Modify: i18n locales

## Implementation Steps
1. Store getters + gateway endpoints (panels map, cache-status aggregate).
2. `use-cached-panel-source.ts`: one fetch per (segment, uid) mount; AbortController; error →
   null source (live everywhere).
3. `member-panel.tsx`: consult cached source first; suppress live query on hit; caption.
4. Wire members-table cache chip (ok=green soft, partial=warning soft, none=muted).
5. Tests: endpoint auth (non-accessible segment 403/404), cache-hit suppresses live query
   (FE test with mocked fetch), stale → live, error rows → live, chip states.

## Success Criteria
- [ ] Opening a precomputed member's 360 issues 0 live Cube queries for core panels
- [ ] Cache miss/stale path identical to today's live behavior
- [ ] "as of" caption on cached panels; none on live panels
- [ ] Members tab chips reflect real cache status
- [ ] Existing member-360 tests green

## Risk Assessment
- **Row-shape drift** between cached rows (server `/load` response) and FE renderers: cache
  stores the same logicalized row arrays the FE receives live (runner uses `logicalizeRows`
  like card-runner) — assert shape parity in one integration test.
- **Stampede on cache-status endpoint** (50 rows × poll): single aggregate query, no N+1.
