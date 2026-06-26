---
phase: 1
title: "Keyset pagination reader"
status: pending
priority: P1
effort: "1d"
dependencies: []
---

# Phase 1: Keyset pagination reader

## Overview
Pure module that powers `page_id` pagination over a segment's full cohort. Two sources: `daily` (Iceberg `segment_membership_daily` partition) and `manual` (`uid_list_json`). Encodes/decodes the opaque token, pins the snapshot at page-1 for point-in-time stability, walks a uid keyset, and signals typed errors (no-snapshot, bad-token). No HTTP, no auth — testable in isolation.

## Requirements
- Functional: `readPage({ segment, limit, pageId? }, deps) → { uids: string[], total_count, next_page_id | null, has_more }`. Deterministic uid ordering; stable point-in-time within a token; manual + predicate segments both supported.
- Non-functional: pure module (deps injected: a `query` fn + a clock); reuse the existing keyset SQL loop rather than re-deriving; < 200 LOC (split token codec into its own file); zero Fastify coupling; safe SQL literals via `toSqlLiteral`.

## Architecture
- **Token (opaque to caller):** base64url(JSON) `{ v:1, source:'daily'|'manual', segmentId, snapshotDate?, snapshotTs?, lastUid }`.
  - Decode validates shape → else `InvalidPageTokenError` (→400 at route).
  - Reader/route MUST reject a token whose `segmentId` ≠ the request path `:id` (prevents re-pointing the cursor at another segment; the path is already scope-checked). No HMAC needed for this reason.
- **Source resolution (page-1, no token):**
  - `segment.type === 'manual'` → `source='manual'`; cohort = `JSON.parse(uid_list_json)` sorted ascending.
  - else `source='daily'`: pin `(snapshot_date, snapshot_ts)` = the latest available for this segment:
    `SELECT max(snapshot_date) …` then `SELECT max(snapshot_ts) … WHERE segment_id=? AND snapshot_date=?`.
    - **No partition row found → throw `NoSnapshotError`** (route → 409). Do NOT return empty, do NOT live-compile.
- **Keyset query (predicate/daily), uid-ordered, NULL-ts-tolerant:**
  ```sql
  SELECT uid FROM segment_membership_daily
  WHERE segment_id = {lit} AND snapshot_date = {lit}
    AND ({pinnedTs IS NULL ? 'snapshot_ts IS NULL' : 'snapshot_ts = ' + tsLit})
    AND uid > {lastUidLit}
  ORDER BY uid ASC LIMIT {limit}
  ```
  Mirror the NULL-tolerant predicate at `segment-overlap-counts.ts:69`. Prefer reusing `streamExportPages`' page-builder over hand-rolling — pass an `innerSql` that targets the pinned partition and let its existing `uid > cursor ORDER BY uid LIMIT` loop produce one page.
- **Keyset (manual):** in-memory slice of the sorted uid list: first uid `> lastUid`, take `limit`. (Cohort is bounded — uid_list segments are small by construction.)
- **Pagination mechanics:** `lastUid` = '' for page 1; `next_page_id` re-encodes with `lastUid` = last row's uid; `has_more = rows.length === limit`; final page → `next_page_id = null`.
- **total_count:** looked up server-side once at page-1 — `segment.uid_count` if trustworthy, else `COUNT(*)` over the pinned partition (daily) / `length` (manual). Echo on every page; carried in token only as a hint, never trusted as the source of truth.
- **limit:** clamp `[1, 10_000]`, default `1000`.
- **410 (refined-gone)**: N/A — no refined source in scope. The only "gone" case is daily no-partition at page-1 → 409 (NoSnapshotError). Mid-pull partition deletion is not a concern (no cleanup job deletes daily partitions; immutable).

## Related Code Files
- Create: `server/src/services/segment-page-reader.ts` (reader; injected `query` + `now`; resolves source, pins, pages)
- Create: `server/src/services/segment-page-token.ts` (encode/decode + validation; < 80 LOC)
- Reuse (do not clone): `server/src/services/segment-export-stream.ts` (`streamExportPages` keyset loop, `toSqlLiteral`, connector/schema resolution)
- Read for NULL-ts pattern: `server/src/lakehouse/segment-overlap-counts.ts:69`
- Read for table consts: `server/src/lakehouse/lakehouse-trino-connector.ts`
- Create (tests): `server/test/segment-page-token.test.ts`, `server/test/segment-page-reader.test.ts`

## Implementation Steps
1. `segment-page-token.ts`: `encode(state)`, `decode(str)` (throws `InvalidPageTokenError`); version field.
2. `segment-page-reader.ts`: `readPage({segment, limit, pageId?}, {query, now})`. Branch on `segment.type`.
3. Daily: page-1 pin `(snapshot_date, snapshot_ts)`; throw `NoSnapshotError` if absent; build the NULL-tolerant keyset query (reuse `streamExportPages` page-builder where practical); `toSqlLiteral` every value.
4. Manual: parse + sort `uid_list_json`; keyset slice.
5. `total_count` lookup (server-side); enforce `segmentId === segment.id` when a `pageId` is supplied (throw `InvalidPageTokenError` on mismatch).
6. Tests (mocked `query`): daily page-1 pins MAX(snapshot_ts) + returns first `limit` asc + next_page_id; walking next_page_id yields disjoint ordered slices; final page has_more=false; **NULL snapshot_ts partition pages successfully (no false error)**; **no partition → NoSnapshotError**; manual segment pages from uid_list; bad token → InvalidPageTokenError; `pageId.segmentId` mismatch → InvalidPageTokenError; total_count constant across pages and not read from token.

## Success Criteria
- [ ] Daily page-1 (no token) pins latest snapshot, returns ≤limit uids asc + next_page_id; walking paginates to completion (has_more=false, next_page_id=null on last).
- [ ] NULL `snapshot_ts` partition pages correctly (regression against false-error).
- [ ] No partition for a predicate segment → `NoSnapshotError` (not empty).
- [ ] Manual segment pages from `uid_list_json`, uid-ordered, to completion.
- [ ] `total_count` identical across pages, sourced server-side; bad/mismatched token → `InvalidPageTokenError`.
- [ ] No Fastify import; reuses `streamExportPages` (no parallel keyset implementation); tester + code-reviewer gate pass.

## Risk Assessment
- **Per-page Trino latency** — keyset avoids deep OFFSET (good) but `segment_membership_daily` only partition-prunes on `(snapshot_date,game_id,segment_id)`, not uid; each page leans on Parquet sort + min/max stats. Mitigation: a quick spike measuring page-1 and a deep page on a real large `cfm_vn` segment before fixing the default page size; consider fetching larger internal batches (align with the stream's 50k) while still returning 1000 to the consumer. Document expected latency honestly — not "cheap."
- **uid lexicographic ordering** must match Iceberg `sorted_by uid`. Mitigation: rely on Trino default VARCHAR `>`; test asserts strictly-increasing uids across pages.
- **Manual segment edited mid-pull** changes `uid_list_json`; pages may skip/dup at the boundary. Mitigation: acceptable for small manual lists; note in docs that manual pulls are consistent only if the segment isn't edited mid-pull.
