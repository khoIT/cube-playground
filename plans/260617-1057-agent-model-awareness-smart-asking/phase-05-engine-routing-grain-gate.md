# Phase 05 — Route resolution through the deterministic engine + grain gate

## Overview
Priority: P3 (deepest). Status: ☐. Move the strongest correctness rules from
prompt guidance into code. Where feasible, the agent resolves metric/entity/time
through `disambiguate_query` (memory + rephrase gate + grain) rather than
free-form `offer_choices`, so behavior is testable, not guidance-dependent.

## Key insights
- Guidance fixes (grain, entity-first, recovery chips) work but rely on model
  compliance. The user wants software-level enforcement.
- `disambiguate_query` already owns memory + rephrase gate; `clarification-builder`
  already orders entity-first for leaderboards. The gap is the agent choosing the
  free-form path and the grain rule living only in the prompt.

## Requirements
- Functional: (a) grain gate in code — when entity grain = individual, exclude
  `refKind==='ratio'` metrics from leaderboard metric options; keep them for group
  entities. (b) Steer the agent to call `disambiguate_query` for metric/entity/time
  resolution; reserve `offer_choices` for genuinely non-engine choices.
- Non-functional: behind `agentEngineRouting`; guidance remains as backstop.

## Architecture
- Grain gate in `clarification-builder.ts` `metricOptions`: when the resolved/known
  entity is an individual (entity cube PK at user grain), drop `refKind==='ratio'`
  candidates and the ratio ids from `TERM_PRIORITY_LEADERBOARD`. When entity is a
  group, keep them. Entity grain comes from the concept's `entityCube`/`entityPk`
  or the inferred grain (P03).
- `refKind` is on glossary terms (`'measure'|'ratio'|'expression'`); ratio = population
  average → not individually rankable. This makes the ARPU/ARPDAU exclusion deterministic.
- Tool-routing guidance + tool descriptions: `disambiguate_query` is the resolver of
  record for metric/dimension/timeRange; `offer_choices` is for non-schema choices and
  recovery alternatives only.

## Related code files
- Read: `chat-service/src/nl-to-query/clarification-builder.ts`, `metric-resolver.ts`,
  `slot-extractor.ts`, `chat-service/src/tools/disambiguate-query.ts`, `offer-choices.ts`.
- Modify: `clarification-builder.ts` (grain-gated metricOptions), tool descriptions,
  `mode-prompts.ts` routing guidance.

## Implementation steps
1. Thread known entity-grain into `metricOptions`; exclude ratios for individuals; test both grains.
2. Clean `TERM_PRIORITY_LEADERBOARD` (ratios only valid for group leaderboards).
3. Tighten tool descriptions: engine = resolver of record; offer_choices = non-schema/recovery.
4. Regression: "top countries by ARPU" still offers ARPU; "top players by ARPU" never does.
5. Confirm guidance backstop still present (the grain paragraph from earlier work).

## Todo
- [x] Grain-gated `metricOptions` + tests (individual vs group) — `clarification-builder.ts`
- [x] Ratios excluded for individual grain (filter handles the priority list — no separate prune needed)
- [x] Tool-routing guidance (engine = resolver of record) behind `agentEngineRouting`
- [x] Regression: country-ARPU kept, player-ARPU dropped (`clarification-builder-grain-gate.test.ts`)
- [x] Full nl-to-query suite green (existing metric-options tests unaffected — they carry no `refKind`)

## Done (2026-06-17)
Grain gate in `clarification-builder.ts`: `gateIndividualRatios` (threaded from
`nl-to-query/index.ts` = `config.agentEngineRouting`) + `isIndividualEntity` (user-grain pk
or mf_users/user_roles cube) → drops `refKind==='ratio'` candidates ONLY when the entity is
known-individual; groups + unknown grain keep ratios (no false exclusion). Guidance backstop:
the existing offer_choices grain paragraph stays. Open question RESOLVED: the entity pk +
cube name is a clean "individual" predicate (`USER_GRAIN_PK` regex); no per-game allowlist needed.

## Success criteria
- ARPU/ARPDAU never offered for individual rankings (proven by unit test, not just guidance);
  valid for group rankings; engine is the resolver of record for schema slots.

## Risks
- Entity grain unknown at metric-clarify time → only gate when grain is known; else fall back to
  current ordering + guidance (no false exclusion of valid group rankings).
- Over-routing to engine breaks genuinely open choices → keep offer_choices for non-schema sets.

## Open questions
- Is there a clean "entity is individual" predicate from `entityCube`/`entityPk`, or do we need a per-game user-cube allowlist? Scout in implementation.
