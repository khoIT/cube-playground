---
phase: 2
title: "Backend — per-page audit capture + failed-auth logging"
status: pending
priority: P1
effort: "1d"
dependencies: [0]
---

# Phase 2: Per-page audit + failure capture

## Overview
Make the pull log per-page and complete: each paginated request writes its own enriched row
(page index, page_id, rows, latency, snapshot version, http status), and failed/denied pulls
(401 bad token, 409 no_snapshot, 429 if a limiter exists) get rows too.

## Requirements
- Functional: one audit row per page request (paged) + one per stream (stream); failures logged with error_code.
- Non-functional: audit write never blocks/aborts the response; cheap synchronous insert (better-sqlite3).

## Architecture
Extend `public-pull-audit.ts` with a per-page recorder, and wire it in `public-export.ts`'s
paged branch + the auth middleware for failures.

## Related Code Files
- Modify: `server/src/auth/public-pull-audit.ts` (add `recordPagePull({keyId,segmentId,pageIndex,pageId,rows,latencyMs,snapshotTs,httpStatus,format,source,errorCode})`; enrich stream finalize w/ latency+snapshot+status; add `prunePullAudit(retentionDays)`; update `listPullAudit` to roll page-rows up to one-per-pull for the global admin view)
- Modify: `server/src/services/segment-page-token.ts` (add `pageIndex` to `PageToken`; page 1 = 0, each `next_page_id` increments)
- Modify: `server/src/services/segment-page-reader.ts` (return `snapshotTs` on `PageResult` so the recorder reads it from the RESULT, not by re-decoding the request token — page 1 has no incoming token, red-team #6)
- Modify: `server/src/routes/public-export.ts` (paged branch: stamp start, `recordPagePull` after building each page incl. 409 `no_snapshot`/400 `bad_fields`; stream branch: enrich finalize; **capture the existing 429** in the `RateLimitRejected` catch — it fires before `openPullAudit` today at `:305`; add `acquireExportSlot` to the paged branch for limiter parity)
- Modify: `server/src/middleware/api-key-auth.ts` (on reject → **`req.log.warn`** with error_code + sanitized prefix; **no DB write**, red-team #3)
- Read: `server/src/services/api-key-rate-limiter.ts` (existing limiter)

## Implementation Steps
1. `recordPagePull` insert (authenticated rows only — always real key_id+segment_id). `latencyMs` from a per-request start stamp. Set `audit_schema='v2'`.
2. **Token carries the index** (red-team #6): extend `PageToken` with `pageIndex` (page 1 incoming-token-absent → index 0; each outgoing `next_page_id` carries `index+1`). `snapshotTs` is read from `PageResult` (page reader returns it), never re-decoded from the request token.
3. Paged branch: after building page → `recordPagePull(httpStatus=200, pageIndex, snapshotTs)`. On 409 `no_snapshot` / 400 `bad_fields` → record with error_code + status. Add `acquireExportSlot` so paged pulls are limited like stream (parity).
4. Stream branch: keep open→finalize; pass `latency_ms`, `snapshot_ts`, `http_status` into finalize (extend signature).
5. **429 capture (red-team #7):** the limiter rejects *before* the current `openPullAudit`. Record a `rate_limited` audit row (or wrap audit-open above the limiter) so throttling is visible in Phase 3 statusBreakdown.
6. **Failed-AUTH → logger only (red-team #3):** invalid/expired/scope-denied keys produce a `req.log.warn` line (error_code + a safe fingerprint, never raw key bytes) — NOT a DB row. Kills the unauthenticated token-spray DB-DoS and the `key_id/segment_id` NOT-NULL violations and the secret-prefix leak in one move.
7. **Don't inflate the global view (red-team, Security #6):** `listPullAudit` + the admin `AuditSection` must group page-rows into one-per-pull (`page_index IS NULL` = stream/whole; non-null = page) so historical pull counts don't jump Nx after deploy.
8. **Retention prune (user kept per-page):** ship `prunePullAudit(retentionDays)` on a schedule in THIS phase (default e.g. 90d) — not deferred.

## Success Criteria
- [ ] A 13-page paged pull writes 13 rows with **page_index 0..12** (from the token) and the **same snapshot_ts** (from the result, incl. page 1), latency populated.
- [ ] A throttled pull writes a `rate_limited` row; a bad token writes **NO row** but emits a `req.log.warn` (assert no audit row, no raw key bytes logged).
- [ ] Stream pulls still produce one terminal row (now enriched); the global admin "Recent pulls" count is **unchanged** for stream pulls and rolls up pages for paged pulls.
- [ ] Prune removes rows older than retention; the shipped pull response bodies/headers are byte-identical (no contract change).

## Risk Assessment
- Audit insert in try/catch — a logging failure must never 500 a pull.
- Paged-path limiter is a new gate on a shipped surface — verify it doesn't reject the documented single-consumer cadence; pick a quota ≥ stream's.
- `client_ip` is `req.ip` with no `trustProxy` (`index.ts:118`) → behind nginx it's the proxy IP. Either configure trustProxy or label the column "edge IP" in UI; don't present it as "consumer IP".
