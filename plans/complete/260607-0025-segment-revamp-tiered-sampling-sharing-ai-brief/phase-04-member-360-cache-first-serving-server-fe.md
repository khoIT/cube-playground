---
phase: 4
title: Member-360 cache-first serving (server+FE)
status: completed
priority: P2
effort: 1d
dependencies:
  - 3
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
- [x] Opening a precomputed member's 360 issues 0 live Cube queries for core panels
      (cache hit OR pending lookup holds every live query — page top, journey trends, and
      details panels; reviewer traced no-double-fetch + no permanently-held-query)
- [x] Cache miss/stale path identical to today's live behavior (36h staleness; fetch failure
      → live everywhere; event/behavior tabs byte-for-byte untouched)
- [x] "as of" caption on cached panels; none on live panels
- [x] Members tab chips reflect real cache status (one aggregate fetch, never N+1)
- [x] Existing member-360 tests green (FE suite 1796 pass; only the 5 pre-existing DevAudit
      failures, confirmed unrelated on clean tree in Phase 2)

## Verification notes (260607)
- The page had evolved past the plan's panel-grid assumption into a sectioned dashboard
  (hero/monetization/journey from ONE sections-driven profile query + DetailsTabs). To serve
  the WHOLE page from cache, the registry `profile` panel columns were widened (FE + server,
  parity-tested) to cover the member360-sections.ts profileMembers union — reviewer verified
  0 missing members for cfm AND ballistar; a runtime coverage guard falls back to live on any
  future drift. The profile panel body renders nowhere (not in TAB_DEFS), so zero UI change.
- Journey trend charts derive from the cached activity/recharge timeline panels (limit 90 ≥
  the 31 charted points, same desc order), coverage-guarded per chart.
- Server: routes split into `segment-member360.ts` (guardSegment exported from segments.ts);
  per-uid status via single GROUP BY. Live-probed both endpoints on dev :3004 (real aggregate
  + panel map). Server suite 876/876; tsc clean both sides (FE 75 = pre-existing baseline).
- Code review DONE_WITH_CONCERNS, all low/non-blocking → applied L1 (memo-deps comment).
- Deliberate (review L3): chip collapses "computed-and-failed" (ok=0, error>0) into "live" —
  the page falls back live either way; aggregate already returns error counts if a 4th state
  is ever wanted.
- Plan-vs-code naming drift: chip wired into `tiered-members-view.tsx` (the actual Phase 2
  file); `tiered-members-table.tsx` never existed.

## Risk Assessment
- **Row-shape drift** between cached rows (server `/load` response) and FE renderers: cache
  stores the same logicalized row arrays the FE receives live (runner uses `logicalizeRows`
  like card-runner) — assert shape parity in one integration test.
- **Stampede on cache-status endpoint** (50 rows × poll): single aggregate query, no N+1.
