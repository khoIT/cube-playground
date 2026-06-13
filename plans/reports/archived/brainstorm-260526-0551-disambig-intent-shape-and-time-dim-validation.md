---
type: brainstorm
date: 2026-05-26
slug: disambig-intent-shape-and-time-dim-validation
status: agreed
---

# Brainstorm — Force disambig + intent shape slot + time-dim capability check

Reproduces session `a0cc4d4c-8bed-46ee-a064-5fcdf8a603f6`. Three layered gaps surfaced from one prompt.

## Observed

- T0 user: "top spenders this week" → cached clarify served (pre-fix)
- T2 user: "top spenders this week" → fresh clarify, chips
- T4 user: "ARPU" → assistant returns scalar `mf_users.arpu_vnd ≈ 7,099 VND` lifetime
- kv_cache after: timeRange=this week present; metric=∅

User expectation: T4 should resolve to `{measure: recharge.revenue_vnd, dim: <user id>, dateRange: [2026-05-19, 2026-05-25], order: DESC, limit: N}` — a per-user leaderboard, not a lifetime aggregate.

## Three gaps

| # | Gap | Why | Fix label |
|---|-----|-----|-----------|
| 1 | metric memory empty after T4 | model skipped `disambiguate_query` for the one-word reply | A |
| 2 | "top spenders" interpreted as aggregate | engine has no intent slot; query composer always produces aggregate | B |
| 3 | snapshot measure picked under a timeRange | no validator for measure × timeRange compatibility | C |

## Locked scope (user pick: A + B + C)

### A — Force disambig on every analytical turn

- Add directive to `chat-service/.claude/cube-playground.md`: "Call `disambiguate_query` for every analytical message AND every reply to a clarification (including bare slot values like 'ARPU' or 'by country')."
- Tighten tool description so the model recognises slot-reply turns as eligible.
- No engine change.

### B — Intent shape slot

New types in `nl-to-query/types.ts`:

```ts
export type QueryIntent = 'aggregate' | 'leaderboard' | 'trend' | 'comparison';

export interface DisambiguationSlots {
  metric: ScoredSlot<string>;
  dimension?: ScoredSlot<string>;
  timeRange?: ...;
  filters?: SlotFilter[];
  comparison?: ScoredSlot<string>;
  intent: ScoredSlot<QueryIntent>;  // NEW, default 'aggregate' conf 0.6
}
```

New `nl-to-query/intent-classifier.ts` (~80 LOC):
- `\b(top|highest|lowest|rank|leaderboard|bottom)\s*\d*\b` → `leaderboard` conf 0.9
- `\b(trend|over time|daily|weekly|monthly)\b` → `trend` 0.85
- `\bvs\b|\bcompare(d)?\b|\bversus\b` → `comparison` 0.85
- vi aliases: `cao nhất / nhiều nhất / xếp hạng / so với / theo ngày`
- default `aggregate` 0.6

Query composer change (`query-composer.ts`):
- `intent === 'leaderboard'` AND dimension resolved → add `order: { metric: 'desc' }, limit: N` (N from parsed numbers, default 10)
- `intent === 'leaderboard'` AND dimension empty → leave dimension empty so clarification builder asks "Rank by which entity?"

Clarification builder change (`clarification-builder.ts`):
- When `intent === 'leaderboard'` AND `!dimension.value` → emit a clarification with slot=`dimension`, question "Rank by which entity?" + options from cube /meta id-typed dimensions.

### C — Time-dim capability check

New `chat-service/src/core/cube-meta-capability.ts` (~40 LOC):

```ts
export function cubeHasTimeDimension(meta: any, cubeName: string): boolean;
```

Walks `meta.cubes[name=cubeName].dimensions[].type === 'time'`.

Validator in `tools/disambiguate-query.ts`:
- When `result.slots.timeRange?.value` is set AND `result.slots.metric.value` is set
- AND the metric's cube has no time dimension → force `action='clarify'`, warn, surface a clarification suggesting a time-aware alternative.

