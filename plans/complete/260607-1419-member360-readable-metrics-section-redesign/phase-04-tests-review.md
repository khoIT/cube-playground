# Phase 4 — Tests + tsc + code review

## Context Links
- P2 tests: `member360/__tests__/format-cell.test.ts` (created in P2)
- Existing 360 tests: `member360/__tests__/cached-panel-serving.test.tsx` (must stay green — cache guard behavior)
- Suite: `npm test` (vitest), `npx tsc --noEmit`

## Overview
- Priority: P2. Status: pending. Blocked by P2 + P3.

## Test scope
- **format-cell unit** (P2 file, extend): compact tiers (₫10.29B / ₫45.2M / ₫7.6k / ₫999),
  exact forms, date-relative (today / 2d ago / 3mo ago / 1y ago with fixed `now`),
  tenure (412 → `412d (~1.1y)`), null/garbage fallbacks, no-format passthrough,
  Yes/No heuristic untouched.
- **Section render** (new `member360/__tests__/section-redesign.test.tsx` — name per
  final components): renders from a fixture profile row; asserts dedupe (no Paying tile),
  ratio bar presence/omission (zero/null ltv splits), title tooltips carry exact values,
  ballistar config path (no engagement field) renders without crash.
- **Regression**: `cached-panel-serving.test.tsx` still green (field removals keep
  coverage-guard supersets valid).
- Full FE suite + `npx tsc --noEmit`; fix fallout in touched surfaces only.

## Review
- Delegate to `code-reviewer` agent: diff scope = member360/* + format-value.ts core +
  i18n keys. Checklist: tokens-only, < 200 LOC, no plan refs in comments, DRY single
  compact core, design-guidelines conformance vs adjacent pages.
- Visual cross-check (design rule 6): compare against Segments detail + Dashboards.

## Todo List
- [x] format-cell unit tests complete
- [x] Section render tests
- [x] cached-panel-serving green
- [x] Full suite + tsc green
- [x] code-reviewer pass, findings addressed

## Success Criteria
- All FE tests green; tsc clean; reviewer findings resolved or consciously deferred
  with rationale.

## Risk Assessment
- R: pre-existing unrelated FE failures (Starters tab-count 4→5 known) — do not chase;
  scope fixes to member360 fallout only.

## Next Steps
- Commit per conventional commits; consider `docs/codebase-summary.md` touch-up if
  member360 structure changed materially.
