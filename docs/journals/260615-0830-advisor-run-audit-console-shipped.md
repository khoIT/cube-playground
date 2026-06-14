# Advisor Run Audit Console — Durable Persistence Shipped

**Date**: 2026-06-15 08:30
**Severity**: Low
**Component**: Optimization Advisor / Admin Observability
**Status**: Completed

## What Happened

Shipped Advisor Run Audit Console — persistence + observability surface for Optimization Advisor agent runs. Previously, advisor investigations lived in logger + in-memory only, which meant when a run timed out (e.g., cold Trino cube_query failures), there was zero visibility into which query failed or how long it ran. Now every run, turn, tool-call, cost metric, and SSE frame persists to segments.db (migration 055: 4 new tables) and is inspectable at `/admin/dev/advisor-audit` with actionable failure hints (e.g., "cold Trino detected — try warming up or narrowing time window").

## Technical Details

**Schema:** runs, turns, tool_calls, cost_events tables in segments.db. RunRecorder injected into advisor.ts flow, flushed in guarded finally block so it cannot break a live turn.

**Wire Safety Decision:** Tool input + truncated resultText added to RuntimeEvent for recorder context, but code review (H1) caught that SSE bridge serializes the full event. Fix: strip both fields at SSE edge in advisor.ts (recorder-only fields never leak to client). Tested explicitly including recorder-throws and timeout-killed-cube_query-recorded-as-failed-with-duration.

**Test Coverage:** Server suite 1638 pass / 1 skip. Frontend 2449 pass. No new tsc errors. PII guard green. Zero agent behavior change — surface + hints only.

## Decision

**Persistence seam over scattered logging:** Centralized RunRecorder as dependency injection meant we could test failure cases (recorder-throws, query timeout) without touching live turn logic. Alternative (logging decorators) would have been harder to test for complete failure scenarios.

**Strip at wire edge, not optional field:** Rather than let recorder-only fields ride optional through SSE, explicitly strip at the boundary. More verbose (1 extra filter) but makes contract explicit and prevents accidental future leaks if someone assumes RuntimeEvent is serializable everywhere.

## Lessons Learned

1. **Recorder-only fields on shared events must be stripped at the wire boundary**, not left optional and "ignored by default." Explicit > implicit.
2. **Persistence seams tested with failure injection** (recorder.throws, killed queries) catch edge cases that scattered logging would miss.
3. **Cold Trino visibility matters for operability.** Run audit now surfaces query duration + failure reason, making "add metrics dashboard" redundant for advisor troubleshooting.

## Next Steps

None — feature shipped. Future work (not blocking): span-level cost attribution (which LLM calls dominated the cost?) and cross-run query plan cache heat analysis.

---

**Status:** DONE
**Summary:** Advisor Run Audit Console shipped with durable persistence + admin surface. One wire-safety decision: strip recorder-only fields at SSE edge. All tests pass; zero agent behavior change.
**Concerns:** None.
