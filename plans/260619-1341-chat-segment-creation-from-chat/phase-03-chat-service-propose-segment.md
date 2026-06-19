# Phase 3 — chat-service: translator + guardrails + propose_segment tool

## Overview
- **Priority:** P1. **Depends:** Phase 1 (`/resolve-cutoff`), Phase 2 (catalog).
- **Status:** pending.
- The conversion engine + tool that turns a chat intent (or last explored query) into a
  draft segment proposal: query→predicate translation, the 3 hard-case handlers, mandatory
  population scoping, propose-time cutoff/size preview, disclosure. chat stays read-only —
  emits a `segment_proposal`, never writes.

## Key insights (verified)
- chat tools live in `chat-service/src/tools/registry.ts`; artifacts emit via SSE
  (`emit-query-artifact.ts` → `ctx.sseEmitter.emit(...)`). Intent via keyword router
  `core/intent-router.ts`; skills + allowlists in `.claude/skills/*/SKILL.md`.
- Last explored query is available via the focus snapshot (turn.ts carries prior resolved
  context) — entry-point #2 ("save that as a segment") reads it.
- Predicate legality (verified): NO measures in predicates; percentile needs server
  resolution (Phase 1); time-leaf inside OR blocks round-trip; relative dates use
  `dateWithinLast {n,unit}` for rolling windows.

## Requirements
**Functional — 3 entry points**
1. Straight in chat → resolve terms → build predicate → propose.
2. After exploration → take last artifact's Cube query → translate filters → propose.
3. From `/build` → existing save-bar (no chat change; optionally a "create segment" CTA).

**Functional — 3 hard-case handlers**
- **Measure threshold** (`revenue>1000`): look up concept in catalog → rewrite to
  `<per-user dim> >= 1000` using the **window-matching** dim; if no window match → disclose +
  offer nearest or decline. Pure `gte` leaf, no cutoff needed.
- **Percentile** (`top 25%`): emit `percentileGte {p:75, over:{table, column, population}}`;
  population defaults to catalog `defaultPopulation` (payers); call `/resolve-cutoff` to
  preview cutoff+size.
- **top-N** (`top 100`): convert to percentile — `count(*)` over population (via
  `/resolve-cutoff` or preview), `p = 100*(1 − N/|pop|)`, then same as percentile. Disclose
  "rolling ~top-N, count drifts".

**Guardrails (reject cleanly, let LLM explain)**
- Measure leaf with no catalog mapping → no silent guess; ask/decline.
- Percentile/top-N with no resolvable population → ask for scope (hard gate; unscoped=wrong).
- order+limit with no measure → cannot segment; offer percentile equivalent.
- time-leaf in OR → restructure or decline.

**Output:** SSE `segment_proposal` `{name, cube, game, predicate_tree(draft), resolved:
{cutoff?, estCount, population}, disclosures: string[], suggestedVisibility}`. No write.

## Architecture
```
intent (router → 'segment' skill | explore w/ propose_segment allowed)
  → LLM resolves terms (existing resolve_query_terms) + reads get_segmentable_measures
  → cubeQueryToPredicateTree(filters)  [guardrailed]
  → classify hard case → build leaf(s) (rewrite / percentile / top-N→percentile)
  → propose_segment handler:
       validate translatability + population
       call POST /api/segments/resolve-cutoff (preview cutoff + est size)
       emit 'segment_proposal' (draft, NO write)
```

## Related code files
**Create**
- `chat-service/src/utils/cube-query-to-predicate-tree.ts` — guardrailed filters→tree. <200 LOC.
- `chat-service/src/tools/propose-segment.ts` — handler (validate, resolve-cutoff, emit).
- `chat-service/src/tools/get-segmentable-measures.ts` — reads Phase-2 catalog via server.
- `chat-service/.claude/skills/segment/SKILL.md` — new skill (system prompt + allowlist).
**Modify**
- `chat-service/src/tools/registry.ts` — register `propose_segment`, `get_segmentable_measures`.
- `chat-service/src/core/intent-router.ts` — segment keywords (EN+VN: create/save segment,
  build audience, tạo phân khúc, lưu nhóm).
- `chat-service/.claude/skills/explore/SKILL.md` — add `propose_segment` to allowed_tools
  (mid-exploration "save that").
- `chat-service/src/api/turn.ts` — pass through `segment_proposal` SSE event; ensure last
  artifact query in focus snapshot.

## Implementation steps
1. `cube-query-to-predicate-tree.ts` with guardrails (reject measures/order-limit/OR-time).
2. Hard-case classifier + leaf builders (rewrite / percentile / top-N→percentile).
3. `get-segmentable-measures` tool (thin client to server catalog).
4. `propose-segment` tool: validate → `/resolve-cutoff` → assemble disclosures → emit.
5. Skill + router keywords + explore allowlist + turn.ts passthrough.
6. Disclosure copy: state the transformation + rolling semantics + population, in EN/VN.

## Todo
- [ ] translator + guardrails (+ unit tests on each reject path)
- [ ] hard-case classifier + 3 leaf builders
- [ ] get_segmentable_measures tool
- [ ] propose_segment tool (resolve-cutoff + emit, NO write)
- [ ] segment skill + router keywords + explore allowlist
- [ ] turn.ts segment_proposal passthrough + focus-snapshot query
- [ ] disclosure strings EN/VN

## Success criteria
- "top 25% spenders cfm_vn" → proposal: predicate `ltv_vnd percentileGte p75 over payers`,
  resolved cutoff ≈ 744k₫, estCount ≈ 59,600, disclosures present. No segment written.
- "save that as a segment" after an explore turn reuses the last query's filters.
- Measure-threshold with mismatched window → disclosure + nearest-dim offer, not a wrong leaf.
- Unscoped percentile ask → chat asks for population, does not emit p over all users.

## Risk assessment
- LLM may skip `get_segmentable_measures` and hand-roll a wrong member → tool handler
  re-validates member against catalog; reject if not a known segmentable dim.
- Token cost of catalog in prompt → expose via tool call, not static prompt injection.

## Security / correctness
- chat never writes — eliminates write-credential surface in chat-service.
- `propose_segment` re-validates population presence server-side at confirm (Phase 1
  rejects unscoped) — defense in depth.

## Next steps
- Phase 4 renders the proposal + performs the POST on confirm.
