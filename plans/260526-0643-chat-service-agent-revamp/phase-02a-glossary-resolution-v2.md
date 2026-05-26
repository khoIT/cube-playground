# Phase 02a — Glossary Resolution v2 (Centre of Gravity)

## Context Links

- `plans/reports/researcher-260526-0705-glossary-resolution-failures-session-analysis.md` — **read this first**; this phase is the direct fix
- `chat-service/src/nl-to-query/intent-classifier.ts:17` — leaderboard regex hits but no entity resolves
- `chat-service/src/nl-to-query/clarification-builder.ts:34-83` — leaderboard path → metric pick (wrong layer)
- `chat-service/src/nl-to-query/synonym-resolver.ts` — no "skip clarify on exact match" threshold
- `chat-service/.claude/skills/explore/SKILL.md` — "clarify once" policy not enforced
- `server/src/presets/business-metrics/paying_users.yml:4-11` — synonyms missing `spender(s)`

## Overview

- **Priority:** P0 — the headline phase. Primary business goal of the revamp.
- **Status:** **MVP done** (resolver core + flag-gated disambig integration + 44 unit tests). Sub-deliverable D (memory merge for `intent`/`concept`/`entity` slots), FE CRUD updates, 50-case eval suite, and prod-session audit are carved into follow-up sub-phases 02a-D / 02a-FE / 02a-E.
- **Flag:** `CHAT_GLOSSARY_V2` (default off; ramp gated on concept-resolution eval suite)
- **Description:** The user-visible problem is "agent asks 4 clarifying questions instead of answering". This phase fixes the four root causes that produced session `b93d68e4` (8 turns to deliver one query). Three sub-deliveries: (a) glossary schema v2 with a **concept tier**; (b) resolver with confidence-gated auto-route + exact-match short-circuit + raw-ref recogniser; (c) leaderboard intent path that resolves an **entity**, not just a metric.

## Key Insights

- Glossary today: `business_metric → cube field`. Missing tier: `concept → (entity, default_measure, default_filter)`. "Spender" is a concept, not a metric.
- Resolver today: every match → ranked-list clarify. Needed: confidence-gated. Exact id match or fully-qualified ref → auto-pin, no clarify.
- Leaderboard today: "top X" detected, but resolution path picks a metric instead of asking "rank what?". For "top spenders", entity is unambiguous (players) and default measure is unambiguous (revenue_vnd). Should never clarify.
- "Good enough" pattern matters: assumption disclosure (`I assumed X — correct me?`) beats blocking on a 5-option list. Cuts most clarifications.

## Requirements

### Glossary schema v2 — extend existing `glossary_terms` table (NOT a new directory)

**Reuse, do not parallelise.** The playground already has a full glossary system that is the source of truth for term ↔ catalog mapping:

- **Schema:** `glossary_terms` table — `id, label, description, primary_catalog_id, secondary_catalog_ids, aliases, category, label_vi, description_vi, aliases_vi, status (draft|official), source (seed|user), editor_name` (migrations `007-glossary.sql`, `008-glossary-bilingual-and-status.sql`).
- **Seed:** `server/data/glossary.seed.json` (~current contents: DAU, MAU, WAU, stickiness, D1/D7/D30 retention, …) — idempotent loader `server/src/db/glossary-migrate.ts`.
- **API:** `server/src/routes/glossary.ts` (CRUD).
- **FE CRUD UI:** `src/pages/Catalog/glossary/` (search, status toggle, alias chips, bilingual edit modal).
- **Chat consumer:** `chat-service/src/nl-to-query/glossary-client.ts` (already wired into the disambig path).

Phase 02a's "concept tier" is an **additive extension** of this table — new optional columns + new seed entries — NOT a parallel `concepts/*.yml` directory. Reasons:

