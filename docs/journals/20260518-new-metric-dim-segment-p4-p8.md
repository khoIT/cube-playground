# New Metric Dimension & Segment Authoring: Full UI + Test-Run Views (P4-P8)

**Date**: 2026-05-18 06:30
**Severity**: Low
**Component**: New Metric wizard (full-page refactor, dimension/segment builder UI, test-run dispatch)
**Status**: Resolved
**Commits**: `dc09a33` (kind picker + per-kind step graph), `89e970a` (dim + segment UI + per-kind test-run)

## What Happened

Completed phases 4–8 of the New Metric dimension/segment authoring plan. The full-page wizard now correctly branches on `draft.artifactKind` (measure/dimension/segment) with:

- **Step 0**: Kind picker (measure / dimension / segment radio)
- **Dimension mode**: 4 builder bodies (banding, time-since, passthrough, boolean) + dimension-specific test-run showing top-N table
- **Segment mode**: Reuses existing filter-tree UI + segment-specific test-run (SQL-only fallback, no live Cube load yet)
- **Measure mode**: Preserved original behavior (scalar + sparkline test-run)
- **Per-kind step graph**: Step count & labels now vary per kind; `StepChrome` dropped rigid `STEP_LABELS` dependency

All 255 tests green. Zero new TypeScript errors in touched files (3 pre-existing baseline errors in `NewMetric/sections/*` unrelated to this work).

## The Brutal Truth

This was a grinding, multi-phase refactor of the entire wizard flow. Dimension and segment builders are conceptually simple but touched a sprawling legacy step-chrome, filter-tree, and test-run machinery. The emotional relief of landing green tests and clean commits masks the real exhaustion: coordinating 8 interdependent phases across a stateful React component tree while keeping backward compatibility for measure mode took surgical precision. One off-by-one in step indexing or a missed `artifactKind` guard would cascade through every view. The segment test-run fallback (SQL-only, no live load) feels incomplete but is the pragmatic call given the cubejsApi spike deferred to follow-up work.

## Technical Details

**Dimension builder bodies** enforce strict type contracts:
- `BandingBody`, `TimeSinceBody`, `PassthroughBody`: free SQL text
- `BooleanBody`: FilterLeaf only (no raw SQL), sanitized generator-side in `generate-dimension.ts`

**Segment test-run dispatch**:
```
if (draft.artifactKind === 'segment') {
  // schema-write executes; cubejsApi.load is null/undefined
  // falls back to SQL preview (P8 spike deferred)
}
```

**`useAutoMetricName` refactor** (red-team F-12 fallout):
- Resets `lastAutoNameRef`/`lastAutoTitleRef` on `artifactKind` change
- Prevents stale auto-name from measure bleeding into dimension

**`StepChrome` simplification**:
- Removed `STEP_LABELS` constant dependency
- Caller supplies `title`, `stepNumber`, `totalSteps` explicitly
- Step indices now correct for variable-length step graphs per kind

## What We Tried

1. **Kept `TestRunBody` as measure view** instead of fully extracting to `test-run-measure-view.tsx` — pragmatic narrowing. Dimension/segment views are separate; measure view logic remains inline.
2. **Segment test-run SQL-only fallback** instead of blocking on cubejsApi.load spike — deferred per plan priority matrix (P2 generator contracts locked, test-run P8 is lower risk).
3. **Boolean dimension builder FilterLeaf constraint** enforced both UI-side (picker disables raw SQL) and generator-side (sanitization in `generate-dimension.ts`) — defense-in-depth.
4. **Per-kind step graph** using `kindStepGraph(draft.artifactKind)` helper instead of a monolithic step list — cleaner composition, smaller cyclomatic complexity.

## Root Cause Analysis

No regressions or root-cause failures in this phase. The work was straightforward execution against a clear plan, with one deferred spike (cubejsApi.load segments) that was already documented and accepted. The only "failure" was the red-team F-12 finding (auto-name bleed on kind change), which was caught, fixed, and verified.

## Lessons Learned

1. **Per-kind machinery scales better than monolithic branches**: Extracting `kindStepGraph()` and per-kind test-run views is vastly easier to test and debug than a single mega-component.
2. **Generator-side sanitization is mandatory for UI trust**: Boolean dimension builder's UI-only FilterLeaf constraint would be insufficient without `generate-dimension.ts` enforcing the contract downstream.
3. **Deferred spikes must be explicit**: Segment test-run falling back to SQL-only is acceptable because the spike (cubejsApi spike for segments) was named, prioritized, and scheduled. Implicit degradation would be a bug.
4. **Test coverage on refactors is non-negotiable**: Full 255-test green is the only reason we can confidently ship kind-branching logic. Partial coverage here would be catastrophic.

## Next Steps

1. **This PR is ready for code review**: All acceptance criteria met, tests green, no new errors.
2. **Follow-up ticket**: cubejsApi.load segments spike (P1 in priority matrix) — upgrades segment test-run from SQL-only to real cohort tile.
3. **KindBadge wiring** (lower priority): Integrate kind badge into slot-picker, filter-leaf-row, find-similar-warning contexts (red-team deferred items F-5, F-11).
4. **Per-builder unit tests** (deferred but low risk): Generator-side round-trip tests in P2 already lock the contracts; per-UI-builder unit tests are future hardening.

## Unresolved Questions

- **cubejsApi.load segment cohorts**: Can the live Cube instance compute segment membership without materializing the entire table? Need spike to confirm cardinality + performance.
- **KindBadge placement**: Where should kind labels appear in the UI — only in step chrome, or in slot headers, filter-leaf rows, too? UX decision pending.
