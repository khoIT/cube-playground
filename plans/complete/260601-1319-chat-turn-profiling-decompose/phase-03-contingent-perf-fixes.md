# Phase 03 — Contingent perf fixes

**Priority:** P1, **conditional**. **Status:** pending (only after phase 1 confirms a stage is hot).

Each item below ships ONLY if phase 1 numbers justify it. Default posture: do not optimize microseconds.

## Candidates (each gated on a phase-1 number)

### A. KV-cache hit: 2 SQLite round-trips → 1
- **Where:** `chat-service/src/cache/kv-cache-store.ts:113-116` — `kvGet()` reads, then a separate `UPDATE hit_count, last_hit_at`.
- **Fix:** single statement (read + bump) or defer the hit-count bump to a batched/async write.
- **Gate:** ship only if `delta(persist)` or KV-heavy paths (leaderboard/debug-search) show measurable cost. In-process SQLite write is ~µs — likely **dropped-cold**.

### B. Disambiguation memory cascade: serialize → parallel
- **Where:** `chat-service/src/cache/disambiguate-memory-merge.ts:33-44` — `getResolutions` → `fillGapsFromMemory` → `fillGapsFromUserPrefs` run sequentially (3 independent reads).
- **Fix:** `Promise.all` the independent reads, or one transaction.
- **Gate:** ship only if clarify-turn profiling shows the cascade > ~5–10ms. SQLite reads are sync/in-process, so parallelism gives little — **likely dropped** unless a read hits the network.

### C. Stream-registry O(n) operations
- **Where:** `core/stream-registry.ts:107-111` (running-count linear scan per register) and `:143-147` (`splice(0, n)` ring trim, O(n) per overflow).
- **Fix:** maintain a `runningCount` integer invariant; replace array+splice with head/tail circular buffer.
- **Gate:** matters only under high concurrent-turn load (many simultaneous streams). Confirm with a concurrency test before doing it; otherwise **defer**.

### D. Refresh hook: sequential per-chart Cube `/load`
- **Where:** cache-hit refresh (`turn.ts` `buildRefreshHook` → re-executes chart queries).
- **Fix:** batch/parallelize chart re-fetches.
- **Gate:** ship only if cache-hit `totalMs` on chart turns is user-visible (> ~50ms) and dominated by sequential `/load`s. **Most promising of the four** if charts are common.

## Success criteria

- Every candidate has a recorded verdict: shipped (with before/after number) or dropped (with the number that killed it).
- No regression: 869 chat-service tests green.

## Risk

- Optimizing un-profiled code = churn for nothing. The gate IS the mitigation — no number, no change.

## Open questions

- Expected steady-state concurrent-turn count? Decides whether C is ever worth it.
</content>
