# Phase 05 — chat-service nl-to-query engine

## Context Links

- Cube meta cache: `chat-service/src/core/cube-meta-cache.ts` (`getMeta`, `extractMemberNames`)
- Existing pre-flight: `chat-service/src/tools/preview-cube-query.ts:78-94` (`metric_draft` error pattern)
- Glossary HTTP (phase-01): `GET /api/glossary?status=official` with ETag
- Types: `chat-service/src/types.ts` (`ToolContext`)
- Config: `chat-service/src/config.ts`

## Overview

- Priority: P1 (core feature; blocks 06 + 08).
- Status: pending.
- New module `chat-service/src/nl-to-query/`. Pure functions + a thin orchestrator. Given a raw VI/EN/code-switched message and Cube `/meta`, produces a partial `CubeQuery` + slot confidences + clarification proposals.

## Key Insights

- Engine must be **deterministic and unit-testable** — no LLM calls inside. The LLM consumes the engine's output and decides whether/how to ask.
- Official-only glossary read: chat-service must call `/api/glossary?status=official` (not local DB). 30s TTL cache in this module.
- VI tokenisation: Vietnamese is space-segmented at word boundaries but multi-syllable terms ("doanh thu", "người dùng trả phí") need phrase matching. Use **longest-match-first** over a precomputed alias trie (or simply a length-sorted alias list — KISS for ~100 terms).
- Numbers: "10tr" / "10 triệu" / "10tr5" / "10.5tr" / "1tỉ" → integers. "3 tháng qua" / "tuần trước" / "Q1 2026" → time ranges.
- Confidence model (KISS): score per slot ∈ [0,1]; overall = min of present slots' scores. Provisional weights — tuned in phase-08.

## Requirements

### Functional

The exported orchestrator `disambiguate(input, ctx) → DisambiguationResult` produces:

```ts
interface DisambiguationResult {
  query: Partial<CubeQuery>;   // measures/dimensions/timeDimensions/filters/order/limit
  slots: {
    metric:     { value?: string; alias?: string; confidence: number };
    dimension?: { value?: string; alias?: string; confidence: number };
    timeRange?: { value?: string|[string,string]; granularity?: string; confidence: number };
    filters?:   Array<{ member: string; op: string; values: string[]; confidence: number }>;
    comparison?:{ value?: string; confidence: number };
  };
  unresolved: string[];        // raw spans we could not map
  clarifications: Array<{
    slot: string;
    question_en: string;
    question_vi: string;
    options?: Array<{ value: string; label_en: string; label_vi: string }>;
  }>;
  overallConfidence: number;
  language: 'vi'|'en'|'mixed';
}
```

Sub-components:

1. **language-detector** — character class + diacritics ratio → vi / en / mixed.
2. **synonym-resolver** — given lowercased message, finds longest-match glossary aliases (EN + VI), returns hits with `{termId, canonicalCubeRef, span, confidence}`. Confidence: exact = 1.0, partial overlap = 0.8, fuzzy edit-1 = 0.6 (only on tokens ≥5 chars).
3. **number-normaliser** — locale-aware. VI suffixes: `k|nghìn`→1e3, `tr|triệu`→1e6, `tỉ|tỷ`→1e9, `m`→1e6 EN. Decimals: `10.5tr`→10_500_000. Handles "1.000" → 1000 only when in VI context (no `.0–.9` decimal suggestion nearby AND no English context); otherwise treat as decimal. Document ambiguity case.
4. **date-resolver** — relative ("hôm nay", "hôm qua", "tuần trước", "7 ngày qua", "3 tháng qua", "Q1", "quý 1 2026", "tháng 3", "last 30 days") → `dateRange` string or tuple. Use `chat-service` server clock; ctx may carry a `now` override for tests.
5. **slot-extractor** — runs language detection, then synonym-resolver, number-normaliser, date-resolver in sequence over the message; assembles slots; lowest-confidence slot drives overall.
6. **query-composer** — maps slots to `CubeQuery` shape (measures from metric.value, timeDimensions from timeRange + a default dimension matching metric's domain).
7. **clarification-builder** — emits at most ONE clarification per call (the lowest-confidence slot below threshold). Bilingual question + (when applicable) up to 4 enumerated options.
8. **mode-gate** — given `mode` and `overallConfidence`, returns `{ action: 'auto'|'clarify' }`. Threshold `CONFIDENCE_AUTO_THRESHOLD = 0.75` from `config.ts`, env-overridable as `CHAT_DISAMBIG_AUTO_THRESHOLD`.

### Non-functional

- No file >180 LOC. Aim ~120 LOC each.
- Pure functions, no I/O except synonym-resolver's glossary fetch (cached).
- Vitest-friendly: each sub-module a default export + named pure helpers.
- Glossary cache TTL = 30s; LRU bound = 1 (single shared glossary).

## Architecture

```
disambiguate(input, ctx)
  ├─ language-detector
  ├─ glossary-fetch (Official-only, 30s cache, ETag)
  ├─ synonym-resolver (longest-match alias trie)
  ├─ number-normaliser
  ├─ date-resolver
  ├─ slot-extractor (combines above)
  ├─ query-composer (slots → CubeQuery)
  └─ clarification-builder + mode-gate → final DisambiguationResult
```

Data flow: message → language → tokens → aliases → slots → query+clarifications.

## Related Code Files

### Modify

- `chat-service/src/config.ts` — add `disambigAutoThreshold` from `CHAT_DISAMBIG_AUTO_THRESHOLD` (default 0.75).
- `chat-service/src/types.ts` — extend `ToolContext` with optional `now?: () => number` (test override).

### Create — under `chat-service/src/nl-to-query/`

- `index.ts` (≤80 LOC) — barrel + orchestrator `disambiguate()`
- `types.ts` (≤100 LOC) — interfaces above
- `language-detector.ts` (≤60 LOC)
- `glossary-client.ts` (≤120 LOC) — fetch + 30s cache + ETag handling against the Fastify app
- `synonym-resolver.ts` (≤180 LOC)
- `number-normaliser.ts` (≤160 LOC)
- `date-resolver.ts` (≤180 LOC)
- `slot-extractor.ts` (≤160 LOC)
- `query-composer.ts` (≤140 LOC)
- `clarification-builder.ts` (≤120 LOC)
- `mode-gate.ts` (≤40 LOC)

### Delete

- None.

## Implementation Steps

1. Add config knob `disambigAutoThreshold`.
2. Write `types.ts` (the interfaces above).
3. Implement `language-detector.ts` — pure heuristic over diacritics + ASCII ratio.
4. Implement `glossary-client.ts` — `getOfficialGlossary()` returns cached terms; uses `If-None-Match`; refreshes only when ETag changes; bounds: 30s hard refresh anyway.
5. Implement `synonym-resolver.ts` — build `Alias[]` sorted by length desc; scan message via running window; longest-match-wins. Exposes `resolveTerms(message, glossary) → Hit[]`.
6. Implement `number-normaliser.ts` — regex-based parser for `\d+(?:[.,]\d+)?(tr|triệu|tỉ|tỷ|k|nghìn|m)?` plus optional `/tháng`, `/ngày` suffixes returning `{value, perPeriod?}`.
7. Implement `date-resolver.ts` — handles fixed VI/EN phrases listed above; returns Cube `dateRange`. Use `ctx.now?.() ?? Date.now()`. ISO YYYY-MM-DD format.
8. Implement `slot-extractor.ts` — orchestrates 4-6 above; produces `slots`.
9. Implement `query-composer.ts` — given slots + cube-meta-cache `extractMemberNames`, validate refs; refs missing from `/meta` reduce metric.confidence to ≤0.5 (signals fallback to clarification).
10. Implement `clarification-builder.ts` — picks lowest-confidence slot under threshold; bilingual question text from templates; options sourced from glossary or Cube meta (top-K dimensions by name affinity).
11. Implement `mode-gate.ts` — `gate({ mode, overall }) → 'auto'|'clarify'`.
12. Implement `index.ts` orchestrator + barrel exports.

## Todo List

- [ ] config threshold added
- [ ] types defined
- [ ] language-detector
- [ ] glossary-client with ETag
- [ ] synonym-resolver longest-match
- [ ] number-normaliser (VI + EN + ambiguity rule)
- [ ] date-resolver
- [ ] slot-extractor
- [ ] query-composer
- [ ] clarification-builder bilingual
- [ ] mode-gate
- [ ] orchestrator + barrel

## Success Criteria

- Calling `disambiguate('doanh thu của paying user trong Q1 2026')` returns:
  - `slots.metric.value` = revenue cube ref
  - `slots.filters` includes paying-user filter
  - `slots.timeRange.value` = `['2026-01-01','2026-03-31']`
  - `overallConfidence ≥ 0.75`
  - `language === 'vi'`
- Calling `disambiguate('show DAU last 7 days')` returns EN equivalent.
- Calling `disambiguate('show metric')` returns clarification w/ ≥2 options.
- Engine never throws on malformed input — returns low-confidence result instead.

## Risk Assessment

- **R5.1**: Threshold 0.75 is a guess — phase-08 tunes against eval set; document calibration date.
- **R5.2**: Longest-match-wins fails on overlapping aliases ("user" inside "paying user"). Resolved by sorting alias list by length desc + greedy scan.
- **R5.3**: Date phrases collide with metric phrases ("D7" — is it day-7 retention or 7 days?). Heuristic: D + digit + (retention|ret) → metric; else day count.
- **R5.4**: Glossary cache TTL vs. "Official" toggle in UI → up to 30s lag. Acceptable. Document.
- **R5.5**: `1.000` ambiguity — when language='vi' and no decimal context within ±3 tokens → thousand separator; else decimal. Surface chosen interpretation in a `warnings[]` array on the result.

## Security Considerations

- Engine performs no shell/exec/SQL — pure string ops + HTTP GET to internal API.
- Glossary client must validate response shape (zod) before use; never trust `aliases` arrays exceeding 20 entries.
- Regexes must be ReDoS-safe — favour bounded `\d{1,15}` not unbounded `\d+`.

## Next Steps / Dependencies

- Phase 06 wraps `disambiguate()` in a tool + updates intent router + SKILL.md.
- Phase 08 builds eval set to tune `CONFIDENCE_AUTO_THRESHOLD`.

## Open questions (engine-specific)

- Q5.1: For ambiguous metric ("revenue" — gross? net? ARPU?), do we ask immediately or auto-pick gross? **Default plan**: clarify with options (do not auto-pick). Confirm with user before phase-08 eval.
- Q5.2: Should the engine attempt fuzzy match on dimension values (game titles, country names) or strictly exact? **Default plan**: exact-only for filters (avoids "Vietnam vs Việt Nam" silent merge). Reconsider after eval.
