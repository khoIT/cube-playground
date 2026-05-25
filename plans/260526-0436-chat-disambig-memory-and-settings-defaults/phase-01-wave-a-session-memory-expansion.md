# Phase 01 — Wave A: Session memory expansion + phrase storage

## Context Links

- Brainstorm: `plans/reports/brainstorm-260526-0436-chat-disambig-memory-and-settings-defaults.md`
- Current adapter: `chat-service/src/cache/disambig-memory-adapter.ts:22` (DisambigResolutions)
- Current tool: `chat-service/src/tools/disambiguate-query.ts:80` (memory read), `:122` (write-on-auto-only)
- KV cache store: `chat-service/src/cache/kv-cache-store.ts`
- Existing date resolver: `chat-service/src/nl-to-query/date-resolver.ts`
- Slot extractor: `chat-service/src/nl-to-query/slot-extractor.ts`

## Overview

- **Priority:** P2 (high — unblocks waves B, B2; standalone behavioural fix)
- **Status:** pending
- **Description:** Extend session memory to cover timeRange + filters, store user's natural-language phrase alongside resolved values, and switch the write trigger from "only on auto-route" to "every confidently-resolved slot, before action check". This is the core ledger fix.

## Key Insights

- `mergeResolution` today writes only when the tool emits `action === 'auto'`. T1 (clarify-only) writes nothing → T2 reply "ARPU" doesn't restore prior turns' timeRange context.
- timeRange must re-resolve on read so "this week" stays accurate across day/week boundaries inside a 24h session.
- Storing the phrase ("this week") plus the resolved value lets us re-resolve later (cross-session use in phase 2) and disclose readable defaults in UI (phase 3).
- Disambig tool risks exceeding 200 LOC after the rewrite — modularise into `disambiguate-memory-merge.ts`.
- Existing 8 memory tests must still pass; shape change is additive (wrap value in `{ value, phrase? }`).

## Requirements

### Functional

