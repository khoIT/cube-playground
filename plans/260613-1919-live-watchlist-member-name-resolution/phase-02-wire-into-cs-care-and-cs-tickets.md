# Phase 02 — Wire live name resolution into the routes

## Context links
- Watchlist source: `server/src/routes/segment-cs-care.ts` (`buildWatchlist`, line ~126)
- Per-member header name: `server/src/routes/segment-cs-tickets.ts` (`member.name` via `resolveMemberInfo`)
- Service: phase-01 `resolve-member-names-live.ts`

## Overview
- **Priority:** P2 · **Status:** pending · blockedBy: phase-01
- Patch missing names into the ≤50 watchlist entries and the single 360-header
  member, after the snapshot lookup, before the payload is cached.

## Key insights
- Both routes already cache their payload 6h. Resolving names INSIDE the existing
  `try` block (before `cache.set`) means the resolved names are cached with the
  payload — one Cube query per segment per 6h, no per-request cost.
- Resolve only AFTER `slice(0, WATCHLIST_LIMIT)` so the Cube query covers ≤50
  uids (only the displayed rows), not every contacted member.
- The 360 route resolves a single uid — call the same helper with `[uid]`.

## Requirements
1. `/cs-care`: after `const watchlist = buildWatchlist(...).slice(0, 50)`:
   - `const missing = watchlist.filter(w => !w.name).map(w => w.uid)`
   - if `missing.length`: `const names = await resolveMemberNamesLive(row, missing)`
     then `watchlist.forEach(w => { if (!w.name && names.has(w.uid)) w.name = names.get(w.uid)! })`
   - leave everything else untouched; names absent from the map stay uid.
2. `/cs-tickets`: if the resolved `member.name` is null, call
   `resolveMemberNamesLive(row, [uid])` and use the result when present.
3. Both: the call is already inside a `try` that 502s on CS read failure — but
   name resolution must NEVER fail the payload. The helper is fail-soft (returns
   empty map), so no extra guard is needed; do NOT wrap in a way that could turn a
   name miss into a 502.

## Related code files
- **Modify:** `server/src/routes/segment-cs-care.ts` (import + ~4 lines after slice)
- **Modify:** `server/src/routes/segment-cs-tickets.ts` (import + fallback when name null)
- **Modify:** `server/test/segment-cs-care-route.test.ts`, `server/test/segment-cs-tickets-route.test.ts`
  (mock `resolveMemberNamesLive`)

## Implementation steps
1. Import `resolveMemberNamesLive` in both routes.
2. `/cs-care`: insert the missing-name patch after the slice; pass the `row`
   (already in scope from `guardSegment`) — confirm `row` carries
   `{id,type,cube,game_id,workspace}` (it does for the guard; verify `cube`/`workspace`).
3. `/cs-tickets`: after `resolveMemberInfo`, if `member.name == null`, await the
   helper with `[uid]` and overwrite when present.
4. Tests: mock the service to return a `Map` for specific uids; assert the
   watchlist entry / member.name is filled; assert a service throw still yields a
   200 payload with uid fallback (fail-soft).

## Todo
- [ ] `/cs-care` watchlist patch (post-slice, pre-cache)
- [ ] `/cs-tickets` single-uid name fallback
- [ ] Route tests: name filled on hit; uid kept on miss; 200 preserved on service throw
- [ ] Manual verify against segment `b7a6cae9-…`: an out-of-top-1000 contacted
      whale now shows a name (was uid)

## Success criteria
- Watchlist row for a contacted member outside the top-1000 snapshot shows its
  in-game name.
- A game without an `ingame_name` column is unchanged (still uid).
- Cube/Trino down → watchlist still renders with uid fallback (no 502 from names).

## Security considerations
- No new auth surface — both routes keep `guardSegment(req,reply,id,'read')`.
- Same identity-IN query the on-demand profile path already runs; no new data
  exposure (names already shown for in-snapshot members).

## Open Questions
1. Should the resolved names also be **persisted** back into
   `member_profiles_json` (append out-of-snapshot rows), or stay request-scoped
   in the 6h payload cache only? Persisting helps the tokenless members-pull API
   too, but mixing live-resolved rows into the ranked snapshot muddies its
   "top-N by rank" contract. Recommendation: payload-cache only (simpler, honest
   snapshot). Confirm.
2. Cap value: `MAX_LIVE_NAME_UIDS = 60` assumed (watchlist is 50). OK, or align
   exactly to `WATCHLIST_LIMIT`?
</content>
