# Phase 09 — Test Coverage Uplift

## Context Links

- SDK review §3.#5 — test coverage for claude-runner
- `chat-service/src/core/claude-runner.ts` (214 LOC, no tests today)
- `chat-service/src/core/skill-loader.ts` (no tests today — partially addressed in Phase 00)
- `chat-service/src/core/mode-prompts.ts` (no tests today)

## Overview

- **Priority:** P3 — runs in parallel with all earlier phases as code lands
- **Status:** **Partial.** Unit tests landed organically alongside the other phases — `intent-router`, `sse-stream`, `session-manager`, `stream-registry`, `compact-service`, `claude-runner`, `mode-prompts` all have tests (chat-service 710 tests across 89 files). Eval harness, fixture suites, `@vitest/coverage-v8` install + threshold gate, and nightly CI cron are deferred to a follow-up session.
- **Description:** Bring `src/core/*.ts` to ≥80% line coverage. Add canned anaphora eval set + tool-misuse eval set used by phases 01, 02, 06, 07. Tests are the safety net for the refactors in phases 01, 04, 05.

## Key Insights

- Many phases land their own unit tests; this phase fills the gaps for files that aren't touched directly (e.g. `intent-router.ts`, `compact-service.ts` edge cases).
- Eval sets ≠ unit tests: kept under `chat-service/test/eval/` with their own fixtures + scoring helpers. They run nightly, not on every PR.
- Coverage tooling already configured via vitest (`vitest.config.ts`).

## Requirements

**Functional**
- Unit tests for: `claude-runner.ts`, `skill-loader.ts`, `mode-prompts.ts`, `intent-router.ts`, `compact-service.ts`, `session-manager.ts`, `stream-registry.ts`, `sse-stream.ts`.
- Coverage gate: `src/core/*.ts` ≥80% lines, ≥75% branches (CI fails below).
- Eval sets (run nightly, not blocking — except where flagged as PR-gate):
  - **`eval/thread-continuity-eval.ts`** (PR-gate scenarios 1-4) — owned by phase 01; the 10-scenario suite is the contract for "agent has access to everything said".
  - **`eval/concept-resolution-eval.ts`** (PR-gate when 02a flag on) — 50 cases including session b93d68e4 regression; owned by phase 02a.
  - `eval/anaphora-eval.ts` — "now by country" / "why" / "compare to" follow-ups (subset of thread-continuity; lighter, faster).
  - `eval/tool-misuse-eval.ts` — model picks wrong tool, calls in wrong order, retries excessively (phase 07).
  - `eval/disambig-pivot-eval.ts` — user changes topic mid-session; focus store must overwrite, not append (phase 02).
- Eval scoreboard published to a dashboard (Langfuse or in-repo HTML).

**Non-functional**
- Unit suite runs <30s locally.
- Eval suite may take minutes; only nightly.
- Tests use deterministic fixtures (mocked SDK iterator, fake clocks).

## Architecture

```
chat-service/
  src/__tests__/
    claude-runner.test.ts             (filtering, observer dispatch, abort path)
    intent-router.test.ts             (slash routing, tie-breaks, vi/en keywords)
    mode-prompts.test.ts              (compose order, focus injection, fallback)
    compact-service.test.ts           (threshold, summary preamble, focus port)
    session-manager.test.ts           (mutex acquire, tryAcquire, release on throw)
    stream-registry.test.ts           (overflow, abort wiring)
    sse-stream.test.ts                (event mapping fidelity)
  test/eval/
    anaphora-eval.ts
    tool-misuse-eval.ts
    disambig-pivot-eval.ts
    fixtures/
      anaphora-cases.json
      tool-misuse-cases.json
      disambig-pivot-cases.json
    score-helpers.ts
    run-eval.ts                       (CLI entry; --suite=anaphora etc.)

CI
  - Unit: every PR.
  - Eval: nightly cron; results posted to dashboard + summary commented on main.
  - Coverage gate: src/core/*.ts ≥80%.
```

## Related Code Files

**Modify**
- `chat-service/vitest.config.ts` (add coverage thresholds)
- `chat-service/package.json` (new scripts: `test:eval`, `test:eval:anaphora`)
- `.github/workflows/...` (add nightly eval job)

