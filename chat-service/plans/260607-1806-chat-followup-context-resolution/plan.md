---
title: Chat follow-up context resolution (starter memory + cube anchoring + additive intent)
status: in-progress # code+tests complete & reviewed; pending: live dev replay (blocked on sibling session's in-flight chat turns)
priority: P1
effort: medium
branch: main
tags: [chat-service, nl-to-query, disambiguation, follow-up]
created: 2026-06-07
---

# Chat follow-up context resolution

Root cause (session `3542a7c1`, cfm_vn): user asked "add in user count per day"
after a starter-chip "Matches played per day" chart. Agent surfaced a canned
DAU/new/paying/registered clarify menu that didn't even contain the correct
answer (`etl_game_detail.distinct_players` — same cube as the chart).

Three compounding gaps, one phase each:

| # | Gap | Phase |
|---|-----|-------|
| A | Starter pass-through returns early, never writes disambig session memory → follow-ups (and the Conversation-focus prompt block) have zero context | [phase-01](phase-01-starter-passthrough-memory-write.md) |
| B | Unresolved metric phrase never checked against the cube already in play; clarify menu is glossary-only | [phase-02](phase-02-cube-anchored-metric-fallback.md) |
| C | "add in X" not modeled — every message resolved standalone; no way to extend the previous query (measure-additive AND filter-additive — user decision 2026-06-07) | [phase-03](phase-03-additive-follow-up-merge.md) |
| D | Merged multi-measure chart squashes the smaller series on one shared Y axis — dual-axis rendering (user decision 2026-06-07: option B) | [phase-05](phase-05-dual-axis-chart-rendering.md) |
| — | Prompt/docs updates + end-to-end replay of the failing conversation | [phase-04](phase-04-prompt-docs-verification.md) |

## Dependencies

```
phase-01 ──► phase-02 ──► phase-03 ──► phase-05 ──► phase-04
   (memory)    (resolver fallback)  (uses both)   (FE dual axis)
```

Phase 02 needs phase 01's memory writes to know the prior cube. Phase 03
reuses phase 02's anchored resolution for the added measure.

## Key design decisions

- **No new tools, no LLM calls** — all fixes inside `disambiguate_query`'s
  deterministic pipeline + tiny writes in `emit_query_artifact`. The clarify
  HARD STOP prompt rule stays; the tool just stops returning wrong clarifies.
- **Auto-route threshold reuse**: `config.chatGlossaryAutorouteThreshold`
  gates cube-anchored auto-fill; below it the candidates become clarify
  *options* instead (so the menu is at least contextual).
- **Guard against topic hijack**: cube-anchored fallback fires only on
  additive-marked messages or short slot-reply-shaped messages — mirrors the
  existing `hasSubstantialUnresolvedText` blockTopicFill discipline.

## Success criteria (end-to-end)

Replay of the failing conversation on dev: turn 1 starter chip → turn 2
"add in user count per day" returns `action:'auto'` with
`measures: [etl_game_detail.matches, etl_game_detail.distinct_players]`,
same timeDimensions, and the agent emits ONE artifact charting both series
with an "interpreted user count as Distinct Players" disclosure.

## Todo

- [x] Phase 01 — starter pass-through memory write
- [x] Phase 02 — cube-anchored metric fallback + contextual clarify options
- [x] Phase 03 — additive follow-up detection + query merge (measures + filters)
- [x] Phase 05 — dual-axis chart rendering for mixed-scale multi-measure artifacts (scale gap 4×, exactly-2-measures gate per review)
- [ ] Phase 04 — prompt text [x], docs [x], lessons-learned [x], full suites [x] (1109 + 117 green), code review [x] DONE_WITH_CONCERNS→fixed — **dev replay pending** (chat-service restart needed; sibling session has in-flight SDK turns)
