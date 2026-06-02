# Phase 02 — Unified resolver + contract type + ratio query build

## Context Links
- `chat-service/src/nl-to-query/synonym-resolver.ts:35` — `cubeRef = primaryCatalogId` (bug source)
- `chat-service/src/nl-to-query/slot-extractor.ts:50-67` — `pickMetric` (longest-alias heuristic)
- `chat-service/src/nl-to-query/concept-resolver.ts` — `resolveBestConcept` (to fold in)
- `chat-service/src/nl-to-query/recognise-cube-ref.ts` — `firstCubeRef` (to fold in as boost)
- `chat-service/src/nl-to-query/types.ts:90-107` — `OfficialTerm` (add `measureRef`/`refKind`)
- `chat-service/src/nl-to-query/glossary-client.ts:31-99` — Zod `TermSchema` + map (add fields)

## Overview
- **Priority:** P1 — the consolidation core.
- **Status:** done
- One ranked resolver returns one contract: `{ ref:<cube member>, confidence, gap, alternatives }`.
  The three v2 short-circuits become confidence boosts INSIDE this resolver, not a post-pass.

## Key Insights
- After Phase 01 every measure-backed term carries a cube-member `measureRef`. The resolver pins
  `measureRef` (not `primaryCatalogId`) as `ref` — fixing the root contract mismatch.
