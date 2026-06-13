# Phase 1 — API route + caps + cache + gating/degrade tests

**Context links:** reuse pattern `server/src/routes/segment-cs-care.ts` (guard + gate + 6h cache + 502/404 degrade), `guardSegment` `server/src/routes/segments.ts:124`, registration `server/src/index.ts:109`.

## Overview
- **Priority:** P1
- **Status:** pending
- New endpoint `GET /api/segments/:id/members/:uid/cs-tickets`. Auth `guardSegment(req,reply,id,'read')`. Resolves productId from segment game, fetches the uid's ticket details (Phase 0), applies caps, returns full payload. Same query powers row-expand (client picks summary subset) and the page. TTL cache keyed `(segmentId,uid)`.

## Data flow
```
GET /api/segments/:id/members/:uid/cs-tickets
  guardSegment(read) -> row | 403/404
  gate: predicate? game has csProductId? else 404 NO_CS_CARE
  validate uid against /^[A-Za-z0-9_-]+$/ (reject -> 400)
  ASSERT MEMBERSHIP (locked): uid MUST be in parseUids(row.uid_list_json)
    (same snapshot source as segment-cs-care.ts:116); else 404 NOT_IN_SEGMENT.
    Prevents using any readable segment as an arbitrary-uid CS-transcript lookup.
  productId from csProductId(gameId)
  cache hit (TTL) -> payload
  fetchCsTicketDetail({productId, uid, sinceDate=LOOKBACK}) -> details[]
  apply caps (tickets<=T, messages<=M/ticket, ratings<=R/ticket)
  payload = { segmentId, gameId, productId, uid,
              coverage:{joined:boolean, note}, freshness:{csMaxLogDate},
              tickets: CsTicketDetail[] }
  on Trino error -> 502 CS_TICKETS_UNAVAILABLE
```

## Requirements
**Functional**
1. Route file `segment-cs-tickets.ts`, default-export Fastify plugin; register in `index.ts` right after `segmentCsCareRoutes` (`index.ts:109`).
2. Gate identical to `segment-cs-care.ts:104-110` (predicate + `hasCsCoverage` + `csProductId != null` → else 404 `NO_CS_CARE`).
3. Caps as module consts: `MAX_TICKETS=60`, `MAX_MESSAGES_PER_TICKET=80`, `MAX_RATINGS_PER_TICKET=10`, `LOOKBACK_DAYS=365`. Truncation flags in payload (`tickets[].messagesTruncated`).
4. Per-`(segmentId,uid)` cache: `Map<string,{at,payload}>`, `CACHE_TTL_MS=6h`, `MAX_CACHE_ENTRIES≈500`, evict-oldest; `__clearCsTicketsCache()` test hook (mirror `__clearCsCareCache`).
5. Degrade: CS read failure → `502 CS_TICKETS_UNAVAILABLE` (transcript IS the core read — unlike the recharge strip, there is no partial fallback). VIP-join failure inside reader → tickets still return with `vip:null`.
6. `coverage.joined=false` + note when reader returns `[]` (uid unjoinable / no tickets) — 200 w/ empty tickets, NOT 404 (caveat b graceful degrade).

**Non-functional**: file <200 LoC; no per-request Cube cost.

## Related code files
**Create**
- `server/src/routes/segment-cs-tickets.ts`
- `server/src/routes/segment-cs-tickets.test.ts`

**Modify**
- `server/src/index.ts` — add `import segmentCsTicketsRoutes from './routes/segment-cs-tickets.js';` (near line 23) + `await app.register(segmentCsTicketsRoutes);` (after line 109). **Only file shared with Phase 5 — Phase 1 owns this one-line edit; Phase 5 does NOT touch index.ts.**

**Delete**: none.

## Implementation steps
1. Scaffold route from `segment-cs-care.ts` (copy guard+gate+cache skeleton, strip recharge/impact).
2. Validate `uid` path param against the sanitize regex; 400 on reject (defense-in-depth even though reader re-sanitizes).
2b. Membership assert (LOCKED): `if (!parseUids(row.uid_list_json).includes(uid)) return 404 NOT_IN_SEGMENT`. Reuse `parseUids` from `segment-cs-care.ts` (extract to a shared helper or duplicate the 6-line fn — DRY-extract preferred).
3. `productId = csProductId(gameId)`; `sinceDate = isoDaysAgo(LOOKBACK_DAYS)`.
4. `fetchCsTicketDetail` (Phase 0) → cap (`.slice(0,MAX_TICKETS)`; reader already caps msgs/ratings via SQL window, route re-asserts).
5. Build payload incl. `coverage.joined`, `freshness.csMaxLogDate` (max logDate across tickets), cache-set, return.
6. Tests (vitest, mock connector / injected fetch): (a) 404 NO_CS_CARE for non-predicate / uncovered game; (b) 403 path via guard (unauthorized segment); (c) 400 on bad uid; (d) 200 empty `tickets` + `coverage.joined=false` for unjoinable uid; (e) 502 on reader throw; (f) cache hit skips reader; (g) caps applied + truncation flags; (h) 404 NOT_IN_SEGMENT when uid not in uid_list_json.

## Todo
- [ ] segment-cs-tickets.ts (guard, gate, validate, fetch, caps, cache, degrade)
- [ ] register in index.ts (import + 1 register line)
- [ ] segment-cs-tickets.test.ts (cases a–g)
- [ ] tsc + vitest green

## Success criteria
- Endpoint returns full `CsTicketDetail[]` for an authorized segment+uid; gating/degrade/caps/cache all covered by tests.
- `guardSegment(...,'read')` is the only auth surface; no new public route.

## Risk assessment
| Risk | L×I | Mitigation |
|------|-----|------------|
| uid path param lets a caller read tickets for a uid NOT in the segment | M×M | RESOLVED (locked): assert `uid ∈ parseUids(uid_list_json)` → 404 `NOT_IN_SEGMENT`. Test case (h). |
| Cache unbounded across many uids | L×M | MAX_CACHE_ENTRIES evict-oldest (same as cs-care) |
| Large whale → huge payload | L×M | caps T/M/R + truncation flags |

## Security
- `guardSegment(read)` gates every call (workspace + visibility + access predicate). Transcript PII never exposed on an unauthenticated route. If membership assertion (Open Q1) is adopted, a caller cannot read an arbitrary uid's tickets by guessing — only members of segments they can read.

## Next steps
- Phase 2 (row-expand) + Phase 4 (page) consume this. Freeze the payload TS shape here so Phase 3 design + Phase 4 build can proceed.
