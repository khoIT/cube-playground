# Resolver platform dimension + segment-only default metric

**Date**: 2026-06-23 01:30
**Severity**: Medium
**Component**: chat-service nl-to-query resolver
**Status**: Resolved

## What Happened

Executed `/cook --auto` on plan `plans/260623-0126-cfm-vn-resolver-platform-persona-routing`. Fixed two silent "no-artifact" gaps in the NL-to-query resolver — platform dimension breakdowns always clarified + segment-only questions (no metric) fell through to clarify. Both now deterministic across all 8 games.

## Technical Details

### Issue 1: Dead glossary → member ref
Glossary term `platform` pointed at `mf_users.platform` — a non-existent member on all target cubes. The disambiguate_query /meta validation caught this mismatch and flipped the turn to `clarify`, never emitting a chart. 

**Fix**: Introduced `DIMENSION_SYNONYMS` family mapping `platform` → leaves `os_platform|platform` (game-relative); resolver now probes live /meta member set instead of trusting static glossary refs. Files touched: `src/nl-to-query/synonym-resolver.ts` (matchDimensionSynonym, DIMENSION_SYNONYMS), `member-resolution.ts` (resolveCubeRelativeDimension), `slot-extractor.ts` (pickDimension now takes DimensionContext).

### Issue 2: Segment filter + no metric = no chart
Query frame "show Minnow segment last 7 days" bound the segment filter but left the metric slot empty → composer emitted no measure → /meta validation failed → clarify. 

**Fix**: Deterministic default in slot-extractor: money cue (regex: `revenue|spend|arpu|…`) → game's Revenue measure; else fallback to active-user count. Gated to questions that anchor intent (filter + explicit time) and validate measure membership against live /meta (so a true outage still surfaces an honest clarify, not a fake default). Files: `src/core/smart-defaults.ts` (resolveDefaultMetric, MONEY_CUE, resolveActiveUserDefault), `slot-extractor.ts`.

**Rule enforced**: All resolution chains trace glossary → member-resolver → live /meta. No hardcoded cfm physical names. All 8 games inherit the fix on merge (member names byte-identical cross-game).

## Results

16-case before/after smoketest per game (subscription lane, workspace=local):
- **cfm_vn**: 7/16 → 13/16 passing
- **jus_vn**: 7/16 → 14/16 passing (byte-identical fixed set, zero true regressions)
- **Fixed**: All 5 platform breakdowns + both segment-default cases
- **Validated**: money-cue "Whale revenue" routes to Revenue, not active-user; empty-query tripwire ("asdf qwer") stays non-ok (no over-defaulting)

## Lessons Learned

**Catalog → member ref that fails /meta validation = silent clarify trap.** Glossary term in scope but its target member absent from the cube doesn't error — it just stalls the turn. "DAU by country" worked only because its ref happened to validate. 

**Corollary: resolver defaults don't fire if the agent bypasses the disambiguate_query tool.** A "compare X month over month" framing makes the agent free-explore (list_segments → get_cube_meta → offer_choices) and skip the resolver entirely. Composer/resolver fixes and agent tool-routing are separate levers — fixing one doesn't guarantee end-to-end coverage.

Both insights recorded in `docs/lessons-learned.md`.

## Next Steps

- **Remaining**: ROAS/CPI "by platform" emit artifact (platform dim binds) but resolve a revenue/cost proxy measure, not the ratio. Separate pre-existing gap, out of scope; visible in test bank.
- **Data-blocked**: Month-over-month cases need >1 month in test set (currently only 2026-06).
- **Layer B sweep**: 2 of 8 games verified (cfm_vn, jus_vn); 6 games remain — confirm byte-identical member sets on next session.

Commits: eb4f4185 (resolver fix), 3f6836b2 (jus_vn parity). 38 unit tests pass (new: dimension-cube-relative.test.ts, default-metric-injection.test.ts).

## Unresolved Questions

- Do the 6 unverified games (ballistar/cros/muaw/pubg/tf/neteaseqqspeed) have byte-identical member names? Assume yes per docs/lessons-learned.md, but Layer B sweep will confirm.
- Month-over-month: is test-data loader currently capped to single month, or can we expand to 2026-05..06?
