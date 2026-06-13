# Glossary + Metric Resolution Failures — Session b93d68e4 Analysis

**Date:** 2026-05-26 | **Session:** `b93d68e4-1dfd-44f0-a5b9-83d4d4c161b0` | **Game:** ballistar (dev env)

## 1. Session Trace (10 turns, 0 useful results until turn 9)

| Turn | User | Assistant action | Intent route |
|---|---|---|---|
| 0 | "top spenders this week" | (start) | explore, conf=0.3, autoRoute=**false** |
| 1 | — | Asked "Which metric should I rank spenders by?" → 5 options (Revenue, LTV, First purchase rate, ARPU, ARPDAU) | — |
| 2 | "Revenue" | — | explore, conf=0, autoRoute=**false** |
| 3 | — | Asked "Which revenue-related metric?" → **6 options** (Revenue, ARPPU, ARPU, RevNPU, RevNNPU, ARPNPU/ARPNNPU) | — |
| 4 | "revenue_vnd" | — | explore, conf=0, autoRoute=**false** |
| 5 | — | "`recharge.revenue_vnd` maps to the Revenue business metric. Which would you like?" → **5 options again**, plus "Or raw measure?" | — |
| 6 | "recharge.revenue_vnd" | — | explore, conf=0, autoRoute=**false** |
| 7 | — | Replied with a **metric_explain-style** answer (definition, related measures, when to use). **Still no query, no chart.** Asked for time range + breakdown. | — |
| 8 | "Show daily revenue for the last 7 days" | — | explore, conf=0.8, autoRoute=**true** ✅ |
| 9 | — | Emitted artifact (returned 0 rows in dev env — separate issue) | — |

**Cost of failure:** 4 user disambig replies, ~2,400 output tokens spent on clarification loops, 8 turns to answer a question that should have resolved in 1.

## 2. Failure Modes (Specific Bugs)

### F1 — "Concept" words have no glossary entry

"Spender" is a fundamental analytics concept (a paying user, optionally ranked by spend). The glossary has no entry mapping it. Closest existing entry: `paying_users.yml` has synonyms `pu, pu1, pu3, pu5, pu7, payers, paying_users_rolling` — **missing `spender(s)`**.

Result: turn 0 falls through to clarification-builder's generic "pick a leaderboard metric" path, surfacing 5 metric ids that the user wasn't asking about.

**Evidence:** `server/src/presets/business-metrics/paying_users.yml:4-11`, `chat-service/src/nl-to-query/intent-classifier.ts:17` (LEADERBOARD_RE matches "top" but no entity resolution follows).

### F2 — Leaderboard intent doesn't resolve to an entity

Intent classifier correctly tags "top spenders this week" as `intent: 'leaderboard'` (score 0.92). But the leaderboard path in `clarification-builder.ts:34-83` jumps straight to picking a *metric*, never asking "rank what?" — the entity to rank is implicit but missing from the slot model.

For "top spenders", the answer is unambiguous: `entity=players`, `orderBy=recharge.revenue_vnd DESC`, `limit=10`, `timeRange=this week`. No clarification needed.

### F3 — Disambig surfaces siblings after the user picked the right answer

Turn 2: user said "Revenue". Turn 3: agent listed 6 *different revenue metrics*. This is the synonym-resolver behaving as a fuzzy matcher when an exact match exists. "Revenue" matches the business-metric id `revenue` exactly — should auto-pin, not surface siblings.

Same bug at turn 5: agent confirms `recharge.revenue_vnd` IS the Revenue metric, then asks which metric to use anyway.

**Evidence:** `chat-service/src/nl-to-query/synonym-resolver.ts` (returns ranked list without a confidence threshold for "skip clarify").

### F4 — Field-name input not treated as terminal

User typed `revenue_vnd` (turn 4) and `recharge.revenue_vnd` (turn 6) — these are exact cube refs. Agent recognised them but still asked which business metric to use. A fully-qualified field ref should short-circuit the entire metric disambig: just use it.

### F5 — Skill body says "clarify once" but enforcement is loose

`SKILL.md` line: *"Clarify once if ambiguous. … Do NOT call more tools until the user answers."* In this session the agent clarified 4 times. The skill body sets policy but disambig tool runs every turn from scratch with no awareness of prior clarifications — phase 02 focus store directly addresses this, but the root cause is deeper (per-turn re-disambiguation).

### F6 — Wrong terminal skill at turn 7

User asked for a *query* (turn 0 was "top spenders this week"); agent landed on a `metric_explain` answer at turn 7. Intent router stayed on `explore`, but the agent's behaviour collapsed into explain-mode after enough clarifications. No safety rail brings the agent back to "answer the original question".

### F7 — No "good enough" threshold; ambiguity is binary

Disambig either succeeds (auto-route) or asks. Never: "I'm 75% sure you mean Revenue; using it — was that right?" That single behaviour change would have collapsed this session to 2 turns.

### F8 — `paying_users.yml` is a count, not an entity dimension

Even if "spender" had a synonym → `paying_users`, that metric is a *cardinality count*, not a per-user spend ranking. "Top spenders" needs the players table, not a count. The glossary has no concept of "entity backing a count metric" — there's no path from `paying_users` to "rank the underlying users".

### F9 — Clarification reply re-disambig'd fresh; intent + entity not persisted