- `DisambigResolutions` carries metric / dimension / timeRange / filters slots, each shaped `{ value, phrase? }`.
- `mergeResolution` deep-merges filters by member key (already does — preserve).
- Tool writes back to session memory for every slot with confidence ≥ 0.7 before deciding `clarify` vs `auto`.
- Tool reads memory before re-evaluating clarifications; for timeRange, re-resolves the stored phrase against `ctx.now`.
- New `phrase-resolver.ts` exposes `resolveTimePhrase(phrase, now) → { dateRange, granularity }`. Same util used by extractor.
- Confidence floor for memory writes = 0.7 (matches extractor's auto-route gate).

### Non-functional

- Adapter file stays ≤ 100 LOC after the shape change.
- `disambiguate-query.ts` stays ≤ 200 LOC. Split into `disambiguate-memory-merge.ts` (read + fill + write-back) if it crosses.
- Memory writes idempotent: same value second time = no-op (kv_cache upsert handles).
- TypeScript strict mode; no `any`. Use generic `SlotMemory<T>` interface.

## Architecture

```
turn N:
  ┌────────────────────────────────────────────────────────────┐
  │ disambiguate_query handler                                  │
  │  1. extractor(msg)               → result.slots             │
  │  2. mem = getResolutions(db,sid)                            │
  │  3. for each slot in result.slots:                          │
  │     if !result.slot.value && mem[slot]:                     │
  │       fill from memory                                      │
  │       if slot==timeRange: re-resolve mem.phrase via         │
  │         resolveTimePhrase(mem.phrase, ctx.now)              │
  │  4. write-back every confident slot to memory               │
  │     mergeResolution(db,sid,owner, { metric:{value,phrase}}) │
  │  5. recompute action: clarify → auto if no clars remain     │
  │  6. emit disambig_options if still clarify                  │
  └────────────────────────────────────────────────────────────┘
                          │
                          ▼
           kv_cache (kind='disambig_resolution', key=session:<id>, ttl=24h)
```

Component split if `disambiguate-query.ts` exceeds 200 LOC:

- `disambiguate-query.ts` → extractor invocation, clarification emission, SSE.
- `disambiguate-memory-merge.ts` (new) → read memory + fill empty slots + re-resolve timeRange + write-back.
- `phrase-resolver.ts` (new) → pure util.

## Related Code Files

**Modify:**
- `chat-service/src/cache/disambig-memory-adapter.ts` (shape change, +confidence-gated write helper if useful).
- `chat-service/src/tools/disambiguate-query.ts` (read all slots from memory, re-evaluate, write all slots).

**Create:**
- `chat-service/src/nl-to-query/phrase-resolver.ts` (pure util).
- `chat-service/src/tools/disambiguate-memory-merge.ts` (extracted if disambiguate-query.ts > 200 LOC).
- `chat-service/test/cache/disambig-memory-adapter.test.ts` (shape change coverage if not already present).
- `chat-service/test/nl-to-query/phrase-resolver.test.ts`.
- `chat-service/test/tools/disambiguate-query.memory.test.ts` (T0→T2 replay).

**Delete:** none.

## Implementation Steps

1. **Shape change adapter.** Update `DisambigResolutions` to use `SlotMemory<T>` wrapper:
   ```ts
   export interface SlotMemory<T> { value: T; phrase?: string }
   export interface DisambigResolutions {
     metric?: SlotMemory<string>;
     dimension?: SlotMemory<string>;
     timeRange?: SlotMemory<{ dateRange: [string,string]; granularity?: 'day'|'week'|'month' }>;
     filters?: Record<string, SlotMemory<string>>;
     updatedAt: number;
   }
   ```
   Keep `mergeResolution` API identical (deep-merge filters preserved).
2. **Create `phrase-resolver.ts`.** Wrap the relevant subset of `date-resolver.ts` to return `{ dateRange, granularity }` from a phrase + `now`. Pure function. Cover: `this week`, `last 7 days`, `this month`, `yesterday`, `today`, `last month`. Bilingual (vi + en) using existing date-resolver aliases.
3. **Refactor disambiguate-query.ts read path.** Replace lines 80–99 to:
   - Read memory once into `mem`.
   - For each slot (metric, dimension, timeRange, filters): if extractor result has no value AND mem has one, fill from mem. For timeRange, call `resolveTimePhrase(mem.timeRange.phrase, ctx.now)` if phrase exists; otherwise use stored dateRange directly.
   - Append warning `'<slot> resolved from session memory: <value-or-phrase>'`.
4. **Refactor write path.** Replace lines 120–127 to write all confident slots (any `slots[x].confidence >= 0.7`) into memory before the action check. Include phrase from extractor output where available.
5. **Re-evaluate action.** After write-back, if `result.action === 'clarify'` and `result.clarifications` is empty (because every clarified slot was filled from memory), upgrade to `'auto'`.
6. **Split if oversized.** If `disambiguate-query.ts` exceeds 200 LOC, extract the read+fill+write-back logic into `disambiguate-memory-merge.ts` exposing `mergeMemoryIntoResult(result, ctx)`.
7. **Tests.**
   - Adapter: round-trip new shape; legacy row (no phrase) reads as `{ value, phrase: undefined }` safely.
   - phrase-resolver: frozen now; `this week` returns Mon..Sun range; `last 7 days` returns inclusive 7-day; `this month` returns 1st..last of current month; bilingual aliases work.
   - Disambig tool replay: T0 ambiguous metric + "this week" → result.action=clarify, memory has timeRange phrase. T1 reply "ARPU" → memory has metric+timeRange. T2 new turn ambiguous metric only → auto-routes with metric=ARPU from memory.
   - Filter deep-merge: write filter A then filter B → memory has both.
8. **Compile + run existing tests.** Bump existing memory tests if shape change breaks them; do not lower coverage.

## Todo List

- [ ] Adapter shape change (`SlotMemory<T>`), preserve API
- [ ] `phrase-resolver.ts` util + test fixture
- [ ] Read-path rewrite (fill empty slots from memory; re-resolve timeRange phrase)
- [ ] Write-path rewrite (every slot with conf ≥ 0.7, before action check, with phrase)
- [ ] Re-evaluate action upgrade clarify → auto
- [ ] Split into `disambiguate-memory-merge.ts` if > 200 LOC
- [ ] T0→T2 replay test
- [ ] Existing 8 disambig-memory tests still pass
- [ ] Commit: `feat(chat-disambig): expand session memory to all slots with phrase storage`

## Success Criteria

- Existing disambig-memory + tool tests green.
- New replay test green: T0 clarify metric + "this week" → T1 reply "ARPU" → T2 next turn auto-routes with both metric and timeRange.
- New phrase-resolver tests green for frozen-now fixtures across day/week/month boundaries.
- `disambig-memory-adapter.ts` ≤ 100 LOC; `disambiguate-query.ts` ≤ 200 LOC (split if needed).
- kv_cache inspection after replay test shows row with metric + timeRange (both with phrases).

## Risk Assessment

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|-----------|--------|------------|
| 1 | Shape change breaks downstream readers expecting `memory.metric: string` | Med | Med | Grep all callers of `getResolutions`; only `disambiguate-query.ts` consumes today. Update in same commit. |
| 2 | Low-confidence write pollutes memory for 24h | Med | Med | Confidence ≥ 0.7 gate. Mirrors extractor's auto-route gate. |
| 3 | Phrase re-resolver disagrees with extractor on edge phrases | Med | Med | Single util; extractor + reader both call it. Fixture coverage. |
| 4 | `disambiguate-query.ts` exceeds 200 LOC after rewrite | High | Low | Pre-planned split into `disambiguate-memory-merge.ts`. |
| 5 | Existing memory rows written under old shape break on read | Low | Low | Adapter tolerant: missing `phrase` → `undefined`. Legacy `metric: string` → log warning + treat as `{ value: string }`. 24h TTL means old rows drain fast. |

## Security Considerations

- Memory is session-scoped + owner-scoped via `kvPut(ownerId)`. No cross-owner leakage.
- No new PII fields. Phrase is the user's own natural-language input — same sensitivity tier as the rest of `chat_turns`.
- No new network surface in this phase.

## Next Steps

- Phase 2 depends on `phrase-resolver.ts` (re-used as Layer 3 read util) and the `SlotMemory<T>` shape.
- Phase 4 is independent and can land in parallel.
