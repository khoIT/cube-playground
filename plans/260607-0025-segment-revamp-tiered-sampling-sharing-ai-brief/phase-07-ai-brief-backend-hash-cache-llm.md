---
phase: 7
title: "AI brief backend (hash + cache + LLM)"
status: pending
priority: P1
effort: "1.5d"
dependencies: []
---

# Phase 7: AI brief backend (hash + cache + LLM)

# Context
cube-advisor idea `5aefe808-3af3-4296-99ac-bdf1a251a3df` (accepted, impact 5 / effort 3 /
confidence 4). Mockup: `plans/reports/advisor-5aefe808-…-design.html`.

## Overview
`GET /api/segments/:id/brief?lang=` — server-cached LLM executive narrative per
`(definition_hash, lang)`. Gateway assembles structured enrichment context (reusing the
already-cached card data where possible), chat-service runs a one-shot completion with a
hardcoded output schema, gateway stores + serves.

## Requirements
- Functional: brief = `{ label: enum, narrative: 3-4 sentences, signals: string[2-3],
  data_coverage: 'full'|'limited', generated_at, member_count, definition_hash }`; label enum
  exactly: `high_value_churn_risk | upsell_candidate | engaged_non_payer |
  healthy_growth_cohort | new_user_wave`; business language only (no SQL/Cube member names);
  viewer language (en/vi); cache hit returns instantly; definition change → regenerate.
- Non-functional: single-flight per (segment, lang) — no LLM stampede; LLM failure → cached
  `status='error'` + retryable; never block segment GET (brief is its own endpoint).

## Architecture
- **`server/src/services/segment-definition-hash.ts`**: sha256 over
  `JSON.stringify({ predicate_tree_json, cube, game_id, type })` (+ uid-list hash for manual
  segments), sliced 16 (pattern: `card-cache-store.ts:30-32`). Exported standalone — snapshot
  plan 260604-2319 Phase 1 must consume this util (pointer added there).
- **Migration `035-segment-brief-cache.sql`**:
  `segment_brief_cache(segment_id TEXT, lang TEXT, definition_hash TEXT, brief_json TEXT,
   status TEXT, error TEXT, generated_at DATETIME, PRIMARY KEY (segment_id, lang))`.
- **Context assembly** (`server/src/services/segment-brief-context.ts`):
  1. Segment meta: name, game, type, member count, predicate **summarized to plain conditions**
     (dimension label + operator + value — strip cube prefixes).
  2. Enrichment: reuse fresh `segment_card_cache` rows (lifecycle/composition distributions,
     headline KPIs) — **zero new Cube queries** when card cache is fresh (<36h). If absent/
     stale → run preset `headlineKpis` + lifecycle composition inline (physicalized, 30s cap);
     still failing → `data_coverage='limited'` with predicate-only context.
  3. Tier stats when Phase 1 data present (top/median/bottom LTV) — optional enrichment.
- **chat-service endpoint** `POST /internal/segment-brief`, guarded by
  `buildInternalSecretGate` / `x-internal-secret` header (precedent:
  `chat-service/src/api/internal-stats.ts:38` — that route is GET; this is the first POST
  internal route, gate works identically). Body `{ context, lang }`.
  **LLM call — red-team C1:** do NOT use `defaultCallLlm` (`starter-question-refiner.ts` —
  it deliberately strips `ANTHROPIC_API_KEY`/`ANTHROPIC_BASE_URL` to use local Claude Code
  subscription auth; dev-machine batch only, hangs in prod). Use the **gateway-keyed**
  one-shot pattern from `summariseTitle`
  (`chat-service/src/api/turn/maybe-summarise-title.ts:46-68`): inject
  `config.anthropicApiKey` + `config.anthropicBaseUrl`, model `CHAT_BRIEF_MODEL` env,
  **default sonnet** (gateway key 403s non-sonnet — verified memory), injectable `callLlm`
  dep for tests. Prompt enforces: business language, JSON-only output matching the schema,
  lang-appropriate output; parse+validate, one retry on schema mismatch.
- **Gateway route** `GET /api/segments/:id/brief?lang=`: `guardSegment` read → cache check
  (hash + lang match, status ok) → hit: return; miss: in-process single-flight map →
  assemble context → call chat-service (`chatServiceUrl()` + `x-internal-secret`, 60s
  timeout) → upsert cache → return. Single-flight is per-process (same documented
  single-instance posture as `cron-runner.ts:6` — multi-instance double-generation is
  wasteful, not corrupting; don't over-engineer).
  **`?refresh=1` — red-team M3:** rate-limited 1/segment/lang/10min (matches precompute
  trigger precedent) — otherwise any workspace member could loop refresh and burn the
  quota-capped gateway key.

## Related Code Files
- Create: `server/src/services/segment-definition-hash.ts`, `segment-brief-context.ts`,
  `segment-brief-store.ts`; `server/src/db/migrations/035-segment-brief-cache.sql`
- Create: `server/src/routes/segment-brief.ts` (own route file — keeps segments.ts in bounds)
- Create: `chat-service/src/api/segment-brief.ts` (+ register), prompt in
  `chat-service/src/core/segment-brief-prompt.ts`
- Modify: `chat-service/src/config.ts` (`CHAT_BRIEF_MODEL`), `.env.example`

## Implementation Steps
1. Hash util + tests (stable across key order; manual-segment uid hash; changes on predicate
   edit, not on rename).
2. Migration 035 + brief store (get/upsert/single-flight).
3. Context assembler + tests (card-cache reuse path, inline-query fallback, limited path).
4. chat-service route + prompt + schema validation + retry + tests (mock LLM).
5. Gateway route + tests (auth, cache hit/miss, stale-hash regen, single-flight, refresh
   rate-limit, **unshare-then-fetch → 403/404** (no cached-brief leak after visibility
   revert), upstream down → 502 with cached-stale fallback if present).
6. Wire `INTERNAL_SECRET` env plumbing both directions (already exists for stats — reuse;
   note: distinct from server's own `CUBE_AUTH_INTERNAL_SECRET`, do not confuse).

## Success Criteria
- [ ] First GET generates + caches; second GET serves cache with no LLM call (test-asserted)
- [ ] Predicate edit (hash change) regenerates; rename does not
- [ ] lang=vi yields Vietnamese narrative cached independently of en
- [ ] Non-mf_users game yields `data_coverage='limited'` brief, not an error
- [ ] LLM/parse failure → `status='error'` row; retry endpoint works; segment page unaffected
- [ ] Label always within the 5-value enum (schema validation rejects otherwise)

## Risk Assessment
- **Hash fallback vs snapshot plan**: ours is definition-only (no projection); snapshot plan
  extends, not forks — recorded in both plans.
- **Prompt-injection via segment name/predicate values**: context is data-framed (JSON in a
  fenced block + instruction to treat as data); output schema-validated; worst case = odd
  narrative text, no tool access exists.
- **Token cost**: context ≤ ~2KB structured JSON; one-shot; cached. Negligible vs chat traffic.
