# Phase 01 — `resolve-member-names-live` service

## Context links
- Reuse target: `server/src/services/member-profile-on-demand.ts` (identity-IN pattern)
- Compute primitive: `server/src/services/member-profile-runner.ts` `computeMemberProfiles`
- Snapshot type: `server/src/types/segment.ts` `MemberProfiles` / `MemberProfileColumn`

## Overview
- **Priority:** P2 · **Status:** pending
- A thin, Trino/Cube-backed helper that, given a segment row + a small set of
  uids, returns `Map<uid, name>`. Bounded, cached, fail-soft. Powers both the
  watchlist and the per-member 360 header.

## Key insights
- `computeMemberProfiles` already does the exact query (identity dim + member
  columns, identity-IN filter, physicalized members, unknown-column drop). Call
  it with `rankMeasure: null` and `segmentFilters: [{ member: identityDim,
  operator: 'equals', values: uids }]`; read the `name` column out of the result.
- The name column is whichever preset `memberColumn` maps to a name field
  (`mf_users.ingame_name` for jus). Identify it the SAME way
  `resolveMemberInfo` does: a column whose `key`/`field` matches
  `/ingame.?name|player.?name|display.?name|name/i`. If the preset exposes no
  name column, return an empty map (caller keeps uid — unchanged behavior).
- Bound the input: cap at `MAX_LIVE_NAME_UIDS = 60` (≥ watchlist's 50). Over the
  cap → resolve the first N, log the drop (no silent truncation).

## Requirements
- `resolveMemberNamesLive(row, uids): Promise<Map<string,string>>`
  - `row`: `{ id, type, cube, game_id, workspace }` (subset already on the segment row).
  - returns names only for uids found with a non-empty name; missing → absent
    from the map (caller falls back to uid).
- Fail-soft: any throw / null compute → empty map (never rejects).
- Per-segment failure cooldown (60s) + in-flight dedupe, mirroring
  `member-profile-on-demand.ts` so an unreachable Cube isn't hammered. Keyed by
  `${row.id}` is sufficient (the watchlist resolves one uid-set per segment).

## Related code files
- **Create:** `server/src/services/resolve-member-names-live.ts`
- **Create:** `server/test/resolve-member-names-live.test.ts`
- **Read for context:** `member-profile-on-demand.ts`, `member-profile-runner.ts`,
  `segment-cs-care-assembly.ts` (the name-matching regex to keep DRY).

## Implementation steps
1. Resolve `identityDim` (`resolveIdentityField(cube, game_id, {workspaceId})`);
   null → return empty map.
2. `prefix = resolveGamePrefixForWorkspace(workspace, game_id)`;
   `preset = pickPresetForSegment(logicalCube(cube, prefix), null)`;
   `metaSets = await getMetaMemberSets(game_id)`;
   `token = resolveCubeTokenForGame(game_id)`.
3. If preset exposes no name-ish memberColumn → return empty map (skip the query).
4. `computeMemberProfiles({ identityDim, rankMeasure: null, memberColumns:
   preset.memberColumns, metaSets, segmentFilters: [identity equals uids.slice(0,
   MAX)], totalCount: uids.length, tokenOverride: token, prefix })`.
5. Map result rows → `Map<uid, name>` using the name column key; drop null/empty.
6. Wrap all of the above in cooldown + in-flight dedupe + try/catch → empty map.

## Todo
- [ ] Service implemented with cooldown + dedupe + fail-soft
- [ ] `MAX_LIVE_NAME_UIDS` cap with a `console.warn` on truncation
- [ ] Name-column detection shares the regex with `resolveMemberInfo` (extract to
      a shared const if cleaner — DRY)
- [ ] Unit tests (mock `computeMemberProfiles`): happy path maps names; no name
      column → empty; compute null → empty; cap truncates + warns; cooldown blocks
      a second call after failure

## Success criteria
- Given a row + 3 uids where Cube returns 2 names, returns a 2-entry map.
- Throw inside compute → resolves to empty map (no rejection).
- Second call within 60s of a failure short-circuits to empty map (no Cube call).

## Risks
- **IN-list length:** mitigated by the 60-uid cap (watchlist is ≤50).
- **Predicate segments lacking `row.cube`:** verify `cube` is populated for
  predicate segments; if some are null, `resolveIdentityField` returns null →
  empty map (safe). Confirm in phase-02 against a real predicate row.
</content>
