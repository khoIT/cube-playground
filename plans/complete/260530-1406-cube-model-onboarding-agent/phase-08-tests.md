---
phase: 8
title: "Tests"
status: complete
priority: P1
effort: "5h"
dependencies: [5]
---

# Phase 8: Tests

## Overview
Lock the pipeline with unit + integration tests. Inference and scaffolder are pure and
must be exhaustively unit-tested; the store, endpoints, and RBAC need integration coverage;
the write path must prove atomic rollback.

## Requirements
- Functional: cover classification/inference, scaffolder round-trip, store lifecycle, endpoint happy + RBAC-deny paths, atomic write rollback.
- Non-functional: deterministic (no live Trino/Cube dependency — mock the profiler + proxy); fast; mirror existing test layout (`server/test/*.test.ts`).

## Architecture
- Unit:
  - `raw-schema-inference.test.ts` — fixture profiles → expected roles/PK/joins/confidence.
  - `cube-model-scaffolder.test.ts` — inference → `CubeModelSchema` valid; YAML round-trips; collision suffix.
  - `golden-query-seeder.test.ts` (Phase 07) — fixture artifacts → co-occurrence index.
- Integration:
  - `onboarding-draft-store.test.ts` — upsert/status-preservation/audit (mirror `access-store.test.ts`).
  - `onboarding-endpoints.test.ts` — generate→accept→approve happy path with mocked profiler + mocked `/load`+`/meta`; assert viewer 403 on mutations; assert atomic rollback when `/meta` poll fails (verify `.bak` restored).
- Mock the Trino profiler (no live warehouse) and the Cube proxy (no live Cube).

## Related Code Files
- Create: `server/test/raw-schema-inference.test.ts`, `server/test/cube-model-scaffolder.test.ts`, `server/test/onboarding-draft-store.test.ts`, `server/test/onboarding-endpoints.test.ts` (+ `golden-query-seeder.test.ts` when Phase 07 lands).
- Read for context: existing `server/test/access-store.test.ts` (store test style), existing endpoint/RBAC tests under `server/test/`.

## Implementation Steps
1. Write inference fixtures + unit tests.
2. Scaffolder round-trip + collision tests.
3. Store lifecycle + audit tests.
4. Endpoint happy-path with mocks; RBAC-deny; rollback-on-failed-poll.
5. Run full suite; fix to green before review.

## Success Criteria
- [x] All new tests pass; no live Trino/Cube needed.
- [x] RBAC deny + atomic rollback explicitly asserted.
- [x] Inference fixtures cover dimension/measure/time/PK/join cases.
- [x] Suite stays green in CI.

## Risk Assessment
- **Hidden coupling to live services** → inject/mocked profiler + proxy; fail the build if a test reaches the network.
- **Flaky write-path test** → use a temp dir for the cube-dev model write target; assert file + `.bak` deterministically.
