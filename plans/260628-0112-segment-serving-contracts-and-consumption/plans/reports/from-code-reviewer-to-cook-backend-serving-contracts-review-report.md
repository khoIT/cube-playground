# Code Review — Segment Serving Contracts & Consumption Observability (Phases 0-3, backend)

Reviewer: code-reviewer | Date: 2026-06-28 (GMT+7) | Scope: backend only, no code modified.

## Scope
Files reviewed (new + modified):
- Migrations: `076-segment-serving-lifecycle.sql`, `077-pull-audit-per-page.sql`
- `src/db/sqlite.ts` (migration runner)
- `src/services/segment-serving-contract.ts`, `segment-serving-store.ts`, `segment-consumption-store.ts`, `segment-page-reader.ts`, `segment-page-token.ts`
- `src/routes/segments.ts` (serve/demote + serving block), `segment-consumption-routes.ts`, `public-export.ts`
- `src/auth/public-pull-audit.ts`, `src/middleware/api-key-auth.ts`
- `src/jobs/prune-pull-audit.ts`, `src/index.ts`
- tests: `public-export-routes.test.ts`, `public-members-json-pagination.test.ts`, `segment-serving-contract.test.ts`

Verification: `tsc --noEmit` CLEAN. Targeted vitest (3 files, 27 tests) PASS.

## Overall Assessment
Solid, well-reasoned implementation. The pull-path lifecycle gate, audit best-effort wrapping, failed-auth never-writes-DB, TZ handling for freshness, migration safety, and the page-rollup GROUP BY are all correct. Two real gaps worth addressing before ship: a metadata leak of non-served segments on the public LIST endpoint (contract says metadata is gated), and a byKey-vs-summary "pulls" semantic mismatch. Everything else is Low/informational.

---

## Critical
None.

## High

### H1 — Public LIST endpoint exposes non-served segment metadata (contract violation)
`public-export.ts` `GET /api/public/v1/segments` (lines 104-165) does NOT filter by `lifecycle`, and its SELECT (lines 148-153) doesn't even read the `lifecycle` column. So a draft/deprecated segment that is in the API key's scope appears in the public list with its `id`, `name`, `size` (uid_count), `status`, `type` — even though `GET /:id` and `/:id/members` correctly return 403 `SEGMENT_NOT_SERVED` for it (`ensureServed`, lines 530-536).

