# Phase 07 — nl-to-query Decomposition

## Context Links

- SDK review §3.#6 — extract nl-to-query into composable steps
- `chat-service/src/nl-to-query/` — 1076 LOC across clarification-builder, slot-extractor, synonym-resolver, date-resolver, number-normaliser
- `chat-service/src/tools/disambiguate-query.ts` — monolithic tool wrapping all five steps
- Phase 02 (focus store) — pairs naturally: decomposed tools write to focus

## Overview

- **Priority:** P3 — REDUCED in scope after phase 02a landed
- **Status:** **Done (reduced scope)** — `parse_date_range` tool registered flag-gated; +7 unit tests. SKILL.md `allowed_tools` merge mechanism deferred (boot-guard requires the tool to be in the registry; flag-off skipping `allowed_tools` keeps that contract clean).
- **Flag:** `CHAT_NLQ_DECOMPOSED_TOOLS`
- **Description:** Originally proposed `get_glossary`, `parse_date_range`, `resolve_synonym` as decomposed tools. **Phase 02a now owns concept + glossary resolution** (`list_concepts`, `get_concept`, exact-match short-circuit, leaderboard path). This phase reduces to **just `parse_date_range`** — the one decomposed tool 02a doesn't subsume — so the model can backtrack on date-parsing failures specifically.

## Scope reduction note

Originally three tools; now one. The other two (`get_glossary`, `resolve_synonym`) are implemented inside phase 02a's resolver work, where they have access to the new concept tier and exact-match logic. Duplicating them here would create two glossary-lookup paths. Don't.

## Key Insights

- Monolithic tools hide failure causes: when slot-extractor fails on a date, the model retries the whole call without learning what specifically broke.
- Exposing intermediate steps trades surface for debuggability; per skill review §3.#6 the trade is worth it because diagnose + explore both benefit.
- Phase 02 (focus store) gives the model a place to *remember* successful intermediate resolutions across turns ("last week" → resolved date range carries forward).

## Requirements

**Functional**

New tools (in-process MCP)
- `get_glossary({ query?: string, category?: string }) → Array<{ id, aliases, cube_ref, category, trust }>`
- `parse_date_range({ text: string, granularity?: 'day'|'week'|'month'|'quarter'|'year', referenceDate?: string }) → { dateRange: [string,string], granularity, phrase }`
- `resolve_synonym({ phrase: string, kind: 'metric'|'dimension'|'segment' }) → Array<{ id, score, source }>` (optional; nice-to-have if Spike shows value)

