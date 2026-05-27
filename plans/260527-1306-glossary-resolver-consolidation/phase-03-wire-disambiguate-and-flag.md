# Phase 03 — Wire into disambiguate-query; retire/default the v2 flag

## Context Links
- `chat-service/src/tools/disambiguate-query.ts:103-132` — engine call + `applyGlossaryV2` + retry
- `chat-service/src/tools/disambiguate-query.ts:200-303` — `applyGlossaryV2` (to remove)
- `chat-service/src/tools/disambiguate-query.ts:305-365` — `retryLeaderboardFromMemory`
- `chat-service/src/config.ts:257-258` — `chatGlossaryV2Enabled`, `chatGlossaryAutorouteThreshold`
- `chat-service/src/nl-to-query/index.ts:48-117` — `disambiguate` engine entry
- `chat-service/src/nl-to-query/metric-resolver.ts` — Phase 02 resolver

## Overview
- **Priority:** P1
- **Status:** done
- The engine now produces a cube-member metric via the unified resolver in `extractSlots`. The
  flag-gated `applyGlossaryV2` post-pass is deleted; its useful behaviors live inside the engine.
  Decide flag fate: unify on by default.

## Key Insights
- With Phase 02, `result.slots.metric.value` is already a cube member at high confidence for the
  three former short-circuit paths AND for plain intents. The post-pass is redundant.
- `retryLeaderboardFromMemory` (sub-deliverable D replay) must be preserved — it fires after
  memory merge, which the engine cannot see. Keep it, but un-gate from `chatGlossaryV2Enabled`
  (it becomes always-on like the rest). It depends on concept metadata lookup retained in Phase 02.
- The `assumption` disclosure payload (interpreted-X-as-Y footer) stays — now sourced from the
  unified resolver's `matchedOn`/`alternatives` for the auto-routed-with-ambiguity case.
- **Flag decision (build to this):** unified resolver is **always on**. Replace the positive
  `CHAT_GLOSSARY_V2` (default false) with the resolver being the default path; keep a single
  inverted kill-switch `CHAT_GLOSSARY_LEGACY` (default false) for one release to fall back to the
  old `pickMetric`/`applyGlossaryV2` if prod regresses, then delete in Phase 06 follow-up.
  Rollback = set `CHAT_GLOSSARY_LEGACY=true`. (See Open Q3 — confirm with user.)

## Requirements
- Functional: remove `applyGlossaryV2`; engine output consumed directly.
- Functional: `assumption` still emitted when resolver picked among ≥2 plausible terms
  (`gap < disclose_margin`) but confidence high enough to auto-route.
- Functional: keep `rejectSnapshotMeasureUnderTimeRange`, memory merge, SSE `disambig_options`.
- Non-functional: `disambiguate-query.ts` stays <200 LOC after deletion (it shrinks).
- Backward compat: kill-switch env restores prior behavior for one release.

## Architecture / Data flow
```
message ─→ disambiguate() [engine, now member-correct]
            └─ extractSlots → metric-resolver → metric.value = cube member
        ─→ fillResultFromMemory
        ─→ retryLeaderboardFromMemory (un-gated; replay path)
        ─→ rejectSnapshotMeasureUnderTimeRange
        ─→ writeMemoryFromResult
        ─→ /meta gate (Phase 04) — safety net
        ─→ build `assumption` from resolver result
```

## Related Code Files
- **Modify:** `chat-service/src/tools/disambiguate-query.ts` — delete `applyGlossaryV2` + its call
  (lines ~108-116, ~200-303); un-gate `retryLeaderboardFromMemory`; build `assumption` from the
  resolver result the engine now returns (surface resolver `confidence`/`alternatives` on the
  result, e.g. via `result.warnings` or a new optional `result.resolution` field on
  `DisambiguationResult`).
- **Modify:** `chat-service/src/nl-to-query/types.ts` — optional `resolution?` on
  `DisambiguationResult` carrying `{ confidence, gap, matchedOn, alternatives }` for the footer.
- **Modify:** `chat-service/src/nl-to-query/index.ts` — populate `resolution` from resolver.
- **Modify:** `chat-service/src/config.ts` — replace `chatGlossaryV2Enabled` with
  `chatGlossaryLegacy` kill-switch; keep `chatGlossaryAutorouteThreshold` (now used by resolver).
- **Modify (callers of flag):** grep `chatGlossaryV2Enabled` — `disambiguate-query.ts` (2 sites).
  Total references to migrate: 2 in code + test mocks (`disambiguate-query-glossary-v2.test.ts`
  config mock at `:82-89`). Phase 05 owns test updates.

## Implementation Steps
1. Add optional `resolution` to `DisambiguationResult`; populate in `index.ts` from
   `metric-resolver` output (carry through `extractSlots`/`ExtractResult`).
2. Delete `applyGlossaryV2` and its invocation. Keep the cube-ref / exact / alias behavior —
   already inside the engine now.
3. Un-gate `retryLeaderboardFromMemory` (drop the `chatGlossaryV2Enabled` early return); guard
   instead on `intent==='leaderboard' && concept` as it already does.
4. Rebuild `assumption` from `result.resolution` (and the cross-session marker for the replay path).
5. Swap config flag: `chatGlossaryLegacy = optional('CHAT_GLOSSARY_LEGACY','false')==='true'`.
   When true, branch to a preserved `legacyPickMetric` path (keep the old code under a clearly
   named function for one release).
6. Build chat-service — no type errors. Grep confirms `chatGlossaryV2Enabled` gone from src.

## Todo List
- [x] `DisambiguationResult.resolution` added + populated
- [x] `applyGlossaryV2` removed; behaviors verified intact via engine
- [x] `retryLeaderboardFromMemory` un-gated, still replay-correct
- [x] `assumption` footer rebuilt from resolver result
- [x] flag swapped to `CHAT_GLOSSARY_LEGACY` kill-switch
- [x] disambiguate-query.ts <200 LOC; chat-service compiles

## Success Criteria
- "show revenue last 7 days" → `action:auto`, `metric.value:"recharge.revenue_vnd"` with the
  resolver path only (no `applyGlossaryV2`).
- "top spenders this week" → still `action:auto` + leaderboard query + `assumption` (regression-free).
- Replay (`disambiguate-query-b93d68e4-replay.test.ts`) still green.
- `CHAT_GLOSSARY_LEGACY=true` restores old clarify-on-revenue behavior (documents the rollback).

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Removing post-pass drops a behavior only it produced | M×H | Enumerate the 3 short-circuits + replay; map each to its new in-engine home before deleting; Phase 05 keeps the v2 test (retargeted) green |
| Model still free-forms a clarification instead of calling the tool (journal §3) | M×M | Out of scope (prompt-level, already fixed); note server-side guard as future lever in Phase 06 |
| `assumption` footer regresses (now from `resolution`) | M×M | Keep field shape identical; assert in Phase 05 |
| Legacy branch rots / both paths drift | M×L | Time-box: delete kill-switch next release; tracked in Phase 06 follow-up |

## Security Considerations
- No new external input. Flag is server-side env only.

## Next Steps
- Phase 04 turns the /meta gate into a pure safety net now that refs are always members.
