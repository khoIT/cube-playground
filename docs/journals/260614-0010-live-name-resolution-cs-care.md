# Live Name Resolution: CS Care Watchlist

**Date**: 2026-06-14 10:15
**Severity**: Medium
**Component**: Care ticketing UI, segment membership resolve
**Status**: Resolved

## What Shipped

Two commits landed on refresh + watchlist flow:
1. **76e89ef (tooltip fix)**: Replaced native `title` on VIP-tier hint with instant React-state InfoTip. Native title forced OS delay (~1s) + `?` cursor, read as broken.
2. **b528664 (live name resolution)**: New `server/src/services/resolve-member-names-live.ts` wired into `/cs-care` watchlist + `/cs-tickets` header. Resolves names for displayed uids in-flight.

## The Brutal Truth

Contacted whales below rank 1000 had **no name** in the watchlist, only a bare uid. Looks like the integration shipped half-baked because I didn't trace the membership payload shape.

## Technical Root Cause

Segment refresh writes **two separate artifacts**: 
- `uid_list_json`: FULL membership, identity-dimension-only (adding a name dimension fans out per-user rows, corrupts the distinct-count contract used for pagination).
- `member_profiles_json`: Enriched with name + LTV, capped at MEMBER_PROFILE_LIMIT (1000).

Whales below rank 1000 appear in `uid_list_json` but NOT in the ranked snapshot → no name available at query time. Joining name at refresh time is a non-starter: the membership query is deliberately identity-only for correctness.

## Fix Shape

Resolve names for **only the ≤50 displayed uids** via one bounded identity-IN Cube query (reuse `computeMemberProfiles`), fail-soft, payload-cache only (don't pollute the ranked snapshot). Mirrors `member-profile-on-demand.ts` pattern.

**Decisions:**
- Payload-cache-only (caller-scoped, no shared promise).
- Cap at 60 uids per request.
- No in-flight dedup (per-caller uid sets differ).

## Verification

Server 1433/1433 tests pass. `tsc` clean. Code review: APPROVE, no blockers. Latent follow-up: unify name-column regex + ingame-first ordering if a preset adds a second name-ish column.

**Status:** RESOLVED — watchlist now shows names for all displayed members.
