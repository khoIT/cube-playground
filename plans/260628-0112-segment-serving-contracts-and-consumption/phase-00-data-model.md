---
phase: 0
title: "Data model — lifecycle flag + per-page audit enrichment"
status: pending
priority: P1
effort: "0.5d"
dependencies: []
---

# Phase 0: Data model

## Overview
Add the explicit served-lifecycle flag to `segments`, and enrich `public_pull_audit` for
per-page events + failed-auth capture. Two migrations; everything downstream builds on these.

## Requirements
- Functional: a segment can be `draft` (default) or `served`; audit can store per-page rows incl. failures.
- Non-functional: idempotent migrations, backward-compatible defaults (existing rows = draft).

## Architecture
SQLite, `server/src/db/migrations/`, applied on boot via count-based `user_version` (`sqlite.ts:63-73`). Next free = 076. **Runner invariant (red-team #4):** `user_version = files.length`; dir has permanent gaps (044/045/047/070) — never back-fill. Each new file MUST be transaction-safe; a half-applied multi-ALTER file wedges boot (`exec` per file, single `user_version` write after the loop, no rollback — red-team #5).

## Related Code Files
- Create: `server/src/db/migrations/076-segment-serving-lifecycle.sql`
- Create: `server/src/db/migrations/077-pull-audit-per-page.sql`
- Modify: `server/src/db/sqlite.ts` (wrap each migration file's `exec` in a transaction so a mid-file failure rolls back instead of half-applying; keeps `user_version` honest)
- Read: `server/src/db/migrations/074-public-api-keys.sql` (current audit DDL), `065-segment-track-cadence.sql`, `048-segment-snapshot-log.sql` (count-invariant comment)

## Implementation Steps
1. **Runner hardening first** (`sqlite.ts`): wrap each pending file's `db.exec` in `BEGIN…COMMIT` (rollback on throw); add a boot comment documenting the count invariant + manual recovery (`PRAGMA user_version`). This makes 076/077 safe to add.
2. **076** — `ALTER TABLE segments ADD COLUMN lifecycle TEXT NOT NULL DEFAULT 'draft' CHECK (lifecycle IN ('draft','served','deprecated'))`; `ADD COLUMN served_at TEXT`; `ADD COLUMN served_by TEXT`. Index `idx_segments_lifecycle`. (`deprecated` is retained and **read** by the pull-path gate in Phase 1 + shown distinctly in Phase 4 — it is not write-only.)
3. **077** — enrich `public_pull_audit` for **authenticated** per-page pulls only (these rows always have a real `key_id` + `segment_id`, so no NOT-NULL dodging):
   - `ADD COLUMN page_index INTEGER` (null for stream; 0..N for paged — sourced from the page token, see Phase 2 token change).
   - `ADD COLUMN page_id TEXT` (opaque token echoed for the request).
   - `ADD COLUMN latency_ms INTEGER`.
   - `ADD COLUMN snapshot_ts TEXT` (pinned snapshot the page served from).
   - `ADD COLUMN http_status INTEGER`.
   - `ADD COLUMN error_code TEXT` (authenticated failures only: `no_snapshot`, `rate_limited`, `bad_fields`).
   - `ADD COLUMN audit_schema TEXT` (discriminator, e.g. `'v2'`) so Phase 3 can exclude pre-enrichment rows from rate/p95/freshness (red-team #14).
   - Add index `idx_public_pull_audit_segment_started (segment_id, started_at)`.
   - **Do NOT add `key_prefix` / a `key_id=''` sentinel** — failed-AUTH (401/403, no resolved key) goes to the structured logger, never this table (red-team #3). Keep `key_id`/`segment_id` NOT NULL intact.
4. Comment each migration with the *why* (no plan refs in SQL per house rule).

## Success Criteria
- [ ] Fresh boot applies 076/077 inside transactions; `user_version` advances; existing segments read `lifecycle='draft'`.
- [ ] A regression test boots a DB at the prior `user_version` and asserts ONLY 076/077 run; an injected failing statement rolls back and re-runs cleanly (no `duplicate column` wedge).
- [ ] `public_pull_audit` accepts an authenticated per-page row; failed-auth produces a log line, not a row.

## Risk Assessment
- SQLite `ADD COLUMN` has no `IF NOT EXISTS` → idempotency comes from the transaction + the count runner, not the statement. The runner-hardening step (1) is a prerequisite, not optional.
- `(segment_id, started_at)` index supports the consumption rollup; verify the Phase 3 query plan uses it.
- Keeping `key_id`/`segment_id` NOT NULL is deliberate — it forces failed-auth out of this table (kills the DoS/leak vectors in red-team #3).
