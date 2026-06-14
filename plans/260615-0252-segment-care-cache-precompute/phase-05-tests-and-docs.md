# Phase 05 — Tests + docs

## Overview
Priority: P1. Status: not started. Validation gate for the feature.

## Tests
- `segment-care-cache-store.test.ts`
  - write→read round-trip; computed_at/last_attempt_at semantics.
  - failure preserves last-good payload (markCareAttempt does not wipe payload_json).
- `segment-cs-care-route.test.ts` (extend existing route test)
  - serve-stale: reader throws after prior success → 200 + `stale`.
  - true cold: reader throws with no prior payload → 502.
  - warm hit: second call within TTL makes zero reader calls.
- `care-precompute-scheduler.test.ts` (mirror `member360-precompute` tests)
  - window gating (inside/outside, midnight wrap).
  - due selection incl. membership-newer-than-care trigger.
  - serial drain + running-flag overlap guard.
  - manual trigger: 202 then 429 within cooldown; shares running flag with cron.
- `segment-care-run-store.test.ts`: record/list runs, per-segment retention.
- `care-precompute-route.test.ts`: runs list shape; manual-trigger 202/429.

All via stubbed readers/connector — no live Trino in unit tests (matches existing
advisor/lens test posture).

## Docs
- `docs/lessons-learned.md`: new entry — "Segment Care tab 64s synchronous Trino
  join → 500 on cold warehouse; fix = persist cache + serve-stale + nightly
  precompute. Signal: a per-request cross-catalog iceberg join with no durable
  cache." (No plan/phase refs in the entry per code-comment rules.)
- `docs/system-architecture.md`: note the care cache table + precompute cron
  alongside member360/card-cache.
- `docs/project-changelog.md`: feature entry.

## Success criteria
- Full `npx vitest run` green (server + src).
- `npx tsc --noEmit` clean.
- Manual: cfm_vn segment Care tab opens instantly on second load; survives a Trino
  hiccup with a freshness badge instead of a 500.

## Open questions
- Surface `last_error` in the segment Monitor tab, or logs-only for v1? (logs-only
  is the YAGNI default; add to Monitor only if ops asks.)
