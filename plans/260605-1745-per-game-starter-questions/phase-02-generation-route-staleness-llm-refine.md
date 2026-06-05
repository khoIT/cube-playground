# Phase 02 — Generation Route + Meta-Hash Staleness + LLM Refine

## Context Links
- Plan: [plan.md](plan.md)
- Depends on: [phase-01](phase-01-schema-store-template-engine.md) (store + template engine)
- Route registration: `chat-service/src/index.ts:75-91` (`fastify.register(xRoutes, { db })`)
- Existing route w/ workspace+game read: `chat-service/src/api/turn.ts:88-106`
- Meta + hash: `chat-service/src/core/cube-meta-cache.ts` — `getMeta`, `getMetaVersion`
- LLM call pattern (REUSE): `chat-service/src/api/turn/maybe-summarise-title.ts:42-77` (Agent-SDK `callLlm`, fire-and-forget via `queueMicrotask`)
- Meta trim/char-budget reference: `chat-service/src/tools/get-cube-meta.ts:44-50` (`COMPACT_CHAR_BUDGET = 60_000`)

## Overview
- **Priority:** P2
- **Status:** pending
- **Description:** Add `GET /api/chat/starter-questions`, the meta-hash staleness logic, single-flight guard, and the async LLM refinement pass. The route NEVER blocks on the LLM — it returns the freshest persisted set immediately (template baseline on first hit) and schedules refine in the background.

## Key Insights
- Stale = `storedRow.meta_hash !== getMetaVersion(game, workspace)`. Reuse `getMetaVersion`; do not hash anything new.
- Stale-while-revalidate: a stale row is still SERVED while regeneration runs in the background. Only a hard miss (no row) blocks long enough to run the SYNCHRONOUS template pass (fast, no I/O beyond the already-cached `/meta`).
- LLM must NEVER invent member names. Validate every returned `targetCatalogIds` entry against `extractMemberNames(meta)`; if ANY question references an unknown member, reject the WHOLE LLM set and keep the template baseline (lessons-learned: agent emitting non-existent members strands the user).
- Meta fetch can fail (upstream blip). On failure serve the LAST SAVED set; never delete a good set because a refresh failed (lessons-learned: never glue transient failures into the cache).

## Requirements
### Functional — endpoint
`GET /api/chat/starter-questions`
- Headers: `X-Cube-Workspace` (default `local` upstream), `x-cube-game` (required).
- Response 200:
```jsonc
{
  "questions": [ { "id","text","personaTags":[...],"categoryTags":[...],"targetCatalogIds":[...] } ],
  "source": "static-fallback" | "template" | "llm",
  "status": "template" | "refining" | "llm" | "failed",
  "metaHash": "abc123" | null,
  "generatedAt": 1717560000000 | null
}
```
- `source:'static-fallback'` only when NO row exists AND template gen produced <3 questions (or meta fetch failed with no prior row). The route returns an empty `questions: []` + `source:'static-fallback'` and the FE substitutes its own static 18 (route stays decoupled from FE static list).

### Functional — generation orchestration (`starter-question-service.ts`)
`getOrGenerate(db, { workspace, gameId }): StarterResponse`
1. `row = getSet(...)`. `liveHash = await getMetaVersion(gameId, workspace)` (try/catch).
2. If meta fetch threw: return `row` if present (with its stored fields), else `{source:'static-fallback', questions:[]}`.
3. If `row` && `row.meta_hash === liveHash`: serve `row`; if `row.status !== 'llm'` and no fresh lease, schedule refine. Return immediately.
4. If `row` stale OR no row:
   - Run template pass synchronously: `meta = await getMeta(...)`; `q = buildTemplateQuestions(meta)`.
   - If `q.length >= 3`: `upsertSet(source:'template', status:'refining', metaHash:liveHash, questions:q)`; schedule LLM refine; return template set.
   - Else (`<3`): if stale row exists keep it; else return `static-fallback`.

### Functional — LLM refine (`starter-question-refiner.ts`)
- Single-flight: `if (!tryAcquireRefineLease(db, ws, game, 60_000)) return;` then `queueMicrotask`/async run; `releaseRefineLease` in `finally`.
- Build TRIMMED meta projection (cube/measure/dimension `name`+`title`+`description` only, char budget ≤60k like `get-cube-meta`). Send projection + the template baseline questions as the seed.
- Prompt contract → strict JSON array of `{id,text,personaTags,categoryTags,targetCatalogIds}`.
- Validate: parse JSON (tolerate code-fence wrap); each item: text non-empty; personaTags ⊆ {pm,marketer,analyst}; categoryTags ⊆ {explore,metric_explain,compare,diagnose}; EVERY `targetCatalogIds` ∈ `extractMemberNames(meta)`. Drop invalid items; if <3 valid items remain → reject the whole set, leave `status` from `refining`→`template` (keep baseline). If ≥3 valid → `upsertSet(source:'llm', status:'llm', questions:validated, metaHash:liveHash)`.
- Reuse the exact `callLlm` Agent-SDK wiring from `maybe-summarise-title.ts` (model = a cheap model, e.g. `config.titleModel` or `config.chatModel`; pick `chatModel` for quality, document the choice). Fire-and-forget; failures logged only.

