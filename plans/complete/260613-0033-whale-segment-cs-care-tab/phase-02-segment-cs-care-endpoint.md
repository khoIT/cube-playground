# Phase 02 — Segment CS-care endpoint

## Overview
- **Priority:** P0
- **Status:** pending
- `GET /api/segments/:id/cs-care` → one payload powering all 4 tab widgets.

## Key insights
- Segment members already resolved + cached by the existing members route — reuse that resolver, don't re-query the cube for membership.
- Two data sources fan out: CS reader (Phase 01) and recharge trajectory (cube `user_recharge_daily` / Trino `std_ingame_user_recharge_daily`).
- B strip = cohort compare contacted vs non-contacted; keep it server-side so the UI just renders.

## Requirements
Response shape:
```
{
  segmentId, gameId, productId, coverage: { totalMembers, contactedMembers, pct },
  freshness: { csMaxLogDate },
  pulse: { tickets, contacted, openUnresolved, negativeSentiment, lowRating },
  issueMix: [{ category, tickets, members }],
  watchlist: [{ uid, name, ltv, lastCategory, lastSource, sentiment, rating, statusGroup, daysSince, riskScore }],
  csImpact: {                         // Direction B — directional only
    contacted:   { n, avgRevPre, avgRevPost, deltaPct },
    nonContacted:{ n, avgRevPre, avgRevPost, deltaPct },
    windowDays, smallSample: boolean  // true when min(n) < ~30
  }
}
```
- `riskScore`: weighted (negative sentiment, ≤2-star, open status, payment/security category, LTV rank). Sort desc.
- `csImpact`: per contacted member, window = ±`windowDays` (default 30) around **first ticket date**; sum recharge pre/post.
  Non-contacted cohort uses the same calendar window anchored to the segment's median ticket date (or rolling 30/30).

## Related code files
- Create: `server/src/routes/segment-cs-care.ts` (or extend existing segment routes module).
- Create: `server/src/lakehouse/cs-recharge-trajectory.ts` — pre/post recharge sums per uid via Trino.
- Read: existing members resolver (`segment members` route), `server/src/lakehouse/segment-trajectory-reader.ts` (pattern).

## Implementation steps
1. Resolve members (reuse cached resolver) → `uids`, `name/ltv` map.
2. Resolve `productId` via `cs-product-map`; if game has no coverage → `404`/empty `coverage.pct=null` + flag.
3. Fan out (Promise.all): CS rows (Phase 01) + recharge pre/post for contacted & a sampled non-contacted cohort.
4. Assemble pulse/issueMix/watchlist (CS) + csImpact (recharge). Compute `riskScore`, sort watchlist.
5. Cache payload per segment (TTL ~6h — data is next-day fresh; segment recompute invalidates).

## Todo
- [ ] cs-recharge-trajectory.ts (pre/post sums)
- [ ] segment-cs-care route + assembly + riskScore
- [ ] coverage + freshness + smallSample flags
- [ ] cache + graceful Trino-timeout degradation (return partial w/ `csImpact:null`)
- [ ] compile check

## Success criteria
- Live call on `c03fd5c6…` returns coverage ≈ 21/252, issueMix top = Account/Payment, watchlist sorted by risk.
- csImpact returns both cohorts with `smallSample:true`.

## Risks
- Non-contacted cohort can be large → sample (cap ~200 uids) for the recharge query; note sampling in payload.
- Trino timeout → endpoint returns CS section even if csImpact fails (degrade, don't 500).
