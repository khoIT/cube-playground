# Phase 02 — Cube-anchored metric fallback + contextual clarify options

## Context links

- Depends on: [phase-01](phase-01-starter-passthrough-memory-write.md) (prior-cube knowledge in memory).
- `src/nl-to-query/member-resolution.ts` — `searchMembers(meta, term, limit)` fuzzy scorer over live /meta; reuse, don't fork.
- `src/tools/disambiguate-query.ts` — handler wiring point (after `fillResultFromMemory`, before the /meta member gate).
- `src/nl-to-query/types.ts` — `Clarification.options`, `MetricResolution`.
- Threshold: `config.chatGlossaryAutorouteThreshold` (existing).

## Overview

Priority P1. When the glossary can't resolve a metric phrase but session
memory knows which cube the conversation is anchored to, search THAT cube's
measures before giving up. Two outcomes:

- strong match → auto-fill the metric slot + assumption disclosure;
- weak matches → keep `clarify` but append the cube's candidates as
  clarification options (the menu becomes contextual instead of canned).

## Key insight — lexical gap

"user count" vs `distinct_players` has ZERO token overlap; plain
`searchMembers` scores it null. The fallback needs a tiny token-equivalence
layer:

```
user|users|nguoi choi|người chơi  ≈  player|players
count|number|so luong|số lượng    ≈  distinct|count
```

plus naive plural stemming (strip trailing `s` when comparing). Keep the map
curated and ≤ ~10 classes — YAGNI; extend only on observed misses.

## Architecture

New module `src/nl-to-query/cube-anchored-metric-fallback.ts` (<200 LOC):

```
resolveAgainstAnchorCube(phrase, anchorCube, meta): {
  best?: { member, label, confidence },
  candidates: Array<{ member, label, confidence }>,   // measures only, top 4
}
```

- Internally: expand phrase tokens through equivalence classes, score against
  the anchor cube's measures (leaf + title tokens, same tiers as
  `scoreMember`), cap to measures of kind `measure`.
- Extend `searchMembers` with an optional `opts?: { cube?: string;
  measuresOnly?: boolean; tokenEquiv?: TokenEquivMap }` rather than
  duplicating its scoring — backward-compatible default args.

## Handler wiring (disambiguate-query.ts)

Trigger conditions (ALL must hold):

1. `!result.slots.metric.value && !result.slots.ratio` after memory fill;
2. anchor cube known: `cubeNameOf(mem.metric.value)` from session memory
   (NOT user prefs — anchoring is a same-conversation concept);
3. message is follow-up-shaped: additive marker detected (phase 03 detector,
   stub as regex here) OR ≤6 words — mirrors `blockTopicFill` so a genuinely
   new long question never gets hijacked onto the old cube.

Outcome handling:

- `best.confidence >= chatGlossaryAutorouteThreshold` → fill
  `slots.metric = { value: best.member, confidence: best.confidence, alias: phrase }`,
  push warning `metric resolved from prior-cube anchor: <member>`, build a
  `ResolutionAssumption { slot:'metric', chosen, phrase, confidence, alternatives }`
  so the skill body renders the "interpreted X as Y" footer. Re-run
  `dropResolvedClarifications` + `upgradeActionIfNoClarsRemain`.
- else if `candidates.length > 0` → leave action='clarify' but REPLACE the
  canned glossary metric clarification's options with the cube candidates
  (labels suffixed `— from <cube short title>, same data as the current
  chart`), bilingual via existing label fields.

Phrase source: prefer the engine's `unresolved` spans joined; fall back to
the full message minus additive-marker tokens.

## Related code files

- Create: `src/nl-to-query/cube-anchored-metric-fallback.ts`
- Modify: `src/nl-to-query/member-resolution.ts` (opts param)
- Modify: `src/tools/disambiguate-query.ts` (wiring)
- Tests: `src/nl-to-query/__tests__/cube-anchored-metric-fallback.test.ts`

## Todo

- [x] Token-equivalence map + plural stemming helper
- [x] `searchMembers` opts (cube filter, measuresOnly, tokenEquiv)
- [x] `resolveAgainstAnchorCube` module
- [x] Handler wiring with the 3 trigger guards
- [x] Assumption disclosure + clarify-options replacement
- [x] Tests: "user count" + anchor etl_game_detail → distinct_players ≥ threshold
- [x] Tests: long new question ("currency outflow reasons last week") → fallback does NOT fire
- [x] Tests: weak match → clarify options contain cube candidates
- [x] Tests: no anchor in memory → behavior identical to today

## Success criteria

`disambiguate({message:'user count per day'})` with session memory metric
`etl_game_detail.matches` returns auto (or at minimum a clarify whose options
include `etl_game_detail.distinct_players`).

## Risk

- **Topic hijack** — guarded by trigger condition 3; covered by negative test.
- **Equivalence overreach** ("users" ≈ "players" wrong for account-level
  cubes) — anchor-scoped only, never applied to global resolution; assumption
  footer keeps it user-overridable ("not that").
- /meta gate downstream still validates the filled member — anchored fills
  can't emit a member Cube rejects.
