# Phase 01 — Resolver engine + `resolve_query_terms` tool

**Priority:** high · **Status:** planned

## Overview

The elegant core: one pure resolver that maps each natural-language term to
ranked physical Cube members by layering the existing glossary resolver over a
new live-meta fuzzy search, then classifying with the existing member-meta
helper. Wrap it as a single agent tool.

## Key insights

- Glossary covers business *metrics/concepts*; live meta covers *structural*
  members (dimensions, time dimensions, raw measures). Both are needed — the
  stalled turn failed precisely on structural members the glossary doesn't hold.
- `resolveMemberMeta` already classifies a known ref → `{label, dataType, kind}`.
  The missing piece is term → candidate refs, i.e. `searchMembers`.
- Operating on live meta (not hardcoded cube names) keeps this portable across
  prefix and game_id workspaces.

## Requirements

- `searchMembers(meta, term)` — pure. Normalised (lowercase, strip punctuation,
  collapse whitespace) token-overlap + substring match over each member's
  `name`, `title`, `shortTitle`. Returns candidate refs with a match score.
- `resolveQueryTerms(terms, glossary, meta)` — for each term: glossary
  exact/alias (high confidence) ∪ `searchMembers` results; classify each via
  `resolveMemberMeta`; dedupe by member; rank by confidence; return top-K
  (default 3) as `{member, cube, kind, dataType, label, confidence, matchedOn}`.
  `matchedOn ∈ {glossary-exact, glossary-alias, meta-name, meta-title}`.
- Tool `resolve_query_terms({terms: string[]})` — loads glossary via
  `fetchOfficialGlossary()` and meta via `getMeta(ctx.gameId, ctx.workspace)`,
  calls the engine, returns `{ results: PerTerm[] }`. Empty matches → return the
  term with `matches: []` (never throw; the agent can fall back).

## Related code files

- Create: `src/nl-to-query/member-resolution.ts` (engine + `searchMembers`).
- Create: `src/tools/resolve-query-terms.ts` (tool wrapper).
- Modify: `src/core/cube-meta-capability.ts` — only if `searchMembers` fits more
  naturally beside `resolveMemberMeta`; otherwise keep it in member-resolution.ts
  and import `resolveMemberMeta`. (Prefer the new file to keep capability.ts small.)
- Modify: `src/tools/registry.ts` — register the tool.
- Create tests: `test/nl-to-query/member-resolution.test.ts`,
  `test/tools/resolve-query-terms.test.ts`.

## Implementation steps

1. Write `searchMembers` + `resolveQueryTerms` in `member-resolution.ts`,
   importing `resolveTerms`/`findExactMatch` and `resolveMemberMeta`.
2. Unit-test the engine with a synthetic glossary + synthetic meta (mirror the
   `cube-meta-capability.test.ts` META fixture): assert `user id`→`mf_users.user_id`,
   `revenue`→glossary metric, `recharge date`→`recharge.recharge_date` (time),
   unknown term → `matches: []`, ranking order, top-K cap.
3. Write the tool wrapper; register in `registry.ts`.
4. Tool test with mocked glossary-client + cube-meta-cache.

## Success criteria

- Engine resolves the four whale-turn terms (`user id`, `days since last active`,
  `revenue`, `recharge date`) to correct physical members in one call.
- `npx tsc --noEmit` clean; new tests pass; existing tests unaffected.

## Risks

- Over-matching (a term hits many members). Mitigate: confidence ranking +
  top-K, and return scores so the agent can judge. Don't auto-pick silently.