1. One source of truth. Avoids the trap of "term in glossary_terms" vs "term in business-metrics/*.yml" vs "term in concepts/*.yml".
2. Existing CRUD UI lights up for free (with minor extensions to render new fields).
3. Existing chat glossary client picks up new fields without a second loader.
4. Backwards-compatible: existing rows just leave the new columns NULL.

**Migration `009-glossary-concept-tier.sql`** — additive nullable columns:

```sql
ALTER TABLE glossary_terms ADD COLUMN entity_cube TEXT;        -- e.g. 'players'
ALTER TABLE glossary_terms ADD COLUMN entity_pk TEXT;          -- e.g. 'players.user_id'
ALTER TABLE glossary_terms ADD COLUMN default_measure_ref TEXT;-- e.g. 'recharge.revenue_vnd'
ALTER TABLE glossary_terms ADD COLUMN default_filter_json TEXT;-- {"member":"recharge.revenue_vnd","op":">","value":0}
ALTER TABLE glossary_terms ADD COLUMN ranking_json TEXT;       -- {"order":"DESC","default_limit":10}
ALTER TABLE glossary_terms ADD COLUMN trust_tier TEXT;         -- 'certified' | 'experimental' (null = inherits term's status semantics)
```

**Seed extension (concept rows)** added to `server/data/glossary.seed.json`:

```json
{
  "id": "spender",
  "label": "Spender",
  "description": "A user who paid in the period.",
  "primary_catalog_id": "business_metrics/paying_users",
  "aliases": ["spender", "spenders", "payer", "payers", "paying user", "paying users"],
  "label_vi": "Người trả phí",
  "aliases_vi": ["người trả phí", "người chi tiêu", "khách trả phí"],
  "category": "monetisation",
  "entity_cube": "players",
  "entity_pk": "players.user_id",
  "default_measure_ref": "recharge.revenue_vnd",
  "default_filter_json": {"member":"recharge.revenue_vnd","op":">","value":0},
  "ranking_json": {"order":"DESC","default_limit":10},
  "trust_tier": "certified"
}
```

Non-rankable concepts (e.g. "top country") simply omit `entity_*` / `ranking_json` and the resolver routes them to the aggregate path.

**Concept-aware glossary client** (`chat-service/src/nl-to-query/glossary-client.ts`): extend the response parser to surface the new fields. Resolver code reads `entity_cube` to decide leaderboard-path eligibility.

### Resolver behaviour upgrades

- **Exact id match → auto-pin.** `synonym-resolver.ts`: if input matches a business-metric id, concept id, or synonym verbatim (case-insensitive), confidence=1.0; skip ranking step; set `action='auto'`.
- **Fully-qualified ref recogniser.** New helper `recognise-cube-ref.ts`: if input matches `/^[a-z_]+\.[a-z_]+$/` and resolves in `get_cube_meta`, treat as terminal metric with confidence=1.0.
- **Confidence-gated auto-route.** New env `CHAT_GLOSSARY_AUTOROUTE_THRESHOLD` (default 0.8). When best match score ≥ threshold AND gap to second-best ≥ 0.2, return `action='auto'` with an `assumption` field; the skill body renders it as a disclosure footer.
- **Original-intent preservation.** New audit row `intent_preserved` written per clarification cycle; if the model is about to deliver an `explain` answer but the original intent was `query`, raise a system-prompt warning ("user asked to query, not learn — emit an artifact").

### Leaderboard intent path

