---
phase: 5
title: "Segment sharing backend (owner_label + guards)"
status: pending
priority: P1
effort: "0.5d"
dependencies: []
---

# Phase 5: Segment sharing backend (owner_label + guards)

## Overview
Close the gaps between segments' existing visibility model and chat's sharing UX: stamp
`owner_label`/`shared_at`, add share/unshare convenience endpoints, tighten delete +
visibility-change to owner/admin (user-locked), and expose `is_owner` so the FE can gate
controls. Most of the model already exists — this phase is additive plumbing, not a redesign.

## Requirements
- Functional: share/unshare endpoints (owner/admin only); `owner_label`, `shared_at`,
  `is_owner` in API responses; **owner/admin-only destructive set** (user-locked 260607, rev. 2
  after red-team): DELETE, PATCH `visibility`, PATCH `predicate_tree`, PATCH `uid_list`,
  POST `/:id/append`, DELETE `/:id/activations/:activationId`. All other non-owner writes on
  shared/org segments keep working (rename, cadence, analyses, tags, refresh, export, brief).
- Non-functional: NULL-safe for legacy rows (owner_label NULL → fall back to owner sub);
  zero behavior change for personal segments.

## Architecture
- **Migration `034-segment-sharing-labels.sql`**: `ALTER TABLE segments ADD COLUMN owner_label
  TEXT; ADD COLUMN shared_at DATETIME;` (chat parity: `chat-service/src/db/migrate.ts:56-66`).
- **Owner label stamping**: on POST `/api/segments`, set `owner_label = request.user?.username
  ?? request.user?.email ?? owner` (same resolution as `resolveOwnerLabel`,
  `server/src/routes/chat.ts:126`). No backfill script — legacy rows render owner sub.
- **New guard** `canAdministerSegment(principal, row)` in `can-access-segment.ts`:
  `row.owner === principal.sub || principal.role === 'admin'`. Applied to the destructive set
  (red-team M2 traced these as cohort-redefining, user confirmed owner-only):
  - `DELETE /api/segments/:id`
  - `PATCH` when payload contains `visibility`, `predicate_tree`, or `uid_list`
    (`segments.ts:473,493`) — non-owner predicate rewrite silently replaces the cohort +
    triggers auto-refresh (`segments.ts:505,536`)
  - `POST /api/segments/:id/append` (`segments.ts:573`)
  - `DELETE /api/segments/:id/activations/:activationId` (`segments.ts:835`)
  - new `POST /api/segments/:id/share` / `/unshare`
  `canMutateSegment` (remaining writes: rename, cadence, tags, analyses) **unchanged**.
  Keep existing rule: `org` visibility set requires admin (`segments.ts:132-144`).
- **Share endpoints** (chat parity, `chat.ts:422-438`): share → `visibility='shared'`,
  `shared_at=now`; unshare → `visibility='personal'`, `shared_at=NULL`. Return updated row.
- **Serialization** (`segments.ts:216-221` block): add `owner_label`, `shared_at`, and computed
  `is_owner` (`row.owner === req.principal.sub`) to both list and detail responses.

## Related Code Files
- Create: `server/src/db/migrations/034-segment-sharing-labels.sql`
- Modify: `server/src/auth/can-access-segment.ts` (+ its tests)
- Modify: `server/src/routes/segments.ts` (stamp, guards, share/unshare, serialization)
- Modify: `server/src/types/segment.ts`, `src/types/segment-api.ts`,
  `src/api/segments-client.ts` (share/unshare methods)

## Implementation Steps
1. Migration 034; type updates both tiers.
2. `canAdministerSegment` + unit tests (owner, admin, non-owner shared, non-owner org).
3. Stamp owner_label on create; serialize new fields + `is_owner`.
4. Share/unshare routes (owner/admin via new guard; 404-on-cross-workspace preserved).
5. Tighten the destructive set; **regression tests**: non-owner can still PATCH name/cadence,
   create analyses, refresh, and export on a shared segment; non-owner PATCH predicate_tree /
   append / activation-delete → 403; owner + admin paths unaffected.
6. FE client methods `share(id)`, `unshare(id)`.

## Success Criteria
- [ ] Non-owner DELETE on shared segment → 403; owner/admin → 204
- [ ] Non-owner PATCH visibility/predicate_tree/uid_list → 403; PATCH name on same segment → 200
- [ ] Non-owner append + activation-delete → 403
- [ ] share/unshare toggle visibility + shared_at; unshare by non-owner → 403
- [ ] List/detail responses carry owner_label/shared_at/is_owner; legacy rows degrade to sub
- [ ] Full existing segments route test suite green

## Risk Assessment
- **Hidden delete callers** (e.g. bulk ops, admin tools) hitting new 403: grep all
  `segmentsClient.delete` / route callers during implementation; admin bypass covers ops tooling.
- **`org` semantics**: org rows render same as shared in nav (Phase 6) — owner-only admin rule
  identical; no new ladder rung invented (YAGNI).
