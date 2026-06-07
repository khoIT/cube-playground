# Phase 01 — Starter pass-through writes session memory

## Context links

- Bug evidence: session `3542a7c1-b488-402a-ae5b-3f090717b898` (runtime/chat.db) — turn 1 starter hit, turn 3 metric confidence 0, focus block carried only artifact UUID + skill.
- `src/tools/disambiguate-query.ts:121-136` — early return on starter hit, before `writeMemoryFromResult` (line 187).
- `src/tools/disambiguate-memory-merge.ts` — `writeMemoryFromResult(result, params)` (writes L2 kv + L3 user prefs).
- `src/tools/disambiguate-starter-passthrough.ts` — `StarterPassthroughHit { questionId, query, measures, dimensions }`.
- `src/api/turn/write-session-focus.ts` — focus copies FROM disambig memory; fixing the write here fixes the Conversation-focus prompt block for free.

## Overview

Priority P1. Starter-chip turns must leave the same memory trail a
glossary-resolved turn leaves, so follow-ups ("add in X", "break it down by
Y") have a context anchor.

## Implementation steps

1. In `disambiguate-query.ts` handler, hoist the `memoryParams` construction
   above the starter-hit branch (it currently sits below at line 166).
2. In the starter-hit branch, before returning: build a minimal
   `DisambiguationResult`-shaped object from the hit and call
   `writeMemoryFromResult`:
   - `slots.metric = { value: starterHit.measures[0], confidence: 1, alias: args.message }`
   - `slots.intent = { value: query.timeDimensions?.[0]?.granularity ? 'trend' : 'aggregate', confidence: 1 }`
   - `slots.timeRange` = from `query.timeDimensions[0]` when present
     (`{ value: dateRange, confidence: 1, granularity }`).
   - `slots.dimension` = `starterHit.dimensions[0]` when present (confidence 1).
   - Leave concept/entity/filters/ratio unset.
3. Reuse the existing helper — do NOT duplicate kv-write logic. If
   `writeMemoryFromResult`'s `DisambiguationResult` type demands more fields,
   add a tiny local factory `starterHitToResult(hit, message)` in
   `disambiguate-starter-passthrough.ts` (keeps the handler slim).
4. Keep the early return otherwise unchanged (same response payload).

## Related code files

- Modify: `src/tools/disambiguate-query.ts`
- Modify (factory): `src/tools/disambiguate-starter-passthrough.ts`
- Read-only: `src/tools/disambiguate-memory-merge.ts`, `src/cache/disambig-memory-adapter.ts`

## Todo

- [x] Hoist memoryParams above starter branch
- [x] `starterHitToResult` factory + memory write before early return
- [x] Unit test: starter hit → `getResolutions` returns metric/intent/timeRange
- [x] Unit test: follow-up turn `fillResultFromMemory` sees starter metric
- [x] Regression: starter hit response payload unchanged (existing tests pass)

## Success criteria

After a starter-chip turn, `disambig_resolution` kv row holds the pinned
metric, and the next turn's Conversation-focus block renders
`- Last metric: {{field:etl_game_detail.matches}}`.

## Risk

- L3 user-prefs write now also fires for starter chips (via
  `writeConfidentSlotsToUserPrefs`). Acceptable — chips are explicit user
  choices, exactly what prefs should learn. Note in PR description.
- `sameValue` dedupe in the writer prevents kv churn on repeated chip clicks.
