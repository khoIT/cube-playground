# Code Review — Segment Refresh Ops Console + Wedge Watchdog

Date: 2026-06-11
Reviewer: code-reviewer
Scope: 11 changed files (server svc/route/cron/status + FE tab/row/data/types) + 4 test files
Plan: plans/260610-1923-segment-refresh-ops-console/plan.md

## Verdict

Ship-ready. No blockers. The feature is well-factored (pure-derive helper, single shared
reconcile path, read-only except unstick), tokens-only UI, real tests on the alarm states.
Findings below are 1 major (a real but bounded watchdog-vs-in-flight race the plan's threshold
mostly mitigates), plus minors/nits. All 6 acceptance criteria verified.

## Acceptance criteria — verified

1. **Taxonomy + precedence** — VERIFIED. `deriveRefreshState` precedence broken > refreshing(wedged|in_flight)
   > degraded > serving_stale > due > healthy matches the table (svc:70-89). `wedged` keys off
   `updated_at` not `last_refreshed_at` (svc:76) — correct. Threshold `max(cadence, 10min)` (svc:41-44).
2. **Watchdog** — VERIFIED. Resets only `status='refreshing'` rows past threshold (svc:322-341);
   leaves fresh in-flight alone (test:177-186); env-killable via `SEGMENT_REFRESH_WATCHDOG_ENABLED`
   (svc:37-38, returns `[]` early when off); `reconcileSegmentRefreshing` `WHERE ... AND status='refreshing'`
   guards no-op (segment-status:47-53).
3. **No cron regression** — VERIFIED. Watchdog wrapped in try/catch so a throw can't break the
   `listDueSegments → enqueueRefresh` path (cron:88-101); boot reconcile untouched (cron:121-130).
   No import cycle: cron-runner → ops → segment-status → (sqlite/types only); jobs do not back-import ops.
4. **Auth + unstick semantics** — VERIFIED. Both routes `requireRole('admin')+requireFeature('admin')`
   (route:31-32); 404 on unknown id (route:53-54); idempotent — non-refreshing row returns 200
   `unstuck:false` (route:56-63, test:91-95). Read-only except the one unstick write.
5. **Design tokens** — VERIFIED. `grep` for inline hex on all 3 new UI files → none. Page-header +
   eyebrow pattern mirrors the spec; tone→token chip map uses semantic `--*-soft/--*-ink`.
6. **No SQL injection** — VERIFIED. `loadErroringCards` IN-clause uses `?`-placeholders bound via
   `.all(...segmentIds)` (svc:191-198); all other queries are static or single-param bound.

## Major

### M1 — Watchdog can reset a still-running long refresh, causing a redundant double-refresh
The watchdog classifies "wedged" purely by `updated_at` age; it has **no signal for whether the
in-memory queue is actively processing that segment right now**. A single predicate refresh is a
*sequence* of Cube calls (size query + up to ~10 uid pages @ `PER_SEGMENT_TIMEOUT_MS=60s` each +
member-tier compute + N preset cards) — a large cohort against a cold Trino can legitimately run
several minutes, and on a short-cadence segment the threshold floors at only 10min. If a refresh
crosses 10min while the queue is still draining it, the next `tick()` watchdog flips the row to
`stale`. Sequence of harm:
- Worker finishes and calls `setSegmentSizeAndUids(...,'fresh')`, silently overwriting the watchdog's
  `stale` → no data corruption, but the watchdog's "reset" was a false action logged as a fix.
- Worse: once the row is `stale`, the *same still-running drain loop's* next `listDueSegments` (or a
  manual Refresh) re-`enqueueRefresh`es it. The queue is a `Set` and the id was already `delete`d when
  picked up, so it re-adds → the same drain processes the same segment a **second time back-to-back**.
  Wasteful Cube load on the exact slow cohort that triggered it; not corrupting.

Impact: bounded (no data loss; self-corrects), but it's the precise failure the plan's open question
flagged ("auto-kill a slow-but-healthy refresh"). The 10min floor makes it unlikely for typical
cohorts but not impossible for the 7.16M case the plan itself cites.

Recommendation (pick one, non-blocking for this round since killable via env):
- Cheapest: in `runWedgeWatchdog`, skip the reset when `isProcessing() && queueSize()>=0` *and* the
  row is the one being drained — but the queue doesn't expose "current id", so this needs a tiny
  `currentlyProcessing()` getter on refresh-queue. Then watchdog only reaps rows the queue is NOT
  touching (true orphans), which is exactly its stated purpose.
