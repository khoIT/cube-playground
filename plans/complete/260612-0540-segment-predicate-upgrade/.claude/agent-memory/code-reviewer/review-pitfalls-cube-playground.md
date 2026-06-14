---
name: review-pitfalls-cube-playground
description: Recurring bug shapes to check first when reviewing cube-playground FE/server diffs (meta joins stripped, FE/server translator parity, dirty test/typecheck baseline)
metadata:
  type: project
---

Recurring review checks for cube-playground diffs:

- **SDK `cubeApi.meta()` strips `joins[]` and `connectedComponent`.** Any new hook reading `cube.joins` from the SDK meta call is silently broken; the working pattern is the raw `?extended=true` fetch in `src/QueryBuilderV2/hooks/query-builder.ts:371-381`. Unit tests with fixture cubes mask this — verify the fetch path, not just the parser.
- **FE/server translator parity is the round-trip hazard.** Server `treeToCubeFilters` (`server/src/services/translator.ts`) maps tree `in→equals`, `notIn→notEquals` and recursively nests `{and}/{or}`. Any FE tree→query mapper must mirror BOTH or deeplinks break (Cube has no `in` operator) and OR-of-AND cohorts silently widen. Found 2 criticals of exactly this shape in the 260612 segment-predicate-upgrade review.
- **Boot normalizer can undo relative-date preservation.** `normalizeQueryRelativeDateRanges` in QueryBuilderContainer expands "last N week/month/quarter/year" (NOT days) to literal tuples — any save-back flow reading executedQuery re-freezes rolling windows for those units.
- **Dirty baselines (as of 2026-06-12):** repo `tsc --noEmit` has many pre-existing errors (QueryBuilderV2 vendored files, replaceAll lib target); server `test/preagg-readiness.test.ts` fails 4 tests on main (registry-size assertions). Filter typecheck/test output to diff files before flagging.
- antd is pinned at 4.16.13 — `Modal visible` is correct; don't flag for v5 `open`.

**Why:** these cost the most verification time and produced the highest-severity findings; checking them first short-circuits re-discovery.
**How to apply:** at review start, grep diff for `\.meta()`/`joins`, tree↔query mappers, and dateRange handling; run vitest/tsc filtered to diff files only.
