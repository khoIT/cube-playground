# Phase 6 — Tests + tsc build + code review

## Context Links
- Test runner: vitest (`package.json:11` `"test": "vitest run"`, `:12` `test:watch`)
- Existing patterns: colocated `__tests__/` dirs; example `src/pages/Segments/detail/cards/__tests__/humanize-measure.test.ts`; util tests in `src/utils/__tests__/` (e.g. `playground-deeplink.test.ts`)
- Targets from P3/P4/P5.

## Overview
- Priority: P3. Status: completed. Blocked by P3, P4, P5 (and P2 if landed).
- Unit-test new pure utils, run affected suites, tsc build, code review.

## Requirements
- New unit tests (mirror humanize-measure.test.ts style):
  - `src/pages/Segments/detail/cards/__tests__/format-value.test.ts` — `formatCompact`/`formatExact`: B tier (₫10.29B), M (10.3M), k (7.6k), exact tooltip strings, currency vs count.
  - `src/utils/__tests__/format-chart-datetime-label.test.ts` — day-grain "Apr 7", year-on-first-tick, year-crossing, hour-grain "Apr 7 14:00", tooltip "Apr 7, 2026", non-date passthrough, TZ-boundary date (`...T00:00:00.000` does not roll to prev day).
  - `src/pages/Segments/detail/cards/__tests__/card-unit-chip.test.ts` — chip shown when measure adds info; hidden when humanized tokens ⊆ title tokens.
- Update any existing tests asserting old M-cap / full-currency output (grep `format-value`, `formatCount`, snapshot tests under Segments).
- Run `npm test` (or scoped `npx vitest run src/pages/Segments src/utils`), fix failures (no skipping, no mocks-to-pass).
- `npx tsc --noEmit` clean.
- Code review of all changed files (delegate to code-reviewer): tokens-only, < 200 LOC, DRY, no plan-artifact comments.

## Related Code Files
- Create: 3 test files above.
- Modify: any stale tests revealed by grep.

## Implementation Steps
1. Write the 3 new test files.
2. Grep for tests touching changed symbols; update expectations.
3. `npx vitest run` scoped to Segments + utils + Chat + Dashboards-affected; then full `npm test`.
4. `npx tsc --noEmit`.
5. Code review pass.

## Todo List
- [x] format-value.test.ts (B/M/k + exact)
- [x] format-chart-datetime-label.test.ts (incl TZ + passthrough)
- [x] card-unit-chip.test.ts (subset logic)
- [x] update stale tests
- [x] vitest all green
- [x] tsc clean
- [x] code review done

## Success Criteria
- All new + existing tests pass; no skips/mocks-to-pass.
- tsc clean. Review: no raw hex, one font, files < 200 LOC, no plan refs in comments.

## Risk Assessment
- R: TZ test flaky across CI locales (Med/Med) → date-grain formats from date parts only; pin test via fixed ISO strings, assert local-independent output.
- R: hidden snapshot tests assert old chart/x labels (Med/Low) → grep snapshots; regenerate intentionally.

## Next Steps
- Conventional commits per workstream. Evaluate docs impact (design-guidelines if new card-header pattern is now canonical).