- When `intent='leaderboard'` AND the message contains a concept with `ranking`: build query as `{ entity, orderBy: default_measure DESC, limit: default_limit, filter: default_filter, timeRange }`. No clarify.
- When concept has no `ranking` (it's just a count): fall back to existing aggregate path.

### Sub-deliverable D — Clarification continuity (intent + concept persist) — *backup to Phase 01*

**Bug observed in session `b93d68e4`:** turn 0 ("top spenders this week") resolved `intent=leaderboard`. Turn 2 ("Revenue") had no memory of that intent because `DisambigResolutions` (the session-memory shape in `disambig-memory-adapter.ts`) only carries `metric / dimension / timeRange / filters`. Memory merge (`disambiguate-memory-merge.ts:68-104`) faithfully bridges those four — but cannot bridge `intent` or `concept` because the slots don't exist. Result: every clarification reply is re-disambig'd as a fresh standalone message; intent + entity context evaporate.

**Primary fix:** Phase 01 (SDK resume) — when the model can see turn 0 in the prompt during turn 2, it naturally infers "Revenue" answers the leaderboard clarification. Thread visibility eliminates this bug class.

**This sub-deliverable is the deterministic backup**: when Phase 01 is flag-off, after compaction reset, or for the disambig pipeline (which runs *before* the model and doesn't see the thread), slot-level continuity keeps resolution sane.

**Fix.** Extend `DisambigResolutions` (and the persisted JSON shape under `kind='disambig_resolution'`):

```ts
interface DisambigResolutions {
  metric?: SlotMemory<string>;
  dimension?: SlotMemory<string>;
  timeRange?: SlotMemory<TimeRangeValue>;
  filters?: Record<string, SlotMemory<string>>;
  intent?: SlotMemory<'leaderboard' | 'aggregate' | 'trend' | 'comparison'>;  // NEW
  concept?: SlotMemory<string>;                                                // NEW (id from concept tier)
  entity?: SlotMemory<{ cube: string; pk: string }>;                           // NEW (derived from concept; cheap to recompute but cached)
  updatedAt?: number;
}
```

Mirror the same plumbing in `fillGapsFromMemory` (read) and `writeConfidentSlotsToMemory` (write). Confidence on read: 0.95, same as existing slots. On write: only when current-turn confidence ≥ 0.7 (avoid persisting flimsy hits).

**Critical write-path change:** today, memory is only written when the disambig outcome is auto OR when individual slots cross the confidence threshold. For intent + concept, **persist even when the overall action is `clarify`** as long as the slot itself was confidently resolved. This is the bug: turn 0 ended in clarify, so nothing about turn 0's intent survived. After this change: turn 0 writes `{intent: leaderboard, concept: spender, timeRange: this week}` to memory even though it asked the user a clarification; turn 2's "Revenue" reads them back and the leaderboard-path (02a sub-deliverable C) fires immediately.

**Persistence handling (decision — Option B with always-disclose):**

Two-tier persistence; intent + concept written to BOTH layers on confident resolution.

- **Session tier (L2 — short-term, high-trust):** `kv_cache(kind='disambig_resolution', key='session:<id>')` row. TTL 7d when row carries intent/concept slots (otherwise 24h). Read back at confidence 0.95 — same as today's metric/dimension/timeRange. Captures "user came back within the week".
- **Cross-session tier (L3 — long-term, lower-trust):** `user_disambig_prefs(owner_id, game_id, slot)` row. Slot string extended with new variants: `'intent' | 'concept' | 'entity'`. No DB migration — `PrefSlot` type in `user-prefs-adapter.ts:18` is the only change. Read back at confidence **0.7** (downgraded vs session tier — preference might have shifted). Captures "user has a recurring analytical ritual for this game".
- **Drift mitigation: ALWAYS-DISCLOSE when source is cross-session.** When the resolver fills a slot from the cross-session pref (no session-tier hit), the resulting `assumption` field on `disambiguate_query`'s response is marked `source: 'cross-session'`. Skill body renders these with a more explicit footer: "Interpreted as **<X>** based on your recent history with this game — reply 'not that' to switch." Never silent-auto. This neutralises stale-pref drift while keeping the cross-session benefit.
- **Write path:** both tiers written in `writeMemoryFromResult` (`disambiguate-memory-merge.ts`). Session tier already exists; cross-session write extends today's `writeConfidentSlotsToUserPrefs` with the three new slot variants. Both writes happen on every confident resolution, including when overall action is `clarify` (the critical bug fix from earlier).
- **Forget UX (phase 03):** Settings panel "Cross-session defaults" list now includes rows for `intent / concept / entity` per game. Per-row delete works as today. "Clear all defaults for this game" wipes intent/concept/entity along with the existing slots.

Why Option B over Option A: per-user, per-game intent/concept captures real signal ("PMs of game X habitually ask leaderboard questions about spenders") and the always-disclose rule makes wrong defaults a one-word fix ("not that") rather than a buried bug. The session tier still handles in-the-moment continuity at higher confidence.

**Expected session shape after fix** (replaying b93d68e4):
- Turn 0 "top spenders this week" → concept-resolver hits `spender` (0.95), leaderboard-path emits artifact with assumption disclosure, OR if concept missing, asks "rank spenders by which measure? **Revenue / LTV / ARPU**" — but persists `{intent: leaderboard, concept: spender, timeRange: this week}` to memory.
- Turn 2 "Revenue" → memory restores `{intent, concept, timeRange}`; current message adds `{metric: Revenue}`; exact-match short-circuit pins Revenue (no siblings); leaderboard-path fires. **Done in 2 turns.**

**Deferred (only if Phase 01 + D leave gaps):** Fix B — explicit pending-clarification state machine. Snapshot the *entire* pre-clarify resolution and the asked slot when emitting a clarify SSE; next turn merges the reply into the snapshot instead of re-disambig'ing the reply text from scratch. Rationale for deferral: Phase 01 thread visibility handles the same edge cases (replies like "yes" / "actually 30d" / "the second one") without adding a new state machine. Revisit only if thread-continuity eval scenarios 1, 3 fail at ≥10% after Phase 01 + D ramp to 100%.

### Disambig tool surface changes

`disambiguate_query` result extended with:

```ts
{
  action: 'auto' | 'clarify',
  query?: CubeQuery,
  assumption?: { slot: 'metric'|'concept'|'entity'|...,
                 chosen: string,
                 phrase: string,
                 confidence: number,
                 alternatives: Array<{ id, score }> },
  clarifications?: [...] // existing
}
```

Skill body updated: when `assumption` is present, emit the result AND a single-line footer "Interpreted *<phrase>* as **<chosen>** (<conf>%). Reply `not that` to switch." Reply parsing: `not that` → re-disambig with the chosen value blacklisted.

## Architecture

```
User: "top spenders this week"
  └─ disambiguate_query
       ├─ recognise-cube-ref         → no match
       ├─ exact-id match             → no match
       ├─ concept resolver (NEW)     → 'spender' concept hit, conf 0.95
       ├─ intent-classifier          → 'leaderboard', conf 0.92
       └─ leaderboard-path (NEW):
            entity     = players
            orderBy    = recharge.revenue_vnd DESC
            limit      = 10
            filter     = recharge.revenue_vnd > 0
            timeRange  = this week
         → action='auto', assumption={ slot: 'concept', chosen: 'spender', conf: 95% }

Skill body
  ├─ preview_cube_query → emit_query_artifact
  └─ final text: "Top 10 spenders this week (interpreted as paying users
                  ranked by revenue, ≥1 VND). Reply 'not that' to switch."

Turns to answer: 1 (was 8).
```

## Related Code Files

**Modify**
- `chat-service/src/nl-to-query/synonym-resolver.ts` (exact-match short-circuit; confidence calc)
- `chat-service/src/nl-to-query/clarification-builder.ts` (leaderboard path with entity resolution)
- `chat-service/src/nl-to-query/intent-classifier.ts` (no logic change; metadata)
- `chat-service/src/tools/disambiguate-query.ts` (return `assumption` field)
- `chat-service/src/cache/disambig-memory-adapter.ts` (extend `DisambigResolutions` with `intent`, `concept`, `entity` slots — sub-deliverable D)
- `chat-service/src/tools/disambiguate-memory-merge.ts` (extend `fillGapsFromMemory` + `writeConfidentSlotsToMemory` to bridge new slots; persist confident intent/concept even when overall action is clarify — sub-deliverable D)
- `chat-service/.claude/skills/explore/SKILL.md` (assumption-disclosure rendering policy; "not that" handling)
- `chat-service/src/db/chat-store.ts` (new audit kind `intent_preserved`)
- `server/src/presets/business-metrics/paying_users.yml` (add `spender, spenders` synonyms)
- `chat-service/src/config.ts` (threshold env)

**Create**
- `server/src/db/migrations/009-glossary-concept-tier.sql` (additive nullable columns)
- `chat-service/src/nl-to-query/recognise-cube-ref.ts`
- `chat-service/src/nl-to-query/concept-resolver.ts` (reads extended glossary client)
- `chat-service/src/nl-to-query/leaderboard-path.ts`
- `chat-service/src/__tests__/concept-resolver.test.ts`
- `chat-service/src/__tests__/leaderboard-path.test.ts`
- `chat-service/src/__tests__/recognise-cube-ref.test.ts`
- `chat-service/src/__tests__/assumption-disclosure.test.ts`
- `chat-service/test/eval/concept-resolution-eval.ts` + fixtures

**Modify (in addition to those above)**
- `server/data/glossary.seed.json` — add 10 seed concept rows (spender, whale, churner, new-spender, dormant-user, top-country, top-item, active-user, returning-user, first-time-payer)
- `server/src/db/glossary-migrate.ts` — handle the new nullable columns in INSERT/UPDATE (idempotent)
- `server/src/routes/glossary.ts` + `glossary-validators.ts` + `glossary-row-mapper.ts` — surface new fields in GET responses + Zod validation on POST/PATCH
- `chat-service/src/nl-to-query/glossary-client.ts` — parse new fields into resolver-friendly shape
- `src/pages/Catalog/glossary/glossary-edit-form.tsx` + `glossary-row.tsx` — render new fields (collapsed "Concept ranking config" sub-panel; visible only when `entity_cube` set)

**NOT created (the dropped duplicate path)**
- ~~`server/src/presets/concepts/*.yml`~~ — replaced by glossary_terms extension
- ~~`server/src/loaders/concept-loader.ts`~~ — `glossary-migrate.ts` handles it
- ~~`server/src/routes/concepts.ts`~~ — existing `/api/glossary` is the API
- ~~`chat-service/src/tools/list-concepts.ts` + `get-concept.ts`~~ — existing `list_business_metrics` is sufficient if extended to surface glossary-term link; the resolver consumes glossary client directly

## Implementation Steps

1. **Prod-session audit (1 day, before any code).** Sample 200 recent prod chat sessions; tag each with `(intent, concept, outcome, turns-to-answer)`. Produce: (a) the actual list of user-spoken concepts (to seed concept YAMLs), (b) baseline distribution of `turns-to-answer`.
2. **Schema migration `009-glossary-concept-tier.sql`:** additive nullable columns on `glossary_terms`. Test idempotency: re-run boot, schema stable.
3. **Loader update:** extend `glossary-migrate.ts` INSERT/UPDATE to handle the new columns; preserve user-edited-row immunity (existing `source='seed' AND editor_name IS NULL` rule).
4. **Seed 10 concepts** in `server/data/glossary.seed.json`: spender, whale, churner, new-spender, top-country, top-item, active-user, returning-user, first-time-payer, dormant-user. **All `trust_tier: 'certified'`** day 1 (per locked decision). Reviewed by a PM/analytics partner before merge.
5. **API + validators:** extend `glossary.ts` route + `glossary-validators.ts` Zod schema + `glossary-row-mapper.ts` to round-trip the new fields.
6. **`recognise-cube-ref.ts`** with cube-meta validation. Unit tests for `recharge.revenue_vnd`, `recharge.revenue`, junk inputs.
7. **`concept-resolver.ts`**: phrase → concept entry with confidence. Reuses existing synonym matching internals but with the exact-match short-circuit.
8. **`leaderboard-path.ts`**: builds the CubeQuery from a concept + timeRange. Called only when `intent='leaderboard'` AND resolved concept has `ranking`.
9. **`synonym-resolver.ts` upgrade**: insert exact-id short-circuit at the top; confidence-gated auto-route in the ranking step.
10. **`disambiguate-query.ts`**: thread `assumption` through; new audit kinds (`concept_resolved`, `assumption_applied`).
11. **FE CRUD updates:** `glossary-edit-form.tsx` + `glossary-row.tsx` show a collapsed "Concept ranking config" sub-panel; visible only when `entity_cube` is set. PM-friendly editing surface for the seed catalog post-deploy.
12. **Skill body updates** in `explore/SKILL.md`: assumption-disclosure rendering; "not that" recognition; "preserve original intent" reminder.
13. **Phase 02 focus-store integration**: when concept resolves, write `last_concept` to focus alongside `last_metric`. Phase 03 chip displays it.
14. **Eval suite:** `concept-resolution-eval.ts` with the 7 cases from the analysis report + cases from step 1's prod audit. Pass criterion: `turns_to_answer ≤ 2` AND `entity + measure correct`.
15. **Ramp gate:** flag goes to 100% only after eval pass rate ≥85% on a 50-case suite.

## Todo List

MVP (this session — landed):

- [x] Migration `015-glossary-concept-tier.sql` (additive columns; renumbered from 009 because that slot was taken by anomalies)
- [x] `glossary-migrate.ts` handles new columns; idempotency preserved by existing `source='seed' AND editor_name IS NULL` guard
- [x] Seed 10 concept rows in `glossary.seed.json` (`trust_tier: certified`) — spender, whale, churner, new-spender, dormant-user, top-country, top-item, active-user, returning-user, first-time-payer
- [x] `glossary.ts` route + validators + row mapper updated (Zod schema constrains filter ops to safe allowlist)
- [x] `glossary-client.ts` (chat-service) parses new fields onto `OfficialTerm`
- [x] `paying_users.yml` synonyms expansion (`spender, spenders`)
- [x] `recognise-cube-ref.ts` + 10 tests
- [x] `concept-resolver.ts` + 15 tests
- [x] `leaderboard-path.ts` + 10 tests
- [x] `synonym-resolver.ts` exact-match short-circuit (`findExactMatch`) + 6 tests
- [x] Confidence-gated auto-route threshold env (`CHAT_GLOSSARY_AUTOROUTE_THRESHOLD`)
- [x] `CHAT_GLOSSARY_V2` flag added to config
- [x] `disambiguate-query.ts` returns `assumption`; flag-gated v2 resolver layer (3 short-circuits) + 3 integration tests
- [x] `explore/SKILL.md` updates (disclosure + "not that" + preserve-intent reminder)

Carved into follow-up sub-phases:

- [ ] **02a-Audit:** Prod-session audit (200 sessions → concept list + baseline turns-to-answer) — operational, requires prod data access
- [ ] **02a-FE:** FE `glossary-edit-form.tsx` + `glossary-row.tsx` render new fields (collapsed "Concept ranking config" sub-panel when `entity_cube` set)
- [ ] **02a-D:** `DisambigResolutions` extended with `intent`, `concept`, `entity` slots (sub-deliverable D)
- [ ] **02a-D:** Memory merge bridges new slots in BOTH tiers (session + cross-session); writes confident intent/concept on clarify outcomes
- [ ] **02a-D:** `PrefSlot` type extended in `user-prefs-adapter.ts` with new variants
- [ ] **02a-D:** Cross-session reads tagged `source: 'cross-session'` on `assumption` field; skill body renders explicit-history disclosure footer
- [ ] **02a-D:** Phase 03 settings page lists intent/concept/entity in cross-session defaults (cross-ref to phase 03)
- [ ] **02a-D:** Replay test of session `b93d68e4`: assert intent + concept survive the clarify→reply boundary
- [ ] **02a-D:** Cross-session round-trip test: turn 0 writes pref → fresh session same (user, game) reads pref with confidence 0.7 + always-disclose
- [ ] **02a-E:** `concept-resolution-eval.ts` (≥50 cases) + judge harness using `evalJudgeModel`
- [ ] **02a-E:** Staging ramp + eval gating to 100%
- [ ] **02a-FE:** Phase 02 focus-store integration (`last_concept`) — requires phase 02 to land first
- [ ] **02a-FE:** Doc the concept catalog in `docs/glossary-v2.md` (separate, brief)
- [ ] Deferred indefinitely: `list_concepts` + `get_concept` MCP tools — existing `list_business_metrics` + glossary client cover the same surface; revisit only if eval shows gaps

## Success Criteria

- The session-`b93d68e4` regression set ("top spenders this week" + 6 variants) resolves in ≤2 turns with correct entity + measure.
- Concept-resolution-eval pass rate ≥85% on the 50-case suite.
- Fully-qualified cube refs (`recharge.revenue_vnd`) NEVER trigger disambig.
- Exact business-metric id matches NEVER surface siblings.
- Assumption-disclosure footer appears on ≥30% of replies after ramp (proves the threshold is doing work, not too conservative).
- Median `turns_to_answer` drops by ≥40% on prod, measured against the audit baseline from step 1.

## Risk Assessment

- **R1 RESOLVED — Concept tier was at risk of becoming a third source of truth.** Mitigated by extending `glossary_terms` table (existing) instead of creating `concepts/*.yml`. Concept entries reference business-metrics + cube refs via existing `primary_catalog_id` + new `default_measure_ref`; never duplicate definitions. `glossary-migrate.ts` validates references at boot.
- **R2 Assumption disclosure trains users to ignore footers.** Mitigation: only show when confidence is in the 0.8–0.95 band (high-confidence = silent auto, low-confidence = clarify). Tune via eval.
- **R3 Concept content quality** drives the whole win. Mitigation: PM/analytics partner reviews YAMLs before merge; concept list grows organically from prod audit, not from agent intuition.
- **R4 Wrong concept = wrong answer with assumption disclosure** — user has to read footer to notice. Mitigation: "not that" is a one-word fix; phase 03 chip surfaces the assumed concept; phase 09 eval tracks false-positive concept matches separately.
- **R5 Leaderboard-path edge cases**: "top countries by revenue" — concept is "top-country" (non-rankable entity but aggregable). Distinct from "top spenders" (entity-rank). Need clear YAML field semantics to keep both paths sane.

## Security Considerations

- Concept YAMLs are server-side presets — same trust model as business-metrics.
- No new user-input surface; concept resolution runs on the same input that disambig sees today.
- `default_filter` could leak data if misconfigured (e.g. `revenue_vnd > 0` is safe; arbitrary user-filtering is not). Constrain filter ops to a safe allowlist (`> >= < <= = != IN`).

## Dependencies

- **Blocks:** ramp of phase 02 focus store (focus needs `last_concept` slot from this phase to be most useful).
- **Blocked by:** none. Can start day 1 of revamp.
- **Pairs with:** phase 07 (nl-to-query decomposition) — `list_concepts` / `get_concept` are exactly the decomposed tools phase 07 envisioned. Merging the work avoids double-implementation.

## Next Steps

- Phase 02 picks up `last_concept`.
- Phase 03 chip displays concept (`● Spenders · this week · top 10`).
- Phase 07 reduces in scope (concept tools moved here); kept for `parse_date_range` only.
- Phase 09 eval suite extended with concept-resolution cases.