- Or honor the plan's own "log-only soak" option for one release before enabling auto-write.
- At minimum, document in the tab/heartbeat strip that the watchdog targets *orphaned* refreshing
  rows and may double-run an in-flight refresh that legitimately exceeds the threshold.

## Minor

### m1 — Mid-refresh `updated_at` bump resets the wedge clock (drift-rehydration path)
`refresh-segment.ts:113-118` does `UPDATE segments SET cube_query_json=?, predicate_meta_version=?,
updated_at=now WHERE id=?` *while the row is still `refreshing`*, when schema drift is detected and
rehydrated. Since both the `wedged` derivation and the watchdog measure age from `updated_at`, this
pushes the wedge deadline forward mid-flight. Effect is small (drift check runs early, so the clock
moves by only the few seconds since refresh-start) and only on the drift path — but it means
"wedged age" is not strictly "time since refresh began" as the type comment claims (svc:58-59). Same
applies to the member-tiers `UPDATE ... updated_at` at refresh-segment.ts:274 (later in the run —
would reset the clock further). Consider: stop touching `updated_at` on these mid-refresh writes
(they're not status transitions), or note the caveat in the comment. Low harm; flagging for accuracy.

### m2 — Heartbeat strip "auto-unsticks after {wedgeFloorMin}m+" understates threshold for long cadences
tab:85 hard-codes the *floor* (10m). Actual threshold is `max(cadence, floor)`, so a daily-cadence
segment auto-unsticks at 24h, not 10m. An operator reading the strip would expect a wrong deadline.
Either label it "after max(cadence, 10m)" or compute the effective per-segment value.

## Nits

- **n1** `useSegmentRefreshAlertCount` (data:104-116) fires its own `GET /ops` independent of
  `useSegmentRefreshOps`, so the hub renders two full payload fetches on mount (badge + tab). The
  `/ops` query scans all predicate segments + a card-cache group-by; cheap today, but the badge only
  needs `summary.{wedged,degraded}`. If it grows, consider a lightweight count endpoint or share one
  fetch via context. YAGNI-acceptable now.
- **n2** Nav badge counts `wedged+degraded` (data:110) but `isAlertState` also includes `broken`
  (data:51) and the tab's `STATE_SORT` floats `broken` second. Slight inconsistency: a `broken`
  segment is an alert for sorting but not for the badge. Intentional per plan (badge = wedged+degraded
  only), just confirm that's still desired — a hard-broken segment arguably deserves the badge too.
- **n3** `wedgeThresholdMs(cadenceMin)` when cadence is null/≤0 sets `cadence=WEDGE_FLOOR_MIN` then
  `max(floor, floor)` — correct, but the intermediate assignment reads oddly; a comment or
  `cadenceMin && cadenceMin>0 ? cadenceMin : 0` then `max(..., floor)` would be clearer. Cosmetic.

## Positive

- Single reconcile path (`reconcileSegmentRefreshing`) shared by route + watchdog — one tested op,
  two triggers, no duplicated reset logic. Exactly as the plan promised.
- Watchdog treats unparseable `updated_at` as wedged (svc:335 `Infinity`) and has an explicit test
  (test:188-192) — good defensive choice for a corrupt timestamp.
- Card tally is one grouped query + a second placeholder-bound query only for segments that actually
  have errors (svc:233-236) — no N+1, no over-fetch of error messages for healthy segments.
- Transient-error handling in the underlying worker (restore prior status, no `broken` churn) is
  already in place and the watchdog composes with it cleanly (`stale` is the shared terminal).
- Tests pin the two alarm states (wedged/degraded), the threshold floor, empty-DB, manual-segment
  exclusion, and full 401/403/200 auth matrix. Coverage is on the parts that matter.

## Unresolved questions

1. M1: do you want the watchdog to consult queue "currently-processing id" before reaping, or is the
   env-kill + self-overwrite acceptable for the local-only first cut? (Plan's open question leaned
   "write from day one" — this review surfaces the concrete double-refresh path so you can decide.)
2. n2: should a `broken` segment also light the hub nav badge, or is wedged+degraded the deliberate
   alarm set?
