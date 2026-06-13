---
title: "Live name resolution for the CS Care watchlist"
description: "Fill member names for contacted whales that fall outside the stored top-1000 member-profile snapshot, via one bounded identity-IN Cube query at watchlist build time."
status: done
priority: P2
effort: 0.5d
branch: main
tags: [segments, cs-care, member-profile, cube, backend]
created: 2026-06-13
---

# Live name resolution for the CS Care watchlist

## Problem (verified)

Care-tab watchlist rows show bare uids for many members. Root cause confirmed
against `server/data/segments.db` for segment `b7a6cae9-…`:

- segment has **32,417** members; `member_profiles_json` stores only the
  **top 1,000** by rank measure (LTV) — `MEMBER_PROFILE_LIMIT` in
  `member-profile-runner.ts:22`.
- all 1,000 snapshot rows DO carry `mf_users.ingame_name` (1000/1000 named) — the
  name column works; the gap is **coverage**, not a missing column.
- the watchlist is built from **CS-contacted** members; any contacted whale
  ranked outside the top 1,000 has no snapshot row, so `resolveMemberInfo`
  (`segment-cs-care-assembly.ts:38`) returns nothing → UI falls back to
  `r.name ?? r.uid` (bare uid).

## Fix

After the watchlist is built and capped to ≤50 rows, collect the uids whose name
is still null and resolve them with **one bounded identity-IN Cube query**
(same shape as `ensureManualMemberProfiles`, `member-profile-on-demand.ts`).
≤50 uids is far under Cube's IN-list length limit. Result patched into the
watchlist entries before the payload is cached (6h TTL → no repeat Cube cost).

Degrades to today's behavior on any failure (keep uid). Only resolves names the
game's preset/`/meta` actually expose (games without `ingame_name` stay uid —
unchanged).

## Approach — reuse, don't reinvent

A new thin service `resolve-member-names-live.ts` wraps the existing primitives
already used by the on-demand profile path:
`resolveIdentityField` · `resolveGamePrefixForWorkspace` · `pickPresetForSegment`
· `getMetaMemberSets` · `resolveCubeTokenForGame` · `computeMemberProfiles`
(called with `rankMeasure: null`, `segmentFilters: [identity equals uids]`,
`totalCount: uids.length`). Map the returned rows' `name` column → `Map<uid,name>`.

Wired into `segment-cs-care.ts` (watchlist) and reused by
`segment-cs-tickets.ts` (the 360 page header `member.name`, same gap, single uid).

## Phases

| # | Phase | Status | File ownership |
|---|-------|--------|----------------|
| 1 | `resolve-member-names-live` service + unit tests | ✅ done (7 tests) | `server/src/services/resolve-member-names-live.ts`, `*.test.ts` |
| 2 | Wire into `/cs-care` watchlist + `/cs-tickets` member name; route tests | ✅ done (+1 route test) | `server/src/routes/segment-cs-care.ts`, `segment-cs-tickets.ts`, `*.test.ts` |

## Decisions (open questions resolved)
- **Persistence:** payload-cache only (6h) — do NOT write live-resolved names back
  into `member_profiles_json`; keeps the stored snapshot an honest "top-N by rank".
- **Cap:** `MAX_LIVE_NAME_UIDS = 60` (watchlist ≤50, headroom under Cube's IN-list limit).
- Shipped: server 1433/1433, tsc clean, code-review APPROVE (no blockers). Latent
  follow-up: share the name-column regex + ingame-first ordering with
  `resolveMemberInfo` only if a preset later adds a second name-ish column.

## Phase files
- [phase-01-resolve-member-names-live-service.md](./phase-01-resolve-member-names-live-service.md)
- [phase-02-wire-into-cs-care-and-cs-tickets.md](./phase-02-wire-into-cs-care-and-cs-tickets.md)

## Open Questions
See bottom of phase-02.
</content>