### LLM prompt contract (verbatim shape)
```
System intent: You generate analytical starter questions for a game-analytics chatbot.
Bias toward analyses that end in a SEGMENT/list (win-back, churn-risk payers, VIP outreach).
INPUT:
  available_members: [{cube, member, title, description, kind:'measure'|'dimension'}]   (trimmed)
  baseline_questions: StarterQuestion[]                                                  (from template engine)
RULES:
  - Output ONLY a JSON array. No prose, no code fences.
  - Each item: {id, text, personaTags[], categoryTags[], targetCatalogIds[]}.
  - personaTags ⊆ ["pm","marketer","analyst"]; categoryTags ⊆ ["explore","metric_explain","compare","diagnose"].
  - targetCatalogIds MUST be members copied EXACTLY from available_members (cube.member). NEVER invent a name.
  - 12-18 questions. Improve clarity/business-relevance over the baseline; keep good baseline items.
```

## Architecture — data flow
```
GET /starter-questions (ws,game)
  → service.getOrGenerate
      → getMetaVersion(game,ws)  [reuse, TTL-cached]
      → getSet(ws,game)
      → fresh? serve : (template-sync → upsert → return)
      → schedule refiner (single-flight lease) ──background──▶ getMeta → trim → callLlm → validate → upsert(llm)
```

## Related Code Files
**Create:**
- `chat-service/src/api/starter-questions.ts` (Fastify route plugin)
- `chat-service/src/core/starter-question-service.ts` (getOrGenerate orchestration)
- `chat-service/src/core/starter-question-refiner.ts` (LLM pass + validation + trim projection)
**Modify:**
- `chat-service/src/index.ts` — `await fastify.register(starterQuestionsRoutes, { db })`.

## Implementation Steps
1. `starter-question-refiner.ts`: trim projection builder, prompt builder, JSON parse+validate, single-flight, callLlm reuse. Export `scheduleRefine(db, {workspace, gameId, baseline, deps})`.
2. `starter-question-service.ts`: `getOrGenerate` per the orchestration above.
3. `starter-questions.ts`: read headers (mirror `turn.ts:88-106` for workspace default + game), call service, shape response.
4. Register in `index.ts`.
5. Compile `npx tsc --noEmit`.

## Todo List
- [ ] `starter-question-refiner.ts` (trim ≤60k, prompt, validate-against-meta, single-flight, callLlm reuse)
- [ ] `starter-question-service.ts` (getOrGenerate, stale-while-revalidate, meta-fail → last-saved)
- [ ] `starter-questions.ts` route + registered in `index.ts`
- [ ] LLM set rejected wholesale if any member invalid OR <3 valid
- [ ] `npx tsc --noEmit` clean

## Success Criteria
- Cold (no row): returns `source:'template'` instantly; a refine lease is taken once.
- Second concurrent cold request does NOT take a second lease (single-flight verified in test by checking lease state / call count).
- Stale row (hash changed): old set served immediately, regen scheduled; after regen the new hash is stored.
- LLM returns an invented member → set rejected, baseline retained, `status` not 'llm'.
- Meta fetch throws with an existing row → that row served unchanged (no delete, no throw to client).

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|------------|
| LLM JSON malformed / fenced | H×L | Tolerant parse (strip ```json fences); reject on parse fail → keep baseline |
| Refine lease never released on crash | M×M | Time-boxed lease (`inflight_until`), reclaimable when expired; `finally` release |
| Oversized meta projection blows MCP/output budget | M×M | Hard char budget ≤60k mirroring `get-cube-meta`; names+titles+desc only |
| LLM invents members | M×H | Validate every `targetCatalogIds` against `extractMemberNames(meta)`; reject whole set |
| Double-generate under burst | M×L | `tryAcquireRefineLease` atomic UPDATE WHERE free-or-expired |

## Security Considerations
- Route reads `game` from header `x-cube-game` (matching `getMeta`'s gateway path); the gateway/cube enforces per-user game access on the `/meta` fetch. The endpoint exposes only schema-derived question text, no per-user/PII data — see lessons-learned "game gate keys off header" trap: acceptable here because there is no per-user data read and `getMeta` itself is gated upstream.
- No owner scoping needed: questions are per (workspace, game), identical for all users of that game.

## Next Steps
- Phase 3 adds the main-server proxy + FE fetch hook + empty-hero integration.
