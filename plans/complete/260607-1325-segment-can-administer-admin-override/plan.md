# Segment `can_administer` — admin override for owner-only controls

## Problem

Server authz already lets admins do everything on any segment
(`canAdministerSegment` = `owner === principal.sub || role === 'admin'`,
`server/src/auth/can-access-segment.ts`). But the DTO flag the FE gates
controls on — `is_owner` — is strict owner equality with NO admin override
(`server/src/routes/segments.ts:257`). Result: admins lose the Edit-predicate,
Delete, and Share controls on other users' segments even though the API would
accept the calls.

**Why we can't just widen `is_owner`:** `src/pages/Segments/use-segment-ids.ts:110`
builds the "shared with you" rail from `(visibility === 'shared'|'org') && !is_owner`.
Widening would misfile every org segment as "yours" for admins. `is_owner` must
stay literal ownership; admin capability needs its own flag.

## Solution

Emit a second DTO flag `can_administer` = literal owner OR viewer is admin,
and switch the three owner-only control gates to it. `is_owner` semantics and
all its other consumers stay untouched.

## Phases

| Phase | Scope | Status |
|-------|-------|--------|
| [01](phase-01-server-flag-and-fe-gates.md) | Server DTO flag + FE control gates + tests | done |

## Key files

- `server/src/routes/segments.ts` — `hydrateSegment` (line 195, flag at 257), 7 call sites (323, 414, 424, 594, 644, 941, 967) already pass `req.principal.sub`; `req.principal.role` is available at every one.
- `src/types/segment-api.ts:111` — FE Segment type (`is_owner`); add `can_administer`.
- `src/pages/Segments/detail/detail-view.tsx:208,210,226` — Edit-predicate + Delete gates.
- `src/pages/Segments/detail/components/share-segment-control.tsx:27` — share vs read-only pill gate.
- `src/pages/Segments/use-segment-ids.ts:110` — **DO NOT TOUCH** (keeps literal `is_owner`).

## Dependencies / coordination

- `segments.ts`, `detail-view.tsx`, `share-segment-control.tsx` are surfaces of the
  concurrent segment-revamp session (plan `260607-0025-segment-revamp-…`, share UI in
  its phase-06). Land this AFTER that session's in-flight phase commits, or hand the
  patch to it — rebase risk otherwise.
- No migration, no API shape break (additive field).

## Success criteria

- Admin viewing a foreign segment: `is_owner: false`, `can_administer: true`; Edit/Delete/Share controls enabled; "shared with you" rail unchanged.
- Non-admin non-owner: both flags false; controls hidden/disabled as today.
- Owner: both flags true.
