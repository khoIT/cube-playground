# Top Spenders → Lifetime ARPU: Three-Layer Disambig Loop Failure & Defence-in-Depth Fix

**Date**: 2026-05-26 14:30
**Severity**: High
**Component**: Chat disambigation, query artifact emission, intent routing
**Status**: Resolved

## What Happened

One chat session (`a0cc4d4c`) showed a user asking "top spenders this week" followed by "show me lifetime ARPU". The model's response to the second query resolved a business-metric ID (Revenue/ARPU) instead of halting for clarification — emitting a snapshot cube measure with no timeDimension even though the session had timeRange set. Shipped five commits in 90 minutes; each uncovered a fresh failure mode layer.

## The Brutal Truth

This was exhausting. Spent an hour staring at one user session, watching three separate boundaries fail to catch the same intent-shape mismatch. The model resolved a metric name correctly but asked the wrong question (aggregate vs. leaderboard vs. timeseries) because it had no explicit intent signal. Then when it picked the wrong shape, *three different safety checks* all failed — cache bypass, capability check, and prompt instruction all had gaps. The real insult: Revenue was in the chip list all along, buried under alphabetical ordering, so the user never got to see it as a clickable option in the first clarification attempt.

## Technical Details

**Session Context**: User queried "top spenders this week" (leaderboard intent + timeRange). Model disambiguated correctly. Then "show me lifetime ARPU" arrived with no timeRange context in the query — a snapshot question.

**Failure Trail**:
1. **Cache replay issue** (`a0cc4d4c` → `ab0fb07d`): Cached clarify turns replayed the text of the clarification prompt but omitted the chip SSE event. User got "Which metric?" with no clickable options. Root: clarifyEmitted=true rows were being cached, but cache read had no hook to re-emit chips.
2. **Metric-resolution bypass**: Model resolved "ARPU" to a business-metric ID (not a cube ref). Normally this falls into disambig+clarify flow. Instead, model saw a resolved ID and attempted to emit the query. The cube-meta capability checker (cubeHasTimeDimension) only fires when slot extractor produces a *cube* ref; business-metric IDs skip that path entirely.
3. **Chip ordering**: Revenue *was* in the metric chip list but alphabetical ordering within the monetisation category pushed it to position 5, past the 4-chip display cap. Users never saw it as a clickable clarification option.

## What We Tried

1. **Read cache layer**: Discovered clarifyEmitted turns stored in cache had no mechanism to re-emit the chip SSE when read back.
2. **Traced model decision path**: Saw action=clarify in the turn but model still resolved the metric. Realized action=clarify was not a hard stop — model treated it as a suggestion, not a command.
3. **Added emit-time backstop**: emit_query_artifact now reads session memory; if timeRange is set + measure on a cube with no timeDimension + no timeDimensions field in the measure, reject with time_dim_required before shipping.
4. **Audited metric priority**: Alphabetical sorting failed; switched to curated priority per intent (aggregate vs. leaderboard vs. timeseries).

## Root Cause Analysis

No single boundary caught the intent-shape mismatch:

```
User Intent: "top spenders this week" → "lifetime ARPU"
             leaderboard + timeRange       aggregate (no timeRange)
                                          ↓
                            Model resolves to business-metric
                                          ↓
                    Prompt doesn't hard-stop on clarify
                    Capability check doesn't fire (no cube ref)
                    Emit check doesn't fire (no time_dim conflict)
                                          ↓
                         Emits snapshot-measure with no time dim
```

**Why three failures happened together**: "top spenders this week" anchored the session with timeRange=true. When the user asked for "lifetime ARPU" *without* repeating the time constraint, the model saw no explicit timeRange in the second query and treated it as a new context. But session.timeRange persisted. The model tried to emit a snapshot-measure into a session that expects temporal queries. The three boundaries all missed this mismatch because each was designed for a different failure scenario.

## Lessons Learned

### Defence-in-Depth Across Three Boundaries

```
         User Input
            ↓
    ┌───────────────────────────────────────┐
    │  PROMPT BOUNDARY (Persuasive)         │
    │  Master command: action=clarify = STOP │
    │  Catches: model ignores explicit      │
    │  clarify signal (LOW confidence)      │
    └───────────────────────────────────────┘
            ↓ passes prompt
    ┌───────────────────────────────────────┐
    │ ENGINE BOUNDARY (Structural)          │
    │ Disambig rejects snapshot×timeRange   │
    │ + capability validators               │
    │ Catches: cube-ref paths that pick     │
    │ wrong shape (MEDIUM confidence)       │
    └───────────────────────────────────────┘
            ↓ passes engine
    ┌───────────────────────────────────────┐
    │ EMIT BOUNDARY (Defensive Backstop)    │
    │ emit_query_artifact reads session;    │
    │ refuses time_dim_required conflicts   │
    │ Catches: business-metric resolution   │
    │ paths the engine doesn't see (HIGH)   │
    └───────────────────────────────────────┘
            ↓ artifact shipped or rejected
```

All three were needed. Disabling any one would have shipped the bad measure.

### Intent Shape ≠ Slot Values

Natural-language → structured-query translation must distinguish *intent shape* from *metric slot*. "top spenders" + "ARPU" resolves to leaderboard(metric=ARPU, limit=10, order=desc). But "show lifetime ARPU" resolves to aggregate(metric=ARPU). Same metric name, different cube queries, different time constraints.

Current architecture routes on *slot values* (metric → cube-meta probes). Should route on *intent shape first* (leaderboard vs. aggregate vs. timeseries). Without explicit intent classification, the model guesses and our safety checks guess independently — misalignment becomes invisible.

### Commit Chain Sequence

1. **`86ec5ba`** — Skip cache writes on clarifyEmitted. (~20 LOC + 7 unit tests)
2. **`3026aa8`** — Expose disambig mode chip on full-page header. (One-liner, UX coherence)
3. **`3a4b22f`** — Intent slot + leaderboard validator + memory bridge phases. (Core diagnostic work; 150+ LOC)
4. **`38c814c`** — Hard-stop prompt + emit-time backstop. (Defensive additions; 30 LOC)
5. **`43e7838`** — Curated metric priority. (Priority array + cap raise to 5 chips)

Commits 1, 4, 5 were bug fixes. Commits 2, 3 were features that unblocked the diagnostic. In hindsight, commit 3 (intent classifier) was the architectural turn — everything after that clicked into place.

## Next Steps

1. **Model reaction to time_dim_required**: When emit_query_artifact returns time_dim_required, does the model re-enter disambig or treat it as an error? Need trace. If it re-enters, verify the clarification flow (same three-chip set, or does error context change priorities?).
2. **Extend capability checks to preview_cube_query**: Currently only emit_query_artifact backstops. Should preview_cube_query also refuse temporal conflicts? Low risk but consistency win.
3. **Intent extraction on ambiguous queries**: "show me ARPU" has no explicit intent shape. Current fallback is aggregate. Should we ask "Rank by entity (leaderboard) or total (aggregate)?" OR surface both and let user pick? Audit next three queries with no leaderboard/aggregate signals.
4. **Cache invalidation on intent changes**: If user clarifies a different intent, does old cached result get cleared? Spot-check cache hit rate after this week's data.

---

**Commits shipped**: 86ec5ba, 3026aa8, 3a4b22f, 38c814c, 43e7838
**Files modified**: `src/chat/disambig/disambig-slots.ts`, `src/chat/composer.ts`, `src/chat/emit-query-artifact.ts`, `src/chat/memory-bridge.ts`, `src/components/chat/full-page-header.tsx`