Behaviour
- `disambiguate_query` keeps its public surface; internally refactored to call the same three helpers (so logic isn't duplicated).
- When flag on → new tools registered + added to SKILL.md allowed_tools for explore + diagnose.
- When flag off → only `disambiguate_query` available (today's behaviour).
- Successful resolutions from new tools persist to Phase 02 focus store (the user-facing "I remember 'last week' resolved to …" loop).

**Non-functional**
- No regression in disambig success rate (existing eval set must stay green).
- Adds ≤2 extra tool calls per turn on average (instructed via skill body — use composer for happy path, decomposed for backtracking).

## Architecture

```
Today
  disambiguate_query
    └─ slot-extractor → synonym-resolver → date-resolver → number-normaliser
         (monolithic; one failure aborts the chain)

After
  get_glossary, parse_date_range, resolve_synonym       (model-callable)
       ↑
  disambiguate_query (composer; same chain internally;
                      delegates to the helpers above)

Model usage pattern (instructed via skill body)
  - Happy path: call disambiguate_query (one shot).
  - On failure: read the error → call the specific decomposed tool → retry disambiguate_query with the resolved slot pinned.
  - Successful slot resolutions → focus store (Phase 02).
```

## Related Code Files

**Modify**
- `chat-service/src/tools/registry.ts` (register new tools)
- `chat-service/src/tools/disambiguate-query.ts` (delegate to helpers)
- `chat-service/src/nl-to-query/index.ts` (extract reusable helpers)
- `chat-service/.claude/skills/explore/SKILL.md` (add to allowed_tools when flag on)
- `chat-service/.claude/skills/diagnose/SKILL.md` (same)
- `chat-service/src/config.ts` (flag)

**Create**
- `chat-service/src/tools/get-glossary.ts`
- `chat-service/src/tools/parse-date-range.ts`
- `chat-service/src/tools/resolve-synonym.ts` (if Spike confirms value)
- `chat-service/src/tools/__tests__/get-glossary.test.ts`
- `chat-service/src/tools/__tests__/parse-date-range.test.ts`
- `chat-service/src/__tests__/disambig-backtrack-roundtrip.test.ts`

## Implementation Steps

1. **Spike**: instrument current disambig failures for 1 week (which step fails most? slot-extractor? date-resolver?). Confirms which decomposed tool will actually get used.
2. Extract helpers from `nl-to-query/`:
   - `glossaryLookup({ query, category }) → entries`
   - `parseDateRangeImpl({ text, granularity, referenceDate }) → range`
   - `resolveSynonymImpl({ phrase, kind }) → matches`
   Move these into `nl-to-query/*-impl.ts`; keep them pure functions.
3. Refactor `disambiguate-query.ts` to call the new helpers internally — behaviour unchanged.
4. Wrap each helper as an MCP tool in `tools/`:
   - Input/output Zod schemas.
   - Tool body just calls the impl + serialises.
5. Register conditionally in `registry.ts` based on `CHAT_NLQ_DECOMPOSED_TOOLS`.
6. Update explore + diagnose SKILL.md:
   - Add new tools to `allowed_tools[]` (only when flag on — gate via boot-guard merging).
   - Add skill-body guidance: "On disambiguate_query failure, call the specific helper tool, then retry."
7. Wire successful resolutions → focus store (Phase 02).
8. Tests:
   - Unit per impl + per tool.
   - `disambig-backtrack-roundtrip.test.ts` — simulate disambig failure on date; mock model retries `parse_date_range`, then succeeds.
9. Eval: regression set must stay green; add new test cases that exercise backtracking.

## Todo List

- [ ] Failure-mode spike — deferred (operational; needs prod instrumentation)
- [x] parse-date-range tool + tests (Zod schema over existing `resolveDateRanges`; +7 unit tests)
- [x] Conditional registry entry (`CHAT_NLQ_DECOMPOSED_TOOLS` flag)
- [~] Skill body + allowed_tools update — **reverted** because boot-guard rejects skills that reference unregistered tools. Future work: skill-merge layer that injects flag-gated tools into `allowed_tools[]` at boot when their flag is on.
- [ ] get-glossary tool — **subsumed by phase 02a**; not needed
- [ ] resolve-synonym tool — **subsumed by phase 02a**; not needed
- [ ] Focus-store write hook — already covered by `turn.ts` snapshot of `disambig_resolution.timeRange` into focus
- [ ] Backtrack round-trip test — model-loop behaviour; deferred to eval harness (phase 09)
- [ ] Regression eval green — chat-service 703/703 across full suite

## Success Criteria

- Disambig success rate ≥ today's baseline (no regression).
- Backtrack scenarios (date parse fail, glossary miss) succeed where they previously failed entirely.
- Average tool calls per turn ≤ today + 2.
- Decomposed tools show up in observability with their own latency / success metrics.

## Risk Assessment

- **R1 Tool-surface bloat** — model picks wrong tool, slows down. Mitigation: skill body explicit "use composer first" instruction; observe tool-call patterns; if model misuses, demote tools to internal-only.
- **R2 Duplicate code paths** — composer and tools call the same impls; if impls drift, both break. Mitigation: pure-function impls, single source of truth, unit test the impls.
- **R3 Flag complexity** — gating tools per skill per flag invites bugs. Test matrix: flag off, flag on + skill opt-in, flag on + skill opt-out.

## Security Considerations

- New tools read the same glossary/cube metadata as today; no new data surface.
- Input sanitisation in `parse_date_range` — bound `text` length to prevent regex DOS.

## Next Steps

- Phase 02 focus store benefits directly: parse_date_range result writes `last_timeRange` for next turn.
- If decomposed tools see heavy use, consider exposing more (e.g. `validate_filter`, `suggest_drill_down`).
