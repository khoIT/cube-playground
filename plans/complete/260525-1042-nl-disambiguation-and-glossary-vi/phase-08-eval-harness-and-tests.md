# Phase 08 — Eval harness + tests

## Context Links

- Engine: `chat-service/src/nl-to-query/` (phase-05)
- Tool: `chat-service/src/tools/disambiguate-query.ts` (phase-06)
- Existing chat-service tests: `chat-service/test/*.test.ts` (Vitest)
- Existing snapshot tests: `chat-service/test/mode-prompts.snapshot.test.ts`
- Glossary seed: `server/data/glossary.seed.json` (phase-07)

## Overview

- Priority: P1 (calibrates threshold + protects regression).
- Status: pending.
- Build a deterministic eval suite of 20-40 NL examples (mix VI/EN/code-switched) with gold-standard partial-Cube-query and clarification expectations. Add unit tests for each engine sub-module. Run in CI alongside existing Vitest.

## Key Insights

- Eval is **offline + deterministic** — no LLM calls, only engine. Calibration of `CONFIDENCE_AUTO_THRESHOLD` derives from this set.
- Two metric families:
  - **Slot-level**: precision/recall on each slot (metric, dimension, timeRange, filter).
  - **Decision-level**: action correctness (auto vs clarify), e2e query match (deep-equal on resolved `query` for items expected to auto-resolve).
- Time-sensitive tests must inject `now` via `ctx.now` (phase-05 added this to `ToolContext`). Fix a synthetic "now" = `2026-05-25T00:00:00Z` for reproducibility.

## Requirements

### Functional

#### Eval corpus

JSON file `chat-service/test/nl-to-query/eval-corpus.json` with entries shaped:

```ts
interface EvalCase {
  id: string;
  message: string;
  language: 'vi'|'en'|'mixed';
  mode: 'targeted'|'aggressive';
  expect: {
    action: 'auto'|'clarify';
    metric?: string;       // canonical cube ref
    dimension?: string;
    timeRange?: string|[string,string];
    filters?: Array<{member:string;op:string;values:string[]}>;
    clarificationSlot?: 'metric'|'dimension'|'timeRange'|'filter'|'comparison';
    minOverallConfidence?: number;   // sanity floor
  };
}
```

Target distribution: 8 VI-only, 8 EN-only, 6 code-switched, 6 ambiguous (must clarify), 2-12 edge cases (numbers, dates, "1.000" ambiguity).

#### Tests

1. `nl-to-query-eval.test.ts` — iterates the corpus; asserts action + slot matches; aggregates pass-rate and prints a summary table. Fails the run on overall pass-rate < 85% in `auto`-expected cases.
2. `synonym-resolver.test.ts` — longest-match wins; alias overlap cases; fuzzy edit-1 gate (only for tokens ≥5 chars).
3. `number-normaliser.test.ts` — VI suffixes; `10tr5`; `1.000` VI-context branch; per-period `5tr/tháng`.
4. `date-resolver.test.ts` — relative VI phrases; Q1/Q2 mapping; `tháng 3` → 2026-03 range; uses injected `now`.
5. `language-detector.test.ts` — diacritic ratio thresholds.
6. `clarification-builder.test.ts` — picks lowest-confidence slot under threshold; bilingual text; option enumeration capped at 4.
7. `mode-gate.test.ts` — combinatorial table over `mode × overallConfidence`.
8. `disambiguate-query.tool.test.ts` — tool-level integration: mocks glossary HTTP, mocks `/meta`, asserts tool output shape + ref-guard fallback to clarify.

### Non-functional

- Vitest config + glob patterns already in place — these tests auto-discover.
- Determinism: no live HTTP; mock glossary client with a fixture file `chat-service/test/nl-to-query/glossary-fixture.json` derived from a snapshot of phase-07 official terms.
- Eval file <250 LOC of JSON; test files <180 LOC each.
- CI runtime budget: full eval suite <5s on developer laptop.

## Architecture

```
eval-corpus.json + glossary-fixture.json + /meta-fixture.json
                            │
                            ▼
       nl-to-query-eval.test.ts   ──▶  pass/fail per case
                                        + summary table (console.table)
                                        + threshold-calibration report
```

The eval prints a calibration report (per mode, count of auto-correct vs clarify-correct at thresholds {0.6, 0.7, 0.75, 0.8, 0.85}) so the team can pick a defensible value. Threshold remains config-driven (env-overridable) — eval doesn't change code, only informs.

## Related Code Files

### Modify

- `chat-service/vitest.config.ts` (if present) — ensure `test/**/*.test.ts` glob covers the new subfolder. Likely no change.

### Create