**Create**
- `chat-service/src/__tests__/claude-runner.test.ts`
- `chat-service/src/__tests__/intent-router.test.ts`
- `chat-service/src/__tests__/mode-prompts.test.ts`
- `chat-service/src/__tests__/compact-service.test.ts`
- `chat-service/src/__tests__/session-manager.test.ts`
- `chat-service/src/__tests__/stream-registry.test.ts`
- `chat-service/src/__tests__/sse-stream.test.ts`
- `chat-service/test/eval/run-eval.ts`
- `chat-service/test/eval/score-helpers.ts`
- `chat-service/test/eval/anaphora-eval.ts`
- `chat-service/test/eval/tool-misuse-eval.ts`
- `chat-service/test/eval/disambig-pivot-eval.ts`
- `chat-service/test/eval/fixtures/anaphora-cases.json`
- `chat-service/test/eval/fixtures/tool-misuse-cases.json`
- `chat-service/test/eval/fixtures/disambig-pivot-cases.json`

## Implementation Steps

1. Audit current coverage: `vitest run --coverage`. Record baseline per file.
2. Add coverage thresholds to `vitest.config.ts` (`src/core/*.ts: 80% lines, 75% branches`).
3. Land tests file-by-file, smallest first:
   - `intent-router.test.ts` — pure function, easy first kill.
   - `session-manager.test.ts` — exercise mutex contention.
   - `stream-registry.test.ts` — overflow, abort.
   - `sse-stream.test.ts` — exhaustively map SDK message types.
   - `mode-prompts.test.ts` — compose order; focus injection (depends Phase 02 shipped).
   - `compact-service.test.ts` — threshold, preamble, focus port (depends Phase 02).
   - `claude-runner.test.ts` — mock SDK iterator; verify allowedTools filter, observer dispatch, abort honour (depends Phase 04).
4. Build eval harness:
   - `run-eval.ts` CLI: `--suite=anaphora|tool-misuse|disambig-pivot`.
   - Each case is `{ messages: string[], expect: { focus_keys?, anaphora_resolved?, max_tool_calls? } }`.
   - Score helpers compute pass/fail per case + suite-level rate.
5. Populate fixture files with 20–30 cases each, hand-curated from realistic prompts.
6. Wire nightly CI job; publish results as a Markdown comment on a tracking issue.
7. Document eval philosophy in `docs/`: when to add a case; how scoring works; how to interpret regressions.

## Todo List

- [ ] Baseline coverage report — blocked on `@vitest/coverage-v8` install
- [ ] Coverage thresholds in vitest.config.ts (blocked on baseline)
- [x] intent-router test (pre-existing `intent-router.test.ts` + `intent-router-compare-diagnose.test.ts` + `intent-router-keywords.test.ts`)
- [x] session-manager.test.ts (pre-existing)
- [x] stream-registry test (`stream-registry-abort.test.ts` from phase 04)
- [x] sse-stream test (pre-existing `sse-stream.test.ts`)
- [x] mode-prompts test (`focus-injection-roundtrip.test.ts` from phase 02)
- [x] compact-service test (`compact-ports-focus.test.ts` from phase 02 + pre-existing)
- [x] claude-runner test (`claude-runner-abort.test.ts` from phase 04 + `sdk-resume-roundtrip.test.ts` from phase 01)
- [ ] Eval harness + score helpers — deferred (operational)
- [ ] Three eval suites with fixtures — deferred
- [ ] Nightly CI wiring + reporting — deferred
- [ ] `EVAL_DAILY_BUDGET_USD` circuit-breaker — config already lands (phase 00); runner usage deferred
- [ ] Docs on eval workflow — deferred

## Success Criteria

- `src/core/*.ts` ≥80% lines, ≥75% branches; CI enforced.
- Three eval suites green at agreed pass thresholds (anaphora ≥80%, tool-misuse ≤10% bad cases, disambig-pivot ≥85%).
- Nightly run posts results within 10 minutes; regressions are visible same-day.
- Eval cases extend easily: adding a new case is ≤10 lines of fixture JSON.

## Risk Assessment

- **R1 Flaky LLM-driven evals** — model outputs vary. Mitigation: temperature 0, fixed model, scoring helpers tolerant of equivalent phrasings; track pass-rate trend, not individual case flips.
- **R2 Test-time API cost** — eval suites call real models. Enforced via `EVAL_DAILY_BUDGET_USD` env (default $50, plumbed in phase 00). Eval runner tracks cumulative spend per UTC day in a sidecar file; circuit-breaks remaining suites + alerts when 80% of budget hit. PR-gate scenarios always run regardless of budget (correctness > cost); nightly comprehensive runs respect the cap.
- **R3 Coverage chasing** — tests written for line coverage but no semantic value. Mitigation: review checklist requires each new test to assert a specific behaviour, not just exercise lines.

## Security Considerations

- Eval fixtures must not contain real user data; use synthetic prompts only.
- API keys for nightly eval read from CI secrets, never committed.

## Next Steps

- Future: introduce a property-based test suite (`fast-check`) for the focus-store merge semantics.
- Future: A/B-eval framework comparing two model versions on the same suites (informs SDK upgrades).
