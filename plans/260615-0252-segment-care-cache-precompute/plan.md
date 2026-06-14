# Segment Care tab — persist cache + serve-stale + background precompute

## Problem (verified)

`GET /api/segments/:id/cs-care` runs a heavy cross-catalog Trino join live per
cache-miss. Reproduced on local: **HTTP 200 in 64.6s** (cfm_vn, 3969 members,
3193 tickets). Connector is healthy (`CUBEJS_DB_*` + `TRINO_PROFILER_*` both set)
— this is NOT a connector problem. A 64s synchronous request intermittently
exceeds the read timeout on cold Trino → the `500` in the screenshot (the
"Back online — reload" banner = connection dropped mid-request).

Today's cache is in-memory only (`segment-cs-care.ts:68`, 6h TTL, 300 entries):
- lost on restart,
- a cold cache-miss makes the user wait 64s or 500,
- on any Trino throw the handler returns **502** instead of last-good data.

## Goal

Make the Care tab open instantly and never hard-fail on transient Trino trouble,
by: (1) persisting the payload, (2) serving stale-on-error, (3) precomputing in
the background so interactive loads are warm hits. Membership-change is a
*secondary* invalidation trigger — the primary driver is data cadence (CS marts
are next-day fresh; `csMaxLogDate` confirms daily granularity).

## Status: IMPLEMENTED (2026-06-15)

All 5 phases shipped. Migration landed as **057** (056 was taken by
`advisor-agent-run-observability` since the plan was written). 27 new tests;
full server suite 1675 pass, frontend Care tests 9 pass, server tsc clean.
Code-reviewed (DONE_WITH_CONCERNS → H1 comment scope + M2 null-row feedback
addressed). Pending: commit/push approval (`second` remote auto-deploys to prod).

## Phases

- [x] **Phase 01 — Persist the care cache** (`phase-01-persist-care-cache.md`)
  Migration 057 `segment_care_cache` + `segment_care_run`; `segment-care-cache-store.ts`
  (last-good preservation) + `segment-care-run-store.ts`. Route reads/writes DB.
- [x] **Phase 02 — Serve-stale-on-error** (`phase-02-serve-stale-on-error.md`)
  Route returns last-good payload (200 + `stale`) instead of 502 when a prior
  payload exists; 502 only on true cold miss. UI freshness badge (GMT+7).
- [x] **Phase 03 — Background precompute job** (`phase-03-background-precompute.md`)
  `care-precompute-scheduler.ts` (nightly window, serial drain shared by cron +
  manual, cooldown); shared `cs-care-builder.ts` used by route + job; wired into
  `cron-runner.tick()`.
- [x] **Phase 04 — Status board + manual run** (`phase-04-status-board-and-manual-run.md`)
  Admin hub tab `/admin/care-precompute` + `GET/POST /api/admin/care-precompute/runs`
  (admin-gated); `care-precompute-{data,panel}.tsx`.
- [x] **Phase 05 — Tests + docs** (`phase-05-tests-and-docs.md`)
  5 test files (27 tests); lessons-learned + system-architecture + changelog entries.

## Key dependencies / reuse (no new patterns)

- Cache table shape + last-good preservation → `segment_card_cache` (migration 051).
- Scheduler self-gating + serial drain + GMT+7 window → `member360-precompute-scheduler.ts`.
- Cron wiring → `cron-runner.ts:107` (`maybeRunMember360Precompute` is the template).
- Eligibility → `hasCsCoverage(gameId)` (`cs-product-map.ts`).
- The two Trino readers (`cs-ticket-reader.ts`, `cs-recharge-trajectory.ts`) are
  already bounded (365d / ±30d / 5000-uid cap) — **no change**.

## Locked decisions (confirmed with user 2026-06-15)

- **Cadence: nightly** `03:00–06:00` GMT+7 (env `CARE_PRECOMPUTE_WINDOW`), after CS
  marts land — matches member360. CS data is next-day fresh, so nightly matches
  the real data cadence.
- **Status board + manual run (required):** a board like the pre-agg run / segment
  refresh boards to track precompute pass status, plus a manual "Run now" trigger
  (Phase 04). Backed by the `segment_care_run` log (Phase 01).
- **Cold true-miss: compute synchronously** this once (unavoidable first time),
  then it's warm. Async-202 "computing…" UX is NOT built.
- Staleness ceiling for serve-from-cache without recompute: 24h (env
  `CARE_CACHE_MAX_AGE_MS`); viewing an older-than-ceiling segment serves stale
  immediately and enqueues a background recompute.

## Open questions

- Surface `last_error` only on the board + logs (current plan), or also inline on
  the segment Monitor tab? (Board-only is the default; expand if ops asks.)
