# CS Ticket Care History 360 — Per-Member Transcript Page Shipped

**Date**: 2026-06-13 18:59
**Severity**: Feature Complete
**Component**: Segments UI, CS Transcript, API Reader, Iceberg Query
**Status**: Committed to main (d239f93)

## What Happened

Built and shipped per-member CS transcript page (`/segments/:id/members/:uid/care`) backed by iceberg.cs_ticket. New route serves Inbox + Timeline toggle UI showing transcript entries (labels, AI safety flags, VIP status, envelope metadata), Care-watchlist row expand, JSON enrichment from Cube. 33 tests, server suite 1425/1425 passing. Guarded by segment membership + security context checks (404 on NOT_IN_SEGMENT or unauthorized account/security flags).

## The Brutal Truth

Vitest 2.1.9 bug ate ~10 iterations. A beforeEach hook that both `mockReset()` and `mockClear()` on click handlers causes *handled* rejected promises to get flagged unhandled, tanking error-state tests. The false positive was maddening — identical test passed without hooks, failed with them. Bisection (repro alone vs repro+hooks) cracked it. Root: mock-reset race in hook lifecycle. Fix: drop the hook, set mock impl per-test. Lesson: mock hooks are a smell; prefer explicit per-test setup.

## Technical Details

### SQL Validation (Cheap Insurance)

Validated all column shapes + joins live against real Trino (jus_vn 832 users) *before* writing the reader service. Query tested:
- `cs_ticket_new_master` (iceberg.cs_ticket) pk/fk paths
- `created_date_unix` is milliseconds (÷1000 to get seconds)
- `login_info` legitimately differs per channel (Web user.uid vs CS-portal username; both valid identity anchors)
- Multi-row dedup on master_id + label combos

Live probe with fetchCsTicketDetail caught nothing because column-index mapping was correct first time. Pattern: live query before reader code = 0 surprises in integration.

### Guardians & 404 Semantics

Two guards block unauthorized reads:
1. **Segment membership:** `guardSegment(segmentId, context.userId)` — 404 if NOT_IN_SEGMENT. Prevents a readable segment from becoming an arbitrary-uid transcript lookup oracle.
2. **Security flag:** `login_info !== context.userId && hasAccountOrSecurityLabel` — 404 on mismatch. Catches flagged accounts/security issues. Must have BOTH criteria true to trip the block (not login_info mismatch alone; account labels are legitimate).

Decision: reject as 404, not 403. Rationale: don't leak whether a uid is in a segment to unauthorized users; 404 is indistinguishable from "doesn't exist."

### Parallel Testing Discipline

End-to-end tsx probe (`fetchCsTicketDetail`) was written *after* backend reader settled. FE passed first time because:
- Server contract was already tested (33 route tests)
- UI read only, no mutation
- Column-index mapping validated against live data upfront

Anti-pattern avoided: writing FE tests before server contract is locked. Pattern: lock contract, test both sides independently, one E2E smoke test.

## What Went Well

- **Live SQL validation.** Walked the schema + joins against 832 real jus_vn rows. Found all surprises upfront (created_date_unix milliseconds, login_info username-vs-uid duality).
- **Scoped commits.** Explicit file paths in git add (avoiding concurrent Catalog/Schema working-tree stomps).
- **Server suite green.** All 1425 tests pass; no flakes.
- **Guard-first design.** Membership + security checks at route entry; reader assumes valid context.

## What Went Wrong

**Vitest mock-hook unhandled-rejection false positive.** A beforeEach that resets mocks on every test makes click-handler promises report as unhandled even when caught. Repro:

```javascript
beforeEach(() => {
  mockReset();   // <-- causes race
  mockClear();   // <-- in hook, not per-test
});

// This test fails: "unhandled rejection in click"
it('handles error', async () => {
  // Promise is caught, but vitest reports unhandled
  await userEvent.click(button);
});
```

Fix: set mock per-test instead.

```javascript
it('handles error', async () => {
  myMock.mockImplementation(() => Promise.reject(...));
  await userEvent.click(button);
  // Now caught promise is reported as handled
});
```

~10 tries isolated via bisection (test alone → test+hook). Lesson: mock setup in beforeEach is not free; prefer per-test for click handlers.

## Root Cause Analysis

### created_date_unix ÷ 1000

Initial reader assumed seconds; actual data is milliseconds. Found via live Trino probe (jus_vn created_date_unix values in the 1.7e12 range, not 1.7e9). Fixed before any test failures — validation upfront paid off.

### login_info Duality

CS-portal logins store `login_info = username` (string, not uid). Web logins store uid. Initial assumption: uid only. Trino schema inspection + sample rows revealed both. No code impact (guard checks `!== context.userId`, both usernames and uids work); just documented in memory.

## Lessons Learned

1. **Live SQL validation before reader code.** Saves 5–10 iterations of "why is this NULL / why is this a string?". Cost: 30min to walk schema + sample rows. Value: 0 integration surprises.

2. **Mock-hook resets are a smell.** beforeEach + mockReset can cause false unhandled-rejection reports in click handlers. Pattern: per-test mock impl, not global reset.

3. **404 for membership checks, not 403.** Leaking membership status via different status codes defeats the point of guardSegment. Use 404 consistently.

4. **Scoped git adds prevent concurrent-session stomps.** Explicit `git add path/file.ts` instead of `git add .` avoids accidentally staging Catalog/Schema changes from a parallel working-tree.

## Next Steps

- Commits on main (d239f93), not yet pushed to `second`.
- **Lessons-learned:** add "live SQL validation" and "mock-hook false positives" entries to `docs/lessons-learned.md`.
- **Memory:** document login_info duality + created_date_unix ÷1000 in user memory (may affect future jus_vn queries).
- **Prod deploy:** verify end-to-end on prod.gds.vng.vn (segment membership check, account/security label gating).

**Tests:** 33 route tests, 1425 server suite. All pass.
**Status:** DONE. Committed to main. Ready for deploy.
