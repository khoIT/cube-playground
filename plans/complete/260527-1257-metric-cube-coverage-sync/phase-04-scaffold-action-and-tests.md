# Phase 04 — Scaffold action UI + tests

## Context
- Builds on phase-02 `POST /api/business-metrics/scaffold` and phase-03 uncovered-measures view.

## Overview
Priority: medium. Status: blocked on phase-02 + 03.
Wire the "Scaffold draft" CTA to the write endpoint, confirm results in-UI, and lock everything with tests.

## Requirements
### UI
- In uncovered-measures view: multiselect measures → "Scaffold N draft metric(s)" button.
- Confirm dialog (writes files): list refs to be created. On success show created[] + skipped[] (with reason).
- After scaffold: auto-Refresh coverage so newly-covered measures drop off the list.
- Draft stubs surface in the existing metrics list as `trust: draft` — note this to user (no separate UI needed).

### Tests
- **Unit** (`metric-stub-scaffolder`): ref → valid `BusinessMetric` (passes Zod); id slug + collision suffix; required_cubes derived from cube part.
- **Coverage resolver** (phase-01): uncovered detection; broken parity with `validateRefs`; fail-open on bad game.
- **Endpoint** (`business-metrics-coverage` + `-scaffold`): coverage shape; scaffold writes reloadable draft; idempotent skip on repeat.
- **UI** (vitest + RTL, mirror `src/pages/Settings/__tests__/`): renders broken/uncovered/matrix from mocked endpoint; scaffold posts selected refs.

## Related files
- Modify: `metric-coverage-section.tsx` (scaffold CTA + confirm + result toast).
- Create tests: `server/test/metric-coverage-resolver.test.ts`, `server/test/business-metrics-coverage-endpoint.test.ts`, `server/test/business-metrics-scaffold-endpoint.test.ts`, `server/test/metric-stub-scaffolder.test.ts`, `src/pages/Settings/__tests__/metric-coverage-section.test.tsx`.

## Steps
1. Scaffold CTA + confirm dialog + result rendering.
2. Auto-refresh on success.
3. Write all test suites; run `npm --prefix server test` + root `npm test` until green.
4. Update `docs/` (system-architecture / codebase-summary) noting the coverage service + endpoints + Settings panel.

## Success criteria
- Selecting an uncovered measure and confirming creates a draft YAML that immediately shows as covered on refresh.
- All new + existing tests green (server + web).
- No design drift in the new Settings section.

## Risks
- Writing real files in tests — use a temp registry dir (`setRegistryDir`) as existing loader tests do; never write into the live presets dir from tests.
- Confirm dialog must make clear this writes to the repo (curation follows).

## Next steps
- Follow-up (not this plan): use coverage data to drive Buckets B/C/D (build cons_game_key_metrics_daily / roles cubes, funnel measures) in cube-dev, then scaffold + curate the metrics.