`chat-service/src/cache/disambig-memory-adapter.ts` defines `DisambigResolutions` with four slots: `metric / dimension / timeRange / filters`. Notably absent: **`intent` and `entity` (or `concept`)**. `disambiguate-memory-merge.ts:68-104` faithfully bridges the four it knows about, but cannot bridge what's not in the shape.

Concrete trace of session b93d68e4:
- Turn 0 "top spenders this week" → engine resolves `intent=leaderboard` (intent-classifier score 0.92); ends in clarify (no metric). Memory write: only `timeRange` (no intent slot to write to).
- Turn 2 "Revenue" → engine sees standalone "Revenue"; `fillResultFromMemory` restores `timeRange` only. Result state: `{metric: Revenue, timeRange: this week}` — leaderboard intent has evaporated. Agent treats this as a generic metric-pick question → fans out 6 revenue siblings.

The user's intuition is precisely right: "top spenders by revenue" gets forgotten, not because the agent lacks the words, but because the memory shape has no field for the *kind* of question being asked.

**Fix scope:** extend `DisambigResolutions` with `intent`, `concept`, `entity` slots; persist intent/concept on every confident resolution, *even when the overall action is clarify*. Combined with the concept tier (F1/F2 fix) and exact-match short-circuit (F3 fix), the same session collapses from 8 turns to 2.

Folded into phase-02a as Sub-deliverable D.

## 3. Root Causes (Grouped)

| Root cause | Bugs it explains | Fix surface |
|---|---|---|
| **RC1 — Glossary has no concept tier.** Maps `business_metric → cube field` only. Missing: `concept (spender/whale/churner) → entity + default measure + default filter`. | F1, F2, F8 | Glossary schema v2 |
| **RC2 — Resolver lacks "obvious match → don't clarify" semantics.** Exact id match, fully-qualified ref, single high-confidence synonym should auto-pin. Today every match enters the same ranked-list clarify flow. | F3, F4 | Synonym resolver confidence gates |
| **RC3 — Leaderboard intent is half-implemented.** Intent classifier detects it; resolution path treats it like any other aggregate. | F2 | Leaderboard query shape (orderBy + limit) as first-class |
| **RC4 — Disambig is stateless per turn.** No memory of prior clarifications; each turn re-asks. | F5 | Phase 02 focus store (already in plan) + phase 02a (new) |
| **RC5 — No "good enough" threshold.** Binary clarify-or-route; no "I assumed X — correct me" pattern. | F5, F6, F7 | Confidence-gated auto-route with assumption disclosure |

## 4. Mapping to Plan (current + recommended changes)

| Failure mode | Current plan addresses? | Gap |
|---|---|---|
| F1 (no "spender" entry) | No | Need glossary v2 schema + content additions |
| F2 (leaderboard entity) | No | Need leaderboard intent path to resolve an entity |
| F3 (siblings after pick) | Partial (phase 07 decomposes, doesn't fix threshold) | Need exact-match short-circuit |
| F4 (field ref terminal) | No | Need ref-input recogniser at disambig entry |
| F5 (per-turn re-ask) | Yes (phase 02 focus store) | Adequate after phase 02 ships |
| F6 (skill drift to explain) | No | Need "preserve original intent" rail across clarifications |
| F7 (binary ambiguity) | No | Need confidence-gated auto-route with disclosure |
| F8 (entity behind count) | No | Glossary v2 concept entry references entity, not just measure |

5 of 8 failure modes are not addressed by the current plan. They share two surfaces: **glossary schema v2** and **resolver behaviour upgrades**. Both belong in a new top-priority phase (proposed: phase-02a).

## 5. Recommended Plan Changes

1. **Insert new Phase 02a — Glossary Resolution v2** as the highest-impact phase. Centre of gravity for the revamp.
2. **Reframe `plan.md` goal**: primary business goal is "agent answers in 1 turn, not 5". Cross-turn context (phases 01/02) and UI controls (phase 03) become supporting infrastructure.
3. **Phase 02 (focus store) reduced scope**: still ships, but pitched as "remember after you finally got an answer" not "solve the disambig loop".
4. **Phase 07 (nl-to-query decomposition) tightened**: now explicitly serves phase 02a — exposes glossary + concept-resolution as tools so the model can backtrack on ambiguous concepts.

## 6. Quantified Targets (post-fix)

Baseline (this session as worst-case):
- Turns-to-answer for "top spenders this week": **8**
- Useless clarifications: **4**
- Output tokens wasted on loops: **~2400**

Target (after phase 02a + 07):
- Turns-to-answer for same prompt: **≤2** (one assumption-disclosed answer + optional confirm)
- Useless clarifications: **0**
- Output tokens: **≤500** (the answer itself)

Eval suite (phase 09): add "concept-resolution-eval.ts" with cases: top spenders, whales, churners, top countries by revenue, top items by sales, paying users this month, new spenders last week. Pass = answer delivered in ≤2 turns with correct entity + measure.

## 7. Unresolved Questions

1. Is "spender" the user's term, or do real PMs say "paying user" / "payer"? Affects glossary content additions (audit recent prod sessions).
2. Should leaderboard limit default to 10? 20? 50? Different per concept (whales = 10; top countries = 20).
3. For F8, do we need a generic "entity behind count" relationship in glossary, or per-metric `default_entity` field?
4. Phase 02a is large — should it split into 02a (schema v2) and 02b (resolver behaviour), or stay one phase?
5. Confidence threshold for "skip clarify": 0.8? 0.9? Tune via eval suite.