- Three signals, unified into confidence (highest wins, no intent gating):
  1. **Fully-qualified cube ref in message** (`firstCubeRef`, validated vs `knownMembers`) → 1.0.
  2. **Verbatim exact** (whole message == id/label/alias) → 1.0. (Was v2 #2; remove
     whole-message restriction's coupling — keep it as a *boost*, not the only auto path.)
  3. **Alias hit ranked by span length + measureRef presence** → 0.85 single clean hit,
     lower when multiple distinct terms tie (→ gap small → clarify).
- Remove `intent==='leaderboard'` gate (`disambiguate-query.ts:244-245`): a high-confidence
  single-token hit auto-routes regardless of intent. Leaderboard remains a query-shape decision
  driven by `intent` slot + concept `ranking` metadata, NOT a precondition for auto-routing.
- **Ratio terms** (`refKind==='ratio'`) → resolver returns the hit with `ref:null` but
  `ratioRef:{numerator,denominator}` so the query-composer builds a two-measure ratio query
  (auto-route, NOT clarify). User decision: full generic — ratios run like measures.
- **Expression/unknown terms** (`measureRef===null && ratioRef===null`) → `ref:null` + `reason`
  so the gate/clarify explains "no single measure".

## Requirements
- Functional: `resolveMetric(message, glossary, knownMembers?)` → `MetricResolution | null`.
- Functional: contract `MetricResolution = { ref: string | null;
  ratioRef: { numerator: string; denominator: string } | null; refKind: 'measure'|'ratio'|'expression'|'unknown';
  termId: string; confidence: number; gap: number; alternatives: Array<{ id; ref; score }>;
  matchedOn: 'cube-ref'|'exact'|'alias'; reason?: string }`.
- Functional: ratio query building — when `refKind==='ratio'`, `composeQuery` emits both members
  in `measures` (numerator + denominator); the FE/skill renders the ratio (the catalog `format`
  drives display). Keep composition in `query-composer.ts`, not the resolver.
- Functional: leaderboard query building stays in `leaderboard-path.ts`; resolver only supplies
  the chosen concept/measure + confidence.
- Non-functional: pure, LLM-free (engine principle, `nl-to-query/index.ts:5`). File <200 LOC.
- DRY: reuse `resolveTerms` (alias scan), `findExactMatch`, `firstCubeRef`, `isConceptTerm`.

## Architecture / Data flow
```
message ─┬─ firstCubeRef(knownMembers) ───────────────→ matchedOn:'cube-ref' conf 1.0
         ├─ findExactMatch(glossary) ──────────────────→ matchedOn:'exact'    conf 1.0
         └─ resolveTerms → rank metric hits by span ───→ matchedOn:'alias'    conf 0.85 / gap
                                                            │
        term.{measureRef|ratioRef|refKind} (Phase 01) ─────┘  measure→ref ; ratio→ratioRef
```
Ratio path: `composeQuery` sees `refKind==='ratio'` → `measures:[numerator,denominator]`; the
result post-processor computes `numerator/denominator` and formats per the catalog `format`.
- New module `chat-service/src/nl-to-query/metric-resolver.ts`.
- `slot-extractor.ts` `pickMetric` delegates to it (passes `measureRef` through as the ref).
- `concept-resolver.ts` retained ONLY for leaderboard concept metadata lookup
  (entity/ranking); its scoring duplicated logic is removed and re-expressed via the unified
  resolver's confidence/gap. (Decide in step 3 whether to delete the file or shrink it.)

## Related Code Files
- **Create:** `chat-service/src/nl-to-query/metric-resolver.ts` (unified ranked resolver + contract).
- **Modify:** `chat-service/src/nl-to-query/types.ts` — add `measureRef`, `refKind` to
  `OfficialTerm`; export `MetricResolution`.
- **Modify:** `chat-service/src/nl-to-query/glossary-client.ts` — Zod `TermSchema` gains
  `measureRef`/`refKind`; map them into `OfficialTerm`.
- **Modify:** `chat-service/src/nl-to-query/synonym-resolver.ts:35` — `cubeRef` becomes
  `t.measureRef ?? t.primaryCatalogId` so alias hits already carry the cube member. (Keep
  `findExactMatch` here; it's reused.)
- **Modify:** `chat-service/src/nl-to-query/slot-extractor.ts:50-67` — `pickMetric` delegates.
- **Modify:** `chat-service/src/nl-to-query/query-composer.ts` — ratio path (two-measure query +
  num/den post-processing); both-members /meta validation.
- **Modify (maybe delete):** `chat-service/src/nl-to-query/concept-resolver.ts` — strip scoring,
  keep concept-metadata lookup, or delete if metric-resolver subsumes it.

## Implementation Steps
1. Extend `OfficialTerm` + glossary-client Zod/map with `measureRef`, `refKind`.
2. Change `synonym-resolver.ts:35` ref source to `measureRef ?? primaryCatalogId`. Document the
   invariant in a comment (WHY: /meta gate accepts cube members only; alias ref must be a member).
3. Create `metric-resolver.ts` with `resolveMetric`. Compose the three signals; compute
   `gap` against the next *distinct* term (reuse concept-resolver gap idea). For ratio terms
   return `ratioRef` + `refKind:'ratio'` (auto-route); expression/unknown → `ref:null` + `reason`.
4. `query-composer.ts`: when the resolved metric is `refKind:'ratio'`, emit both members in
   `measures`; add the ratio post-processing (compute num/den, label from the term) — keep the
   composer pure. Validate BOTH members vs `knownMembers`; if either missing → fall back to clarify.
5. Decide concept-resolver fate: keep a thin `conceptMetadata(termId)` helper for leaderboard
   entity/ranking; remove the duplicate `resolveConcepts` scoring. Update
   `leaderboard-path.ts` callers if signatures change.
6. `pickMetric` → call `resolveMetric`; map result to `ScoredSlot<string>`.
7. Build chat-service (`npm --workspace chat-service run build`) — no type errors.

## Todo List
- [x] `OfficialTerm` + glossary-client carry `measureRef`/`ratioRef`/`refKind`
- [x] `synonym-resolver` ref = measureRef-first
- [x] `metric-resolver.ts` created, contract exported
- [x] cube-ref + exact + alias signals unified into one confidence/gap
- [x] ratio terms → `ratioRef` auto-route; `query-composer` builds two-measure ratio query
- [x] intent gating removed from auto-route decision
- [x] concept-resolver shrunk/retired; leaderboard metadata lookup preserved
- [x] `pickMetric` delegates; chat-service compiles

## Success Criteria
- `resolveMetric("show revenue last 7 days", glossary, members)` → `ref:"recharge.revenue_vnd"`,
  `confidence ≥ 0.85`, `gap ≥ threshold` (single clean hit), `matchedOn:'alias'`.
- `resolveMetric("recharge.revenue_vnd", …)` → `ref` same, `confidence 1.0`, `matchedOn:'cube-ref'`.
- `resolveMetric("revenue", …)` (verbatim) → `confidence 1.0`, `matchedOn:'exact'`.
- `resolveMetric("show retention rate", …)` (ratio) → `refKind:'ratio'`,
  `ratioRef:{numerator:"retention.retained_d7",denominator:"retention.cohort_size"}`; `composeQuery`
  emits both members in `measures` and action auto-routes.
- An expression/unknown term phrase → `ref:null`, `reason` set.
- No module imports an LLM client.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Removing intent gate over-auto-routes ambiguous multi-metric messages | M×H | Keep `gap` guard: ≥2 distinct high-score terms → low gap → clarify (preserves "revenue vs ARPPU" ambiguity). Phase 05 adds a multi-metric clarify case |
| concept-resolver deletion breaks leaderboard tests | M×M | Preserve metadata lookup; run `leaderboard-path.test.ts` + `concept-resolution-eval.test.ts` (Phase 05) |
| Ratio query renders two raw columns instead of a computed rate | M×M | `query-composer` post-processing computes num/den + applies catalog `format`; Phase 05 asserts the composed query + computed value. Expression terms still clarify |
| Two ref sources during migration (measureRef vs primaryCatalogId) drift | L×M | Single fallback expression `measureRef ?? primaryCatalogId` centralized in synonym-resolver + resolver only |

## Security Considerations
- Pure functions; no I/O beyond the already-cached glossary fetch. No injection surface.

## Next Steps
- Phase 03 wires `resolveMetric` into the disambiguate tool and removes `applyGlossaryV2`.
