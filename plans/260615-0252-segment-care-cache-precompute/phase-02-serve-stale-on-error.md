# Phase 02 — Serve-stale-on-error (the 500 killer)

## Overview
Priority: P0 (directly fixes the screenshot). Status: not started. Depends on
Phase 01 (needs the durable last-good payload).

When the live Trino read throws/times out, return the last-good cached payload
(HTTP 200 + `stale` marker) instead of 502. Only 502 when nothing has ever been
cached for the segment. This decouples the tab from cold-Trino flakiness.

## Context
- Route catch block today → 502 `CS_CARE_UNAVAILABLE` (`segment-cs-care.ts:162`).
- The CS history read is the hard dependency; the recharge strip already degrades
  to null (keep that).
- Frontend Care tab consumer: `src/pages/Segments/.../care` (locate the fetch +
  error render that currently shows "Request failed with status 500").

## Design
- Extend `CsCarePayload` with optional:
  `stale?: { computedAt: string; reason: 'trino_error' | 'timeout'; ageMs: number }`.
- Handler flow on cache-miss/expired:
  1. `markCareAttempt(...)` before the live read.
  2. try live compute → on success `writeCareCache` + return fresh (no `stale`).
  3. on throw → `readCareCache`; if a prior payload exists, return it with `stale`
     populated (200). If none, 502 as today (genuine cold first-failure).
- Background recompute trigger: when serving stale because the cache is merely
  *expired* (not errored), fire-and-forget a recompute (or enqueue to Phase 03)
  so the next load is fresh — but never block the response on it.
- UI: render a small freshness badge — "Updated HH:MM · refreshing…" when `stale`
  present. Reuse the design tokens / badge pattern from an existing freshness
  label (advisor-audit / card-cache "as of" badges). No new bespoke styles.

## Todo
- [ ] Add `stale` to payload type + serialize.
- [ ] Rework catch block: serve last-good with `stale`, 502 only when none.
- [ ] Frontend: freshness badge + stop rendering hard error when payload present.
- [ ] Decide expired-vs-error recompute trigger (enqueue vs inline fire-forget).

## Success criteria
- Route test: stub reader to throw AFTER a prior successful compute → 200 with
  `stale.reason='trino_error'`, payload intact.
- Route test: throw with NO prior payload → 502 (unchanged contract for true cold).
- Manual: reload the cfm_vn segment Care tab during/after a Trino hiccup → shows
  last-good data with a freshness badge, not a red 500.

## Risks
- Stale data shown without the user noticing → mitigated by the explicit badge +
  `computedAt`.
- Don't mask a permanently-broken connector as "just stale" — `last_error` is
  persisted and surfaced in the Monitor tab / logs for ops visibility.
