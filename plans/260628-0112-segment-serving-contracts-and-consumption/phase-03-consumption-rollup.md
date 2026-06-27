---
phase: 3
title: "Backend — per-segment consumption rollup + tokens-by-segment"
status: pending
priority: P1
effort: "1d"
dependencies: [1, 2]
---

# Phase 3: Consumption rollup + tokens-by-segment

## Overview
Read endpoints powering Concept E (consumption view) and D's token table: a per-segment
consumption summary + per-key rollup + daily series + recent pull log, and the list of tokens
scoped to a segment with usage counts.

## Requirements
- Functional: `GET /api/segments/:id/consumption?window=7d` and `GET /api/segments/:id/tokens`.
- Non-functional: read-only over `public_pull_audit` + `api_keys`; paginated pull log.

## Architecture
New store module aggregating audit rows **by key_id** (NOT "app" — `api_keys` has a label, not an app identity; red-team #11), joined to `api_keys` for the label. **Admin-only** gate, mirroring pull-credentials *exactly* (`guardSegment(…,'read')` then `principal.role !== 'admin'` → 403; red-team #2) — token/key metadata is admin-governance material.

## Related Code Files
- Create: `server/src/services/segment-consumption-store.ts` (summary, byKey[], dailyByKey[], statusBreakdown, freshnessAtPull, recentPulls page)
- Create: `server/src/routes/segment-consumption-routes.ts` (two handlers, admin-only)
- Read: `server/src/routes/segments.ts:1484-1492` (pull-credentials admin gate to copy), `auth/public-pull-audit.ts`, `auth/api-key-store.ts`, `auth/api-key-scope.ts` (segment∈scope; NULL=all)

## Implementation Steps
1. `summarize(segmentId, window)`: pulls (rolled up to one-per-pull, not per-page), **distinct consuming keys**, membersServedLast, successRate, p95 latency, avg freshness@pull (`started_at − snapshot_ts`). **Only count rows with `audit_schema='v2'`** for rate/p95/freshness so pre-enrichment rows aren't miscounted as failures (red-team #14); window start = `max(started_at where audit_schema='v2')`-aware.
2. `byKey(segmentId, window)`: group by `key_id` → label (display may dedupe identical labels with an explicit "grouped by label" caveat, since a rotated key = new key_id; red-team #11). pulls, lastPullAt, rowsLast, sparkline, status.
3. `dailyByKey`: date × key_id pull counts (stacked series).
4. `statusBreakdown`: 200 / 409 `no_snapshot` / 429 `rate_limited` (NOT 401 — failed-auth lives in logs now, not the table).
5. `recentPulls(segmentId, {cursor,limit})`: per-page rows newest-first (key/label, status, format, page index, rows, snapshot_ts, latency).
6. **Consumer count is audit-derived (red-team #10):** the headline "N consumers" = distinct keys that have *actually pulled this segment* (from audit). `tokensForSegment` separately lists keys *entitled* by scope (`segment_ids_json` contains id OR NULL=all, **AND `api_keys.workspace = segment.workspace`**, AND game scope) annotated `appliesVia: 'segment'|'all-segments'` + `everPulled: bool` — so a wildcard key that never pulled this segment shows as entitled-but-idle, not as a consumer.
7. Wire routes: admin-only gate.

## Success Criteria
- [ ] consumption returns summary+byKey+dailyByKey+statusBreakdown+recentPulls; empty-but-200 when none.
- [ ] Non-admin (incl. segment owner) → 403 on both endpoints.
- [ ] Headline consumer count = keys that actually pulled (audit), not entitled scope; wildcard-but-idle key listed separately.
- [ ] Rate/p95/freshness computed over `audit_schema='v2'` rows only.
- [ ] Unit tests: rollup math, key-rotation caveat (two key_ids same label), wildcard entitled-vs-pulled, NULL-discriminator exclusion.

## Risk Assessment
- p95 in JS over the window's latencies (small N), not SQL percentile.
- Two NULL meanings for snapshot_ts: pre-enrichment (no column) vs legacy-partition (`segment-page-reader.ts:191` genuinely pins null). The `audit_schema` flag separates "uncaptured" from "fresh-but-unmeasurable" — surface the latter as "unknown freshness", not a failure.
