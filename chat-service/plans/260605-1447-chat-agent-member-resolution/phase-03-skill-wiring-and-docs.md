# Phase 03 — Explore skill wiring + lessons-learned

**Priority:** high · **Status:** planned · **Depends on:** phase 01, phase 02

## Overview

Tools exist but are inert until the explore skill is told to prefer them over
grepping `/meta`. This phase rewrites the skill's query-building guidance and
records the bug shape in lessons-learned.

## Key insights

- The stalled turn fetched full `/meta` and eyeballed it ("file is all on one
  line so I can't Grep"). The skill must steer the agent to resolve first.
- `get_cube_meta(full)` stays as the escape hatch, not the default.

## Requirements

- Update the explore SKILL.md query-building section:
  1. Before building OR augmenting a Cube query, call `resolve_query_terms`
     with the salient terms from the user's question (metric, entity, filter
     columns, time field).
  2. Use `list_dimension_values` to get exact filter-value casing before adding
     an equals/contains filter.
  3. Only fall back to `get_cube_meta` (full) when resolution returns no
     confident match — never as the first step.
  4. Trust the disambiguator's auto-routed query; only resolve the *extra*
     members you add on top of it.
- Add a `docs/lessons-learned.md` entry: "Agent thrashes resolving members by
  grepping /meta → 120s timeout. Signal: long reasoning with member-name and
  filter-value guesses, 0/0 tokens, NULL→timeout stop_reason. Apply: route
  resolution through resolve_query_terms / list_dimension_values."

## Related code files

- Modify: the explore skill `SKILL.md` (chat-service copy — confirm exact path
  during implementation; mirror prior Charts-rules edit location).
- Modify: `docs/lessons-learned.md` (repo root).

## Implementation steps

1. Locate the explore SKILL.md the chat-service ships (the same file the
   Charts rules were added to previously).
2. Rewrite the query-building guidance per requirements; keep it tight.
3. Add the lessons-learned entry.
4. Manual smoke: re-run the whale prompt mentally against the new instructions —
   confirm the resolve-first path replaces the meta-grep loop.

## Success criteria

- Skill instructs resolve-first; `get_cube_meta` demoted to fallback.
- Lessons-learned entry present.
- (Optional, if a local stack is up) re-running the whale prompt resolves
  members via the new tools and finishes well under the 120s budget.

## Risks

- Skill guidance ignored by the model. Mitigate: make the instruction
  imperative and place it at the top of the query-building section; the tool
  descriptions themselves also nudge ("call this BEFORE building a query").

## Next steps

- Watch leaderboard `stop_reason='timeout'` rate for the explore skill (now
  visible via the phase-3-of-the-diagnosis observability fix) to confirm the
  timeout class drops after rollout.
