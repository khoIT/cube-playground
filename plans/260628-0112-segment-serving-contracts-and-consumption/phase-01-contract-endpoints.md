---
phase: 1
title: "Backend — serving-contract compute + publish/demote endpoints"
status: pending
priority: P1
effort: "1d"
dependencies: [0]
---

# Phase 1: Serving contract + publish/demote

## Overview
Turn the `lifecycle` flag into a real contract: a publish/demote action, and a computed
`serving` block (cadence, last snapshot, next-ready, consumer count) on the segment detail.

## Requirements
- Functional: `POST /api/segments/:id/serve` publishes (draft→served); `DELETE …/serve` demotes (guarded if active consumers); detail response carries a `serving` object.
- Non-functional: publish refuses when snapshot can't run (no point serving un-snapshottable data).

## Architecture
Fastify routes in `server/src/routes/segments.ts`. Contract compute in a new pure module so
"next ready" is unit-testable. Consumer count = active `api_keys` scoped to the segment.

## Related Code Files
- Create: `server/src/services/segment-serving-contract.ts` (computeContract + computeNextReadyAt)
- Modify: `server/src/routes/segments.ts` (publish/demote handlers w/ `guardSegment`; add `serving` to GET /:id + list)
- Modify: `server/src/routes/public-export.ts` (`loadScopedSegment` gains a `lifecycle='served'` gate — demote enforcement)
- Read: `server/src/auth/can-access-segment.ts` (`canAdministerSegment` = owner-or-admin), `segments.ts:1228` (share/unshare uses `'administer'` — copy that gate), `services/snapshot-cadence.ts`, `jobs/snapshot-segment-membership.ts` (window [08:00,24:00) GMT+7; daily bucket 00:00), `auth/api-key-store.ts` (scoped keys)

## Implementation Steps
1. `segment-serving-contract.ts`:
   - `computeNextReadyAt(cadence, lastSnapshotAt, now)` → next cadence bucket start in GMT+7, **then clamp into the [08:00,24:00) window**: if the bucket falls in [00:00,08:00) clamp forward to that day's 08:00 (red-team #9). Honor `SEGMENT_SNAPSHOT_IGNORE_WINDOW=true` (dev → no clamp). Null `lastSnapshotAt` → next window open.
   - `computeContract(segment, snapshotLog, keys)` → `{ lifecycle, servedAt, servedBy, cadence, lastSnapshotAt, nextReadyAt, snapshotEnabled, consumerCount, consumers[] }`. **consumerCount is audit-derived in Phase 3, not from key scope** — here just surface scoped keys as `entitled`.
2. **Authz (red-team #1):** both handlers call `guardSegment(req, reply, id, 'administer')` (owner-or-admin) and bail on null — mirror `segments.ts:1228`. Test: non-owner/non-admin → 403.
3. Publish handler: require `SEGMENT_SNAPSHOT_ENABLED` else 409 `snapshot_disabled`; if `track_cadence === 'Off'` **auto-set `daily`** as part of publish (single rule — no contradictory 409-then-default); set `lifecycle='served', served_at=now, served_by=user`.
4. Demote handler (**transactional**, red-team #8): in one SQLite txn, re-read active scoped consumers → if any and no `force`, 409 `has_consumers` + consumer list; else set `lifecycle='deprecated'` (force) / `'draft'` (clean). 
5. **Enforce at pull path (red-team #8):** add `lifecycle = 'served'` check to `public-export.ts` `loadScopedSegment` → non-served returns 403 `segment_not_served`. This is what makes demote a real kill-switch, not advisory.
6. Extend `GET /api/segments/:id` + list rows with `lifecycle` + `serving` (one query, no N+1).

## Success Criteria
- [ ] Non-owner/non-admin publish/demote → 403.
- [ ] Publish requires snapshot enabled; `Off` cadence auto-promotes to daily (no dead branch).
- [ ] Demote is atomic; blocked w/ consumers unless `force`; after demote the public pull path returns 403 (enforced).
- [ ] next-ready unit tests: daily 00:00 bucket clamps to 08:00; sub-daily buckets in [00:00,08:00) clamp; null lastSnapshot; IGNORE_WINDOW dev path.

## Risk Assessment
- Asia/Saigon is fixed +7 (no DST) — still test the 24:00→08:00 clamp explicitly; it's the bug the contract exists to avoid (advertised "ready" 8h early).
- Enforcing lifecycle at the pull path changes a shipped surface — must NOT break already-served segments (default existing served segments correctly; draft/never-published segments were never pullable via a scoped key anyway — verify scope vs lifecycle interaction).
