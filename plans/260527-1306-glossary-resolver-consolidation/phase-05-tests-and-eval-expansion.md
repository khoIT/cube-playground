# Phase 05 — Tests + eval expansion

## Context Links
- `chat-service/test/nl-to-query/eval-corpus.json` — 50-ish gold cases (golds use catalog paths)
- `chat-service/test/nl-to-query/glossary-fixture.json` — fixture (no `measureRef` yet)
- `chat-service/test/nl-to-query/nl-to-query-eval.test.ts:42-45` — `knownMembers` built from
  `primaryCatalogId` (the broken-contract artifact to fix)
- `chat-service/test/tools/disambiguate-query-glossary-v2.test.ts` — v2 short-circuit tests
- `chat-service/test/tools/disambiguate-query-b93d68e4-replay.test.ts` — replay path
- `chat-service/test/nl-to-query/concept-resolution-eval.test.ts` + `concept-resolution-cases.ts`
- `chat-service/test/nl-to-query/synonym-resolver.test.ts`, `slot-extractor` callers

## Overview
- **Priority:** P1 — proves the contract flip end-to-end and prevents regression.
- **Status:** done
- Migrate eval fixture/corpus from catalog-path refs to real cube members; add plain
  metric/timeseries cases; retarget the v2 tests at the unified resolver.
- **Tester owns test files only**; reads impl files, never edits them.

## Key Insights
- The eval currently encodes the BUG: `knownMembers` = set of `primaryCatalogId`
  (`business_metrics.revenue`), golds expect `metric:"business_metrics.revenue"`. After the
  redesign, golds must be `recharge.revenue_vnd` etc., and `knownMembers` must be a real
  member set. This is the largest, most error-prone change — do it deliberately.
- Fixture terms need `measureRef` (+ `refKind`) so the resolver has the member. Add them to
  `glossary-fixture.json` mirroring the Phase 01 server derivation (revenue → recharge.revenue_vnd,
  arpu → mf_users.arpu_vnd, dau/mau via their business_metrics measure refs, paying_user →
  recharge.paying_users).
- New plain-intent cases (the bug this fixes): "show revenue last 7 days", "ARPU yesterday",
  "revenue Q1 2026" (already present — verify gold flips to member), "MAU last month".
- Add a multi-metric ambiguity case that MUST still clarify (guards against over-auto-routing
  from removing the intent gate), e.g. "revenue vs ARPPU" → clarify.
- Add a ratio-term case → **auto-route** with a composed two-measure query (e.g. "show retention
  rate"/"rr07"): assert `action:auto`, `measures` contains both numerator + denominator members,
  and the num/den value is computed. Add a fixture ratio term carrying `ratioRef` if none exists.
- Add an expression/unknown-term case → clarify with reason (the only non-auto glossary path left).

## Requirements
- All existing chat-service tests green (no skips, no fake passes).
- Eval suite 100% (it was 100% per journal §3) after gold migration.
- New cases cover: plain metric, timeseries, multi-metric clarify, ratio auto-route (composed),
  expression clarify, cube-ref, verbatim exact.
- Server tests for Phase 01 `deriveMeasureRef` (measure / ratio / expression / missing / override).

## Architecture / Data flow (test wiring)
```
glossary-fixture.json (+measureRef) ─→ disambiguate(fetch=fixture) ─→ assert metric.value == member
knownMembers = real members (recharge.revenue_vnd, mf_users.arpu_vnd, …)
```

## Related Code Files
- **Modify:** `chat-service/test/nl-to-query/glossary-fixture.json` — add `measureRef`/`refKind`.
- **Modify:** `chat-service/test/nl-to-query/eval-corpus.json` — golds → cube members; add cases.
- **Modify:** `chat-service/test/nl-to-query/nl-to-query-eval.test.ts` — `knownMembers` from
  `measureRef` (real members), not `primaryCatalogId`.
- **Modify:** `chat-service/test/tools/disambiguate-query-glossary-v2.test.ts` — retarget:
  config mock `chatGlossaryV2Enabled`→ removed; assert resolver path (cube-ref/exact/alias) still
  auto-routes; GLOSSARY mock terms gain `measureRef`. Consider renaming file to
  `disambiguate-query-resolver.test.ts` (no plan/finding codes in name).
- **Create:** `chat-service/test/nl-to-query/metric-resolver.test.ts` — contract + signals + gap.
- **Create:** `server/test/glossary-measure-ref-resolver.test.ts` — Phase 01 derivation matrix.
- **Verify (no edit unless gold changed):** `disambiguate-query-b93d68e4-replay.test.ts`,
  `concept-resolution-eval.test.ts`, `synonym-resolver.test.ts`, `leaderboard-path.test.ts`.

## Implementation Steps
1. Add `measureRef`/`refKind` to fixture terms.
2. Rewrite `knownMembers` in the eval test to the real member set.
3. Migrate every corpus gold metric from `business_metrics.<x>` → its cube member; eyeball each.
4. Add plain-intent + multi-metric-clarify + ratio-auto-route (composed) + expression-clarify cases.
5. Write `metric-resolver.test.ts` (unit) and `glossary-measure-ref-resolver.test.ts` (server).
6. Retarget the v2 test file at the unified resolver; drop the flag from its config mock.
7. Run: `npm --workspace chat-service test` and `npm --workspace server test`. All green.
8. Iterate on failures — fix tests/impl per recommendations; do not skip.

## Todo List
- [x] Fixture carries `measureRef`/`refKind`
- [x] Eval `knownMembers` = real members
- [x] Corpus golds migrated to cube members
- [x] Plain-intent cases added (revenue 7d, ARPU yesterday, MAU last month)
- [x] Multi-metric clarify + ratio auto-route (composed) + expression clarify cases added
- [x] `metric-resolver.test.ts` + server resolver test created
- [x] v2 test retargeted/renamed
- [x] chat-service + server suites green; eval 100%

## Success Criteria
- `nl-to-query-eval` passes with member golds; calibration report still printed.
- "show revenue last 7 days" eval case → `action:auto`, `metric:recharge.revenue_vnd`.
- Multi-metric case → `action:clarify` (over-auto-route guard holds).
- Ratio case → `action:auto`, `measures` = [numerator, denominator], computed rate value.
- Expression/unknown case → `action:clarify` with reason.
- Replay + leaderboard + concept evals unaffected.

## Risk Assessment
| Risk | L×I | Mitigation |
|------|-----|-----------|
| Gold migration introduces silent wrong members | M×H | Cross-check each gold against the catalog YAML `formula.ref`; the server resolver test pins the mapping so fixture + server agree |
| Fixture drifts from real seed | M×M | Fixture `_comment` already says "keep in sync"; add a note + the member values from real YAMLs (revenue/arpu/dau/mau/paying_users) |
| Removing flag breaks unrelated tests mocking it | L×M | Grep all `chatGlossaryV2Enabled` mock sites before edit; update together |
| Eval becomes flaky on threshold | L×M | Reuse `chatGlossaryAutorouteThreshold`/`disambigAutoThreshold`; keep gap guard explicit |

## Security Considerations
- Tests only; no runtime surface. No secrets in fixtures.

## Next Steps
- Phase 06 documents the contract change + cache caveat + flag rollback.
