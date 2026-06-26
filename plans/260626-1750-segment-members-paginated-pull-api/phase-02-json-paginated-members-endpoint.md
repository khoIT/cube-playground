---
phase: 2
title: "JSON paginated members endpoint"
status: pending
priority: P1
effort: "0.5d"
dependencies: [1]
---

# Phase 2: JSON paginated members endpoint

## Overview
Expose the Phase-1 reader over HTTP: add a JSON `page_id` mode to the existing public members endpoint, **additive** to the current NDJSON/CSV stream. Enforce API-key scope (404 on out-of-scope), map reader errors to correct HTTP codes, and lock the tokenless route so it can never serve the full cohort.

## Requirements
- Functional: `GET /api/public/v1/segments/:id/members?format=json[&limit=N][&page_id=...]` → `{ segment_id, total_count, returned_count, members:[uid...], page_id|null, has_more }`. Existing `format=ndjson|csv` paths byte-unchanged.
- Non-functional: same `requireApiKey` + `loadScopedSegment` as the stream; plain JSON (no `reply.hijack()`); correct error codes; tokenless route regression-locked.

## Architecture
- Branch inside the existing `:id/members` handler on `format`:
  - `format=json` → resolve scoped segment → `readPage(segment, {limit, pageId})` (Phase 1) → reply JSON. Default `limit=1000`.
  - `format=ndjson|csv` (default `ndjson`) → existing streaming path, untouched.
- **Auth/scope:** reuse `requireApiKey` preHandler + `loadScopedSegment(scope, id)` (`public-export.ts:288-299`). Out-of-scope/unknown → `loadScopedSegment` returns null → **404** (no existence leak). Never 403.
- **Error mapping:**
  - `InvalidPageTokenError` → `400 { error:'invalid_page_id' }`
  - `NoSnapshotError` → `409 { error:'no_snapshot', hint:'refresh the segment, then retry' }`
  - null scoped segment → `404` (existing behavior)
- **Members shape:** uid-only. `fields` enrichment is OUT of scope for JSON page mode (the stream covers enriched export). **Guard:** if json mode ever gains `fields`, it MUST route through the same `parseFields`/`AVAILABLE_FIELDS` allowlist + redaction posture as the stream — encode as a comment + a guard test now so the parallel path can't silently leak enriched columns.
- **Tokenless-route lock (security):** the full-cohort reader is wired here on `/api/public/v1` ONLY. Add/keep a regression test asserting the tokenless `/api/segments/:id/members` (`segments.ts:878`) still caps at the top-1000 redacted snapshot and never returns `page_id` or the full cohort.
- Extract the JSON branch into a small helper if the handler nears 200 LOC.

## Related Code Files
- Modify: `server/src/routes/public-export.ts` (add `format=json` branch + `page_id` to the `:id/members` handler; extend route `schema.querystring`: add `'json'` to `format`, add `page_id`)
- Use: `server/src/services/segment-page-reader.ts`, `segment-page-token.ts` (Phase 1)
- Read (lock target): `server/src/routes/segments.ts:878`
- Create (test): `server/test/public-members-json-pagination.test.ts`
- Extend (test): `server/test/public-export-routes.test.ts` (tokenless-cap regression)

## Implementation Steps
1. Extend querystring schema: `format` enum gains `'json'`; add optional `page_id`. Keep `cursor` for the stream path distinct from `page_id`.
2. Handler: after `requireApiKey` + `loadScopedSegment` (→404 if null), branch on `format==='json'` → `readPage` → JSON reply (no hijack). Else existing stream.
3. try/catch around `readPage` → map `InvalidPageTokenError`→400, `NoSnapshotError`→409.
4. Verify `SEGMENT_SNAPSHOT_ENABLED=true` on the target instance (runtime prerequisite); note in deploy checklist.
5. Tests (`app.inject()` + `:memory:` DB, mocked reader/lakehouse): page-1 returns ≤limit members + page_id; following page_id returns next slice to completion; predicate segment with no partition → 409; manual segment → members from uid_list; bad page_id → 400; missing key → 401; out-of-scope segment → **404** (not 403); `ndjson`/`csv` unchanged (regression); **tokenless route still capped at top-1000, no page_id** (regression).

## Success Criteria
- [ ] `format=json` returns `{members, page_id, has_more, total_count}`; walking `page_id` paginates to completion.
- [ ] `format=ndjson` / `csv` behavior identical to pre-change (regression test).
- [ ] 400 bad page_id · 409 no-snapshot (predicate) · 404 out-of-scope · 401 no key.
- [ ] Manual segment served via JSON page mode.
- [ ] Tokenless `/api/segments/:id/members` regression test proves it stays top-1000 redacted, never full-cohort.
- [ ] tester + code-reviewer gate pass; verified live on API :3004 with a real key (page-1→page-2 + a 409 + a 404).

## Risk Assessment
- **`cursor` vs `page_id` conflation** — keep distinct so existing stream consumers don't break. Mitigation: regression test on the stream path.
- **Default format must stay `ndjson`** — existing integrations untouched.
- **`SEGMENT_SNAPSHOT_ENABLED` off on target** → every predicate pull 409s. Mitigation: prerequisite check (step 4); surface clearly rather than silently empty.