Alternative-finder heuristic (`nl-to-query/time-aware-measure-suggester.ts` ~50 LOC):
- Walk all cubes for measures with similar names (Levenshtein or substring) on a cube WITH a time dimension.
- Return top 3 candidates.
- If none found, fall back to "this measure is a lifetime snapshot, drop the time scope?"

## Out of scope

- Auto-picking an id-dimension when intent=leaderboard without asking (would guess wrong on multi-id cubes; clarification is safer).
- Cross-cube join inference (e.g. linking metric on one cube to id-dim on another).
- LLM-side fallback if extractor's intent classifier misses.

## File touch list

**Modify:**
- `chat-service/.claude/cube-playground.md` — directive + maybe tool guidance
- `chat-service/src/nl-to-query/types.ts` — intent slot
- `chat-service/src/nl-to-query/slot-extractor.ts` — call intent classifier
- `chat-service/src/nl-to-query/query-composer.ts` — leaderboard order+limit
- `chat-service/src/nl-to-query/clarification-builder.ts` — leaderboard-dim clarification
- `chat-service/src/tools/disambiguate-query.ts` — time-dim capability check + alt-measure suggester wiring
- `chat-service/src/tools/disambiguate-memory-merge.ts` — drop new "intent" clarifications when memory has dimension (analogous to current handling)

**Create:**
- `chat-service/src/nl-to-query/intent-classifier.ts`
- `chat-service/src/core/cube-meta-capability.ts`
- `chat-service/src/nl-to-query/time-aware-measure-suggester.ts`
- 3 test files: intent-classifier.test.ts, cube-meta-capability.test.ts, time-aware-measure-suggester.test.ts
- 1 integration replay test: "top spenders this week" → clarify metric → "ARPU" reply → clarify entity (because cube mismatch detected) → reply "user" → final action=auto with leaderboard query

## Success metric (one verifiable end-to-end)

Replay test reproducing session a0cc4d4c:
- T0 message "top spenders this week" → action='clarify', slots.metric=∅, slots.intent.value='leaderboard' conf≥0.85, slots.timeRange resolved
- T2 message "ARPU" → action='clarify' (because mf_users.arpu_vnd has no time dimension), warning mentions alternative `recharge.revenue_vnd`
- T4 message "recharge.revenue_vnd" → action='clarify' (because intent=leaderboard but dimension=∅), clarification asks "rank by which entity"
- T6 message "by user" → action='auto', query has measures=[recharge.revenue_vnd], dimensions=[mf_users.id or equiv], timeDimensions=[date+range], order={recharge.revenue_vnd: desc}, limit=10

## Risks

| # | Risk | Mitigation |
|---|------|-----------|
| 1 | Tool description change makes the model over-call disambig for non-analytical chat | Keep the directive scoped to "analytical messages AND slot replies"; verify with smoke test |
| 2 | Time-dim check rejects valid measures because /meta lacks the `type: 'time'` marker | Audit cube /meta; provide a config override list of "known time-aware cubes" if needed |
| 3 | Intent classifier false-positives "top" in non-leaderboard contexts ("top of the funnel") | Require co-occurring metric-y noun OR explicit number ("top 10"); ship conservative regex + iterate |
| 4 | Alt-measure suggester picks a misleading alternative | Show as "did you mean" with confidence; user picks |

## Estimated diff

~300 LOC source + ~250 LOC tests across 11 files. One PR, 3 commits (A / B / C).

## Unresolved questions

- Confirm the regex list for leaderboard / trend / comparison phrases is exhaustive enough — happy to ship conservative and iterate.
- For time-dim alt-measure suggester: prefer Levenshtein on cube member name, or category-based lookup via glossary?
- Should intent slot drive a NEW memory key in `user_disambig_prefs` so the user's typical query shape persists? YAGNI cut for v1 — revisit after data.
