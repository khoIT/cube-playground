# Phase 01 — Platform dimension: cube-relative resolution

**Priority:** high (21 of 33 cases). **Status:** not started.
**Scope:** chat-service NL resolver only. No cube-model change.
**Games:** applies to all 8 — verified (2026-06-23) the platform member is named
**identically in every game**: `os_platform` on mf_users/active_daily/recharge,
`platform` on game_key_metrics/new_user_retention. So the `(os_)?platform` family
regex needs no per-game branch; this fix is code-once.

## Problem
"X by platform" never binds a dimension. `pickDimension` (slot-extractor.ts:76)
only accepts glossary hits classified `dimension`; there is no "platform"
glossary term, so the breakdown phrase falls through to meta-fuzzy search, which
guessed the non-existent `mf_users.platform`. Agent reply: *"`mf_users.platform`
isn't available … which dimension did you mean?"*

The member exists, but **its name varies by cube**:
- user / engagement / recharge cubes → `os_platform`
- acquisition cubes (`game_key_metrics`, `new_user_retention`) → `platform`

So a single static alias is wrong. Resolution must pick the platform-family
member **on the cube the metric resolved to**.

## Approach
Add a cube-relative dimension alias step: when the breakdown phrase matches a
known dimension-synonym (`platform` / `device` / `os`) and a metric cube is
known, bind the dimension to that cube's member whose name matches
`/^(os_)?platform$/` (from live /meta — never hardcode a cube name).

Order of resolution for a breakdown phrase becomes:
1. glossary dimension term (unchanged)
2. **NEW: cube-relative synonym** — phrase→member family, scoped to metric's cube
3. meta-fuzzy (unchanged, last resort)

Keep the synonym table tiny and data-driven (one entry: platform→`(os_)?platform`).
This is the same shape as country/channel resolution, just cube-scoped because
the physical name isn't stable.

## Files
- `src/nl-to-query/slot-extractor.ts` — `pickDimension`: accept a cube-relative
  synonym hit before meta-fuzzy; needs the resolved metric's cube in scope.
- `src/nl-to-query/member-resolution.ts` — helper `resolvePlatformMember(cube, meta)`
  returning the `(os_)?platform` member on a given cube (or null).
- `src/nl-to-query/synonym-resolver.ts` — register `platform`/`device`/`os` as a
  cube-relative dimension synonym (distinct from glossary cubeRef aliases).
- (read) `src/core/cube-meta-capability.ts` — `cubeNameOf`, member listing.

## Steps
1. Reproduce: replay the failing turns ("DAU by platform", "Revenue by platform",
   "ROAS by platform") through the resolver; capture where the dimension slot
   currently lands (expect mis-guess / empty).
2. Add `resolvePlatformMember(cube, meta)` in member-resolution.
3. Wire it into `pickDimension`: if no glossary dimension hit but the message
   contains a platform-family synonym AND the metric resolved to a cube, bind
   that cube's platform member.
4. Guard: only fire when the metric's cube actually has the member (UA metrics →
   `game_key_metrics.platform`; engagement → `active_daily.os_platform`). If the
   metric is unresolved, leave the dimension for clarify (don't guess a cube).
5. Add unit tests (resolver-level): each representative phrase → expected member.
   **Run the resolver against ≥2 games' /meta (cfm + jus), not just cfm**, to
   lock in that the cube-relative resolve is game-agnostic (no hardcoded cube).

## Success criteria
- Replaying the 21 "by platform" cases binds a valid `(os_)?platform` member on
  the correct cube; query-composer emits `dimensions:[…]`.
- Live: the 21 cases emit an artifact (re-run subset, `RESUME_KEEP=ok`).
- No regression: existing country/channel breakdowns still resolve (run resolver
  test suite).

## Risks
- Metric→cube must resolve first or step 4 can't scope. If a metric is ambiguous
  across cubes, defer to clarify rather than bind platform on the wrong cube.
- `dau_by_platform_daily` rollup serves DAU×os_platform; confirm other metrics
  fall back to base SQL (cold Trino) without error.

## Todo
- [ ] reproduce & capture current dimension-slot behavior
- [ ] `resolvePlatformMember` helper + test
- [ ] wire into `pickDimension` with cube guard
- [ ] resolver unit tests for the 21 phrases (representative subset)
- [ ] live re-run of the 21 cases → artifacts emitted
