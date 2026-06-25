# Phase 06 — Admin key mgmt + rate-limit + audit + tests

## Context
- Depends on Phase 01 (store) + Phase 03 (endpoint).
- Admission/concurrency precedent: `server/src/routes/cube-load-admission.ts`
  (per-owner in-flight caps). Admin hub UI: `src/pages/Admin/hub/`.

## Overview
- Priority: P1 (operability + safety). Make keys manageable, bound warehouse load,
  and record every pull.

## Requirements
- Admin API (app-JWT, admin role) under `/api/admin/api-keys`: list / create
  (returns plaintext ONCE) / revoke. Reuse admin-access route patterns.
- Admin UI tab in the hub: table (label, prefix, scope, last_used, created_by,
  status) + create modal (one-time key reveal) + revoke.
- Rate-limit / concurrency per key on the export endpoint: max N concurrent
  streams/key (default 1–2) and a daily row/pull quota; 429 with `Retry-After`
  when exceeded. Mirror cube-load-admission's in-memory counter.
- Audit: append to a `public_pull_audit` log (key_id, segment_id, started_at,
  finished_at, rows_streamed, source path, status, client ip). Surfaced read-only
  in the admin tab.

## Architecture
- Migration 074 already has `api_keys`; add `public_pull_audit` there or a small
  follow-up migration (075) — prefer folding into 074 if not yet shipped.
- `server/src/auth/api-key-admin-routes.ts` (admin CRUD) + `api-key-rate-limiter.ts`
  (in-memory concurrency + quota; reset daily in GMT+7 to match ops conventions).
- Export route wraps the stream in `acquire(keyId)` / `release` + increments the
  audit row count as pages flush; finalize on close/end.
- FE: `src/pages/Admin/hub/api-keys-tab.tsx` (mirror an existing hub tab's design
  tokens + table style).

## Related code files
- Create: `auth/api-key-admin-routes.ts`, `services/api-key-rate-limiter.ts`,
  `src/pages/Admin/hub/api-keys-tab.tsx`, `src/api/api-keys-client.ts`.
- Edit: `routes/public-export.ts` (limiter + audit), `index.ts` (register admin
  routes), Admin hub tab registry, migration 074 (audit table).
- Read: `cube-load-admission.ts`, `admin-access.ts`, an existing hub tab.

## Implementation steps
1. Audit table (in 074 or 075) + write helpers.
2. Rate limiter (per-key concurrency + daily quota, GMT+7 reset).
3. Admin CRUD routes + client.
4. Admin hub tab (list/create-reveal/revoke + audit view).
5. Wire limiter + audit into the export route.
6. Tests: concurrency cap → 429; quota exhaustion → 429; audit row written with
   final count; admin CRUD authz (non-admin 403).

## Todo
- [ ] audit table + writers
- [ ] per-key rate limiter (concurrency + daily quota)
- [ ] admin CRUD routes + client
- [ ] admin hub api-keys tab
- [ ] wire limiter + audit into export
- [ ] tests (429 paths, audit, admin authz)

## Success criteria
- One key can't exceed its concurrency/quota (429 + Retry-After); every pull is
  audited with final row count + source; admins mint/revoke keys in the hub.

## Risks
- In-memory limiter resets on restart / doesn't span replicas — acceptable for the
  single-`server`-replica prod (same constraint as the snapshot job); note it.
- Audit write on a crashed stream → finalize in the `close` handler, mark `aborted`.

## Security
- Admin-only key management; plaintext shown once; audit gives traceability for a
  PII-bearing surface (uids). Quota/concurrency protect Trino from abuse.
