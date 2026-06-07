---
name: disambiguate-query-followup-architecture
description: Order-sensitive pipeline in disambiguate-query.ts handler — anchored fill, additive merge, memory fill, recompose, member gate must stay in this sequence
metadata:
  type: project
---

`chat-service/src/tools/disambiguate-query.ts` `handler()` has an order-sensitive follow-up pipeline. Sequence (load-bearing):

1. starter pass-through (early return) — MUST write memory + lastQuery before returning, else next turn is context-blind.
2. anchored metric fill (reads `mem.metric` cube, token-equiv search) — sets `result.slots.metric`.
3. additive merge (`applyAdditiveMerge`) — reads the metric set in step 2, appends to `lastQuery`.
4. `fillResultFromMemory` — fills empty slots; runs AFTER 2-3 so a follow-up resolves the NEW phrase, not last turn's metric re-fill.
5. recompose query (guarded by `!result.query.measures?.length`) — skipped when merge already produced measures.
6. leaderboard build — `?? assumption` preserves the anchored-fill assumption when leaderboard declines.
7. member gate — validates slot refs (not merged-query measures; merged measures trusted from prior validated lastQuery).
8. contextual clarify-options replacement — only when a metric clarification already exists.

**Why:** session 3542a7c1 — reordering 2-4 reintroduces the context-blind clarify bug. The additive detector and `isFollowUpShaped` (≤6 words) are the topic-hijack guards mirroring `hasSubstantialUnresolvedText`.

**How to apply:** if a future change reorders these steps or adds a short-circuit, require a 2-turn replay test (chip → follow-up), not single-turn. Token-equivalence (`TOKEN_EQUIV` in `member-resolution.ts`) is anchor-scoped ONLY — global `searchMembers` must stay equiv-free.

Known minor gap (not a bug): `preferDualAxis`/`toDualAxisSpec` only chart the first 2 numeric columns; a 3+ measure additive merge auto-renders dual-axis showing 2 of N series (user can switch via menu).
