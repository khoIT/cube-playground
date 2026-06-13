# Phase 07 — Tests + Docs

## Context links
- Server test pattern: `server/test/cs-ticket-detail-reader.test.ts`, `server/test/segment-cs-tickets-route.test.ts` (vitest; readers tested with injected connector / mocked `runQuery`, routes with Fastify inject).
- Client test pattern: `src/pages/Segments/detail/tabs/__tests__/*.test.tsx`, `src/api/__tests__/*`.
- Docs: `docs/codebase-summary.md`, `docs/system-architecture.md`, `docs/lessons-learned.md`.

## Overview
- **Priority:** P1 (gates merge).
- **Status:** pending.
- Test matrix mirroring existing patterns + docs sync. Prioritize the PURE modules (deterministic-split, scorecard-stats) and the PII boundary — those are correctness-critical and cheap to test.

## Test matrix
| Target | Type | Key assertions |
|---|---|---|
| `deterministic-split.ts` | unit | stable across calls; split ratio ≈ splitPct (±2pp over 1000 uids); arm ∈ {treatment,control} |
| `scorecard-stats.ts` | unit | z-test/CI/lift vs hand-computed fixtures; 0-contact ToT → null/placeholder; tiny-n handled |
| `payer-cohort-reader` | unit | SQL shape (LTV gate + lapse window); empty input short-circuit; uid sanitize; **no PII columns in SQL** |
| `payment-outcome-reader` | unit | agg + series SQL; date pruning present; uid chunking |
| `cs-exposure-reader` | unit | split_part join; window filter; contacted dedup; no PII columns |
| `experiment-store` | unit | CRUD round-trip; status transitions; clear hook |
| `assignment-service` | unit | freeze idempotency (re-run = same counts, no dup rows); draft-only guard |
| `experiments` routes | integration (Fastify inject) | CRUD envelopes; 400 bad game; 404 missing/uid-not-in-arms; write-gate rejects non-editor; scorecard cache; degrade-on-edge-failure |
| work-queue payload | integration | **zero contact-PII fields** (assert allow-list) |
| work-queue / scorecard / list / drilldown pages | component (RTL) | loading/error/empty; renders payload; CSV columns = uid+name only |

## Requirements
- Mirror existing harness (vitest config already in repo; injected connector for readers, `app.inject` for routes, RTL for pages).
- No mocked-DB cheats that mask real behavior; readers tested via stubbed `runQuery` returning fixture rows (matches `cs-ticket-detail-reader.test.ts`).
- All tests pass before merge; do not skip failing tests.

## Related code files
Create:
- `server/test/deterministic-split.test.ts`
- `server/test/scorecard-stats.test.ts`
- `server/test/payer-cohort-reader.test.ts`
- `server/test/payment-outcome-reader.test.ts`
- `server/test/cs-exposure-reader.test.ts`
- `server/test/experiment-store.test.ts`
- `server/test/assignment-service.test.ts`
- `server/test/experiments-route.test.ts`
- `src/pages/Experiments/__tests__/work-queue-page.test.tsx`
- `src/pages/Experiments/__tests__/scorecard-page.test.tsx`
- `src/pages/Experiments/__tests__/experiments-list-page.test.tsx`

Modify (docs):
- `docs/codebase-summary.md` — add Experiment Command Center surface + readers.
- `docs/system-architecture.md` — closed-loop data flow (registry→assign→queue→outcome/exposure→scorecard).
- `docs/lessons-learned.md` — if any non-trivial gotcha surfaces (e.g. pmt column semantics, freshness skew handling).
- `docs/project-changelog.md` / roadmap — feature entry.

## Implementation steps
1. Pure-module tests first (deterministic-split, scorecard-stats) — fastest signal, highest correctness value.
2. Reader tests with stubbed `runQuery` fixtures; assert SQL allow-list (grep PII column names absent).
3. Store + assignment-service tests (in-memory sqlite via `DB_PATH`).
4. Route integration via `app.inject` (auth-disabled dev identity = editor, so write paths exercise; add a non-editor case if harness supports).
5. Component tests (RTL) for the three pages.
6. Run full suites: `npm --prefix server test` + `npm test`. Fix failures (do not skip).
7. Docs sync.

## Todo
- [ ] pure-module unit tests (split, stats)
- [ ] reader tests + PII-allow-list assertions
- [ ] store + assignment-service tests (idempotency)
- [ ] route integration tests (envelopes, gates, cache, degrade)
- [ ] component tests (3 pages, CSV columns)
- [ ] all suites green
- [ ] docs updated

## Success criteria
- Full server + client suites pass.
- PII boundary covered by an explicit failing-if-violated test (work-queue payload + reader SQL).
- Freeze idempotency + stats correctness covered by deterministic fixtures.
- Docs reflect the shipped surface + data flow.

## Risks
| Risk | L×I | Mitigation |
|---|---|---|
| Live-Trino readers hard to unit test | M×M | Stub `runQuery` (existing pattern); SQL-shape + mapping tests, not live calls. |
| Stats fixtures wrong → false confidence | L×H | Hand-compute z-test/CI for a small fixture; cite the formula in test. |
| Flaky route cache test | L×M | Use `__clearScorecardCache()` hook between cases (mirror `__clearCsTicketsCache`). |

## Security (PII)
- The PII allow-list test is the regression guard for the entire feature's compliance boundary — keep it strict (fail if any phone/email/msisdn token appears in payload types or reader SQL).

## Next steps
Feature complete. Backlog (report §4.6): promo-push exposure path, additional hypotheses, CUPED/sequential testing — out of POC scope.