The stated contract (review focus #1) is "only 'served' pullable; metadata + members both gated." The detail + members paths honor that; the list path does not. A consumer enumerating the list discovers cohort names + sizes for segments the owner has not published (or has demoted via kill-switch). For `deprecated` (force-demoted) segments this is the more pointed case: the kill-switch blocks the pull but the segment name + size still leak via list.

Fix: add `lifecycle = 'served'` to the list `clauses[]` (and add `lifecycle` to the SELECT if you also want to surface it). One line. Mirrors `loadScopedSegment`'s served gate so the surface is internally consistent.

Severity High not Critical: it leaks metadata (name + size) only, not cohort uids; surface is API-key-authenticated + VPN-only. Still a contract break and a kill-switch bypass for metadata.

## Medium

### M1 — `byKey.pulls` (per-page) vs `summary.pulls` (logical) semantic mismatch
`segment-consumption-store.ts` `getConsumption`: `summary.pulls` (lines 104-113) counts LOGICAL pulls via `PULL_GROUP` (paged rows of one snapshot-walk collapse to one). But `byKey[].pulls` (lines 127-143) increments once per audit ROW (`for (const r of rows) existing.pulls += 1`), i.e. per-page. For a paginated consumer, `sum(byKey.pulls)` will be N× larger than `summary.pulls`. If the admin UI renders both (summary headline + per-key table), the numbers won't reconcile and an operator may read it as a discrepancy/bug.

Recommend: either collapse byKey to logical pulls too (group by the same PULL_GROUP per key), or rename the byKey field to `pageRequests` / document it as per-page so the mismatch is intentional and labelled. The global `listPullAudit` already collapses correctly; byKey is the odd one out.

## Low

### L1 — Plan reference in code comment
`segment-page-reader.ts:53` — comment "Phase 2 supplies one backed by the lakehouse connector". Violates the no-plan-refs-in-code rule (phase numbers get renumbered → stale). Reword to describe the dependency without the phase label (e.g. "the route supplies one backed by the lakehouse connector; tests inject a mock").

### L2 — Files over 200 LOC
New files exceeding the 200-LOC guideline: `segment-consumption-store.ts` (244), `segment-page-reader.ts` (245). Both are cohesive single-concern modules (consumption rollup; paged reader with two sources) so splitting may not improve clarity — flagging per the rule. (`public-export.ts` 540 and `segments.ts` 1790 pre-existed large; serve/demote additions are reasonable in-place.)

### L3 — Demote transaction cross-process atomicity is bounded, not absolute
`segments.ts` DELETE `/serve` (lines 1324-1342): the consumer re-check + lifecycle flip run inside `db.transaction()`. `entitledKeysForSegment` → `listKeys()` → `getDb()` reads on the SAME better-sqlite3 singleton connection inside the transaction, so within this process the check+write are atomic (synchronous, single connection) — the TOCTOU the comment claims to close IS closed for the single-process case. A second OS process granting an api_key between the deferred-txn's first read and first write is a theoretical cross-process race, but api_key management is admin-UI-only on the one app process, so this is not exploitable in the current deployment. No action needed; documented for completeness.

### L4 — Aborted/in-flight stream rows transiently depress successRate
`public-pull-audit.ts` `finalizePullAudit` defaults `http_status` to null on non-complete terminal status; an opened-but-not-finalized stream row also has http_status NULL. `getConsumption.successRate = ok.length / rows.length` (ok = http_status===200) counts those NULL rows in the denominator only, so a still-streaming or aborted pull transiently/permanently drags successRate down. This is arguably correct (an abort IS not a success) — flagging only so the semantics are an explicit choice, not an accident.

---

## Verified-correct (focus items confirmed good)
- **#1 pull-path gate (detail + members):** `ensureServed` gates both `GET /:id` and `/:id/members`; 403 `SEGMENT_NOT_SERVED` is distinct from 404 (fail-closed `loadScopedSegment` for out-of-scope). Non-served detail/members cannot leak. (Caveat: LIST — see H1.)
- **#2 authz:** serve/demote → `guardSegment 'administer'` (owner-or-admin). consumption/pulls/tokens → `requireAdminSegment` = `guardSegment('read')` then `role==='admin'` 403 — mirrors `pull-credentials` exactly. No handler missing a gate; codes correct.
- **#3 demote atomicity:** atomic within process (see L3).
- **#4 audit integrity:** every `recordPagePull`/`finalizePullAudit` call site is try/caught so a logging failure never 500s a pull (public-export.ts lines 320-337, 426-436; finalize in close handler). Failed-AUTH in `api-key-auth.ts` logs only (no DB write) — no NOT-NULL violation, no token-spray write-DoS. `keyFingerprint` is sha256[:12], never raw key bytes.
- **#5 listPullAudit page-rollup:** GROUP BY collapses stream rows by `'s:'||id` (1:1) and paged rows by `(key, segment, snapshot_ts)`; representative = MAX(id) (final page status), rows SUMmed, page_count counted. No Nx inflation of the global admin count. consumption-store `PULL_GROUP` correctly drops segment_id (query already filters by it).
- **#6 consumption math:** all rate/latency/freshness restricted to `audit_schema='v2'`. `consumingKeys` = distinct key_id among http_status=200 rows (audit-derived) — a wildcard key that never pulled has no rows → not counted. `tokensForSegment` separates entitled `everPulled` from idle. Freshness TZ: snapshot_ts is a GMT+7 wall-clock string (verified `floorToCadenceBucket` builds it with +7 offset); `snapshotIso` appends `+07:00`; `started_at` is UTC `Z` — subtraction is real-time-correct; negatives filtered.
- **#7 paginated contract unchanged:** audit wiring (`recordPagePull`) is side-effect-only inside the page handler; response body/headers (`X-Total-Count`/`X-Next-Page-Id`/`X-Has-More`/`X-Returned-Count`, JSON shape) untouched. Existing pagination tests pass with only the lifecycle='served' seed added.
- **#8 migration safety:** 076/077 are the highest-numbered files (no gap-shift / re-run risk). Per-file transaction in `sqlite.ts` advances user_version inside the file's txn — a mid-file failure (076 has 3 ALTER + 1 CREATE INDEX) rolls back cleanly. CHECK on lifecycle vocabulary; DEFAULT 'draft' so nothing becomes pullable at deploy. 077 keeps key_id/segment_id NOT NULL intact (authenticated-only rows).
- **#9 lint/types:** tsc clean. No plan refs except L1.

## Plan status (recommendation only — not modifying plan)
Phases 0-3 backend appear complete and internally consistent. Recommend addressing H1 (one-line lifecycle filter on the public list) and deciding M1 (collapse-or-rename byKey.pulls) before ship; L1 reword is trivial.

## Unresolved Questions
1. **H1 intent:** Is exposing non-served segment metadata on `GET /api/public/v1/segments` intentional (so a consumer sees "coming soon" contracts) or an oversight? The detail/members gate implies served-only; confirm desired list behavior.
2. **M1:** Should `byKey.pulls` be logical pulls (reconciling with summary) or labelled per-page page-requests? Depends on the admin UI's intended reading.