- `chat-service/test/nl-to-query/eval-corpus.json`
- `chat-service/test/nl-to-query/glossary-fixture.json`
- `chat-service/test/nl-to-query/meta-fixture.json`
- `chat-service/test/nl-to-query/nl-to-query-eval.test.ts`
- `chat-service/test/nl-to-query/synonym-resolver.test.ts`
- `chat-service/test/nl-to-query/number-normaliser.test.ts`
- `chat-service/test/nl-to-query/date-resolver.test.ts`
- `chat-service/test/nl-to-query/language-detector.test.ts`
- `chat-service/test/nl-to-query/clarification-builder.test.ts`
- `chat-service/test/nl-to-query/mode-gate.test.ts`
- `chat-service/test/nl-to-query/disambiguate-query.tool.test.ts`
- `chat-service/test/nl-to-query/calibration-report.ts` (helper invoked by eval test; not a test itself)

### Delete

- None.

## Implementation Steps

1. Snapshot phase-07 official terms → `glossary-fixture.json` (subset sufficient for the eval cases, ~25 terms).
2. Build minimal `meta-fixture.json` listing the cube refs used in eval (`business_metrics.dau`, `business_metrics.mau`, `business_metrics.revenue`, `business_metrics.d7_retention`, etc.).
3. Draft `eval-corpus.json`:
   - VI: "doanh thu hôm qua", "doanh thu Q1 2026", "DAU 7 ngày qua", "tỷ lệ giữ chân D7", "ARPU theo tuần", "người dùng trả phí tháng trước", "so sánh doanh thu Q1 và Q2", "vì sao DAU giảm tuần trước".
   - EN: "show DAU last 7 days", "revenue Q1 2026 by country", "ARPU weekly", "D7 retention", "MAU last 30 days", "stickiness last week", "compare Q1 vs Q2 revenue", "why DAU dropped".
   - Mixed: "doanh thu của paying user trong Q1", "show doanh thu last week", "stickiness 7 ngày qua", "ARPU theo paying user", "D7 retention by quốc gia", "MAU trong tháng 3".
   - Ambiguous (clarify): "show metric", "metric tuần qua", "doanh thu" (no time), "by country" (no metric), "last week", "what is".
   - Edge: "doanh thu 1.000 USD" (VI thousand sep), "revenue 1.000" (EN decimal-leaning), "5tr/tháng", "10tr5", "Q5 2026" (invalid quarter), "D99 retention" (invalid metric).
4. Write `nl-to-query-eval.test.ts` — load fixtures + corpus, run `disambiguate()` per case with injected `now`, assert per case, aggregate summary.
5. Write `calibration-report.ts` — pure function over results emitting a table `{threshold, auto_correct, clarify_correct, total_correct}`. Eval test logs it (not assertion-bound).
6. Write per-module unit tests (synonym, number, date, language, clarification, mode-gate).
7. Write tool-level test that mocks glossary fetch + cube-meta-cache and asserts the tool output shape + ref-guard branch.
8. Run `npm test --workspace chat-service` (or equivalent); iterate threshold once based on calibration table; update `CHAT_DISAMBIG_AUTO_THRESHOLD` default in `config.ts` if needed (record reason in commit body).
9. Update `docs/system-architecture.md` with one-paragraph note about the eval pipeline; bump `docs/project-changelog.md`.

## Todo List

- [ ] eval-corpus.json drafted (20-40 cases per distribution)
- [ ] glossary-fixture.json snapshot
- [ ] meta-fixture.json
- [ ] nl-to-query-eval.test.ts
- [ ] 6 sub-module unit tests
- [ ] tool-level integration test
- [ ] calibration-report helper
- [ ] threshold calibration recorded (pick + rationale)
- [ ] docs updated (architecture + changelog)
- [ ] CI runtime <5s verified

## Success Criteria

- Eval pass-rate ≥ 85% on auto-expected cases; ≥ 90% on clarify-expected cases.
- All sub-module unit tests green.
- Calibration table is printed and committed in the PR description.
- CI green; existing tests untouched.

## Risk Assessment

- **R8.1**: Corpus authored only by Claude → low VI fluency review. Mitigation: flag for native review before merge; mark Q8.1 below.
- **R8.2**: Over-fitting threshold to small corpus. Mitigation: keep threshold env-overridable; commit calibration table for future re-tuning.
- **R8.3**: `now` injection skipped in some test paths — breaks date assertions. Audit: every date-bearing case must pass `now`.
- **R8.4**: Glossary fixture drifts from phase-07 seed. Mitigation: top of fixture has a comment naming the seed version it derived from; eval prints a warning if `glossary.version` differs.

## Security Considerations

- Test fixtures contain no secrets.
- No network calls in tests; mock everything.

## Next Steps / Dependencies

- After landing: add CI gate that prints the calibration table on every PR touching `nl-to-query/` so reviewers see trend.
- Future: extend corpus to 200+ cases over time as users hit edge cases.

## Open questions

- Q8.1: Native VI reviewer required before threshold calibration counts. Who?
- Q8.2: Acceptable pass-rate floor — 85% vs 90% on auto cases? Plan defaults to 85% (matches MVP quality bar). Confirm.
- Q8.3: Do we want a flake-tolerant eval (allow N% slip) or strict equality? Plan defaults to strict equality per-case; aggregate floor is what gates CI.
