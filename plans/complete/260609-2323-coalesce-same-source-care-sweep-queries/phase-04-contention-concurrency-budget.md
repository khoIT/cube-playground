---
phase: 4
title: "Cross-feature Cube contention budget"
status: pending
priority: P1
effort: "2h"
dependencies: []
---

# Phase 4: Cross-feature Cube contention budget

## Overview

Coalescing cuts the sweep's query *count*; this phase cuts the *contention* that turns
those queries slow. The two are independent levers — and for "a reset takes minutes,"
contention is likely the larger amplifier. This phase can land **before, after, or
without** the coalescing phases (no code overlap with the matcher/grouping work), and
may be the fastest single relief.

## The problem (verified this session)

The concurrency pools are separate and **additive on one `cube_api`**, with no global
cap:

| Feature | Pool | Source |
|---------|------|--------|
| Care sweep | `SWEEP_CONCURRENCY = 6` | `care-case-sweep.ts:41` |
| Dashboard cards | `CARD_CONCURRENCY = 4` | `services/card-runner.ts:149` |
| Member360 | `QUERY_CONCURRENCY = 3` | `services/member360-runner.ts:35` |
| Artifact sweep | `2` | `services/artifact-validation-sweep.ts:512` |

A reset fired while the dashboard is cold-loading puts **up to ~13 concurrent cold-Trino
scans** on a `cube_api` that cannot service them — every query then crawls toward the
`CUBE_FETCH_TIMEOUT_MS = 15_000` ceiling (the `[card-runner] … timed out after 15s`
storm seen in the logs). Coalescing 6→3 sweep queries does not help if they queue behind
4 card + 3 member360 scans. The fix is to bound the *total* concurrent load on `cube_api`,
not each feature's slice of it.

## Requirements

**Functional**
1. **A single shared concurrency limiter in front of `loadWithCtx`** (the one choke point
   every feature's Cube query passes through — `services/cube-client.ts`). A global
   semaphore caps *total* in-flight Cube `/load` calls (target: a value Trino/cube_api can
   actually serve concurrently — start ~4-6; make it env-tunable, e.g.
   `CUBE_MAX_INFLIGHT`). Per-feature pools stay as they are (they still bound a single
   feature's burst); the global cap prevents the *sum* from stampeding.
2. **Sweep yields to interactive load (or vice-versa) — pick one policy, documented:**
   either (a) the global limiter is FIFO and the sweep simply takes its turn (simplest,
   KISS), or (b) sweep queries acquire at a lower priority than card/member360 so a
   user-facing dashboard never waits behind a background reset. Default to (a) unless the
   baseline (Phase 0) shows interactive latency regressing during a sweep.
3. **Reset/re-sweep should not contend with its own dashboard prefetch.** The reset route
   (`POST /api/care/cases/reset?resweep=true`) clears then re-sweeps; ensure it does not
   also trigger a card-runner refresh for the same game in parallel. If it does, sequence
   them (sweep then prefetch, or prefetch off the already-warmed cache).
4. **Env kill-switch / passthrough:** `CUBE_MAX_INFLIGHT` unset or `0` → no global cap
   (current behaviour), so the change is instantly reversible in prod.

**Non-functional**
- The limiter must not deadlock with the per-feature pools (global cap ≥ 1; never block a
  query that already holds a per-feature slot from acquiring the global slot in a way that
  can't drain). Acquire global → run → release; per-feature pool is the outer bound.
- No change to query *correctness* — purely a scheduling/throughput change. Existing
  timeout + abort behaviour preserved.

## Architecture

One limiter wrapping the fetch in `cube-client.ts` (`loadWithCtx` / the shared low-level
caller), reused by every feature. Do **not** scatter limiters per feature — that
recreates the additive-pools problem. Reuse `bounded-concurrency.ts` primitives if they
fit a long-lived shared semaphore; otherwise a tiny `cube-inflight-limiter.ts` (a counting
semaphore + waiter queue, < 80 LOC).

```
feature pool (sweep 6 / card 4 / member360 3)   ← unchanged per-feature burst bound
        │  each query →
   loadWithCtx
        │  acquire(globalSemaphore, CUBE_MAX_INFLIGHT)   ← NEW: caps the SUM
        │  fetch (15s timeout, no retry)                  ← unchanged
        └  release
```

## Related Code Files

- Modify: `server/src/services/cube-client.ts` (wrap the shared fetch in the global limiter;
  read `CUBE_MAX_INFLIGHT`)
- Create (if a primitive doesn't already fit): `server/src/services/cube-inflight-limiter.ts`
- Read: `server/src/services/bounded-concurrency.ts` (reuse if suitable),
  `server/src/services/card-runner.ts`, `server/src/care/care-sweep-execute.ts`,
  `server/src/routes/care-cases.ts` (reset route — item 3 sequencing)
- Modify: `server/test/` — a limiter test (N callers, cap K → never more than K concurrent)
  and a no-cap-when-unset test

## Implementation Steps

1. **TDD-first:** limiter unit test — fire M concurrent acquirers with cap K, assert peak
   concurrency never exceeds K, all eventually resolve (no deadlock/starvation), and
   `CUBE_MAX_INFLIGHT` unset → unbounded passthrough.
2. Implement the semaphore; wrap the single shared fetch path in `cube-client.ts`.
3. Decide + implement the policy (2): FIFO first. Only add sweep-deprioritization if
   Phase 0 / a quick check shows interactive latency regressing under a concurrent sweep.
4. Audit the reset route (3): ensure clear→re-sweep doesn't fan out a parallel card refresh
   for the same game; sequence if it does.
5. tsc + full server suite green. Re-run the Phase 0 measurement *with a concurrent
   dashboard load* to confirm the reset wall time under contention drops.

## Success Criteria

- [ ] A single global limiter caps total in-flight Cube `/load` calls; per-feature pools intact.
- [ ] Limiter test: peak concurrency ≤ cap, no deadlock, unset env = passthrough.
- [ ] Reset re-sweep does not race its own dashboard prefetch for the same game.
- [ ] Measured: reset wall time *during a concurrent dashboard load* drops vs the Phase 0
      baseline (the real-world "minutes" scenario).
- [ ] `CUBE_MAX_INFLIGHT` unset/0 → current behaviour (reversible).

## Risk Assessment

| Risk | L×I | Mitigation |
|------|-----|-----------|
| Global cap set too low → interactive dashboard feels slower (everything queues) | M×M | Env-tunable; start at a value matching cube_api/Trino real concurrency; measure, don't guess |
| Deadlock between per-feature pool and global semaphore | L×H | Single acquire/release around fetch only; global cap ≥ 1; limiter test asserts drain |
| Limiter scattered per feature recreates additive problem | M×M | One limiter at the shared `loadWithCtx` choke point — enforce in review |
| Sweep starves under FIFO behind continuous interactive load | L×M | Acceptable for a background reset; escalate to priority policy (2b) only if observed |

## Next steps

Independent lever. Ship alone for fast relief, or alongside the coalescing phases —
together they attack both query count (Phases 1-3) and contention (this phase), which is
the combination needed to move a reset from minutes toward seconds.
