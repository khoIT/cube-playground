# Phase 03 — Background precompute job

## Overview
Priority: P1 (makes interactive loads warm; turns the 64s path into a rare cold
first-miss). Status: not started. Depends on Phase 01 (store).

Mirror `member360-precompute-scheduler.ts` exactly: a cron-tick hook that
self-gates on a nightly GMT+7 window, drains due segments ONE AT A TIME (globally
serial so Care presents as a single slow client to Trino), guarded by a
module-level running flag.

## Context
- Template: `server/src/services/member360-precompute-scheduler.ts` (window parse,
  `isInsideWindow`, `currentWindowStartMs`, serial drain, running flag, manual
  trigger w/ cooldown).
- Cron wiring point: `server/src/jobs/cron-runner.ts:107` — add a sibling
  `await maybeRunCarePrecompute().catch(...)`.
- Eligibility: `hasCsCoverage(gameId)` (`cs-product-map.ts`).
- The compute itself = the same logic the route runs; extract the
  payload-building into a shared `buildCsCarePayload(segmentId)` so route AND job
  call ONE function (DRY) and both write the store.

## Design
- CREATE `server/src/services/care-precompute-scheduler.ts`:
  - `parseCareWindow(env CARE_PRECOMPUTE_WINDOW, default '03:00-06:00')`
  - `listDueCareSegments(now, window)`: predicate segments, CS-covered, whose
    `segment_care_cache.computed_at` is null OR predates window start OR whose
    membership `last_refreshed_at` is newer than `computed_at`
    (membership-change = secondary trigger).
  - `maybeRunCarePrecompute(now)`: window gate + running flag + serial drain →
    `buildCsCarePayload` → `writeCareCache` / `markCareAttempt` → write a
    `segment_care_run` row per pass (mirrors `preagg-run-store.ts`).
  - `triggerCarePrecompute(segmentId)` manual "run now" (bypasses window, 10-min
    per-segment cooldown, fire-and-forget → 202) — REQUIRED for the board's
    manual-run button. Mirrors `triggerMember360Precompute`.
- CREATE `server/src/db/segment-care-run-store.ts`: `recordCareRun(...)`,
  `listCareRuns({ segmentId?, limit })`, retain newest N per segment (mirror
  `preagg-run-store` / `segment_card_run` retention).
- REFACTOR `segment-cs-care.ts`: extract `buildCsCarePayload()` (the compute body)
  into a shared module (e.g. `services/cs-care-builder.ts`) imported by route+job.
- WIRE `cron-runner.ts`: add `maybeRunCarePrecompute` to `tick()`.
- Membership-change hook: after a segment refresh completes
  (`refresh-segment.ts`), no direct call needed — `listDueCareSegments` already
  detects `last_refreshed_at > computed_at`, so the next window picks it up. (If
  faster pickup is wanted, enqueue immediately; defer per YAGNI.)

## Todo
- [ ] Extract `buildCsCarePayload()` shared builder; route + job use it.
- [ ] Implement scheduler mirroring member360 (reuse window helpers if exported,
      else copy — do not fork the GMT+7 math silently).
- [ ] Wire into cron tick.
- [ ] Confirm serial drain (no overlapping passes across ticks).

## Success criteria
- Scheduler test: outside window → no-op; inside window → drains due segments
  serially; running flag prevents overlap (mirror member360 tests).
- Due-selection test: segment whose membership refreshed after last care compute
  is selected; a fresh one is not.
- After a precompute pass, the route returns a warm hit with zero Trino calls.

## Risks
- Trino load: serial drain + nightly window keeps it to one slow client; do NOT
  parallelize. Same posture as member360.
- Single-instance assumption (in-process cron, like the rest); multi-instance
  advisory-locking is out of scope (matches existing cron caveat).
