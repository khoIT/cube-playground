# Phase 01 — Profiling & baseline

**Priority:** P0 (gates phases 2–3). **Status:** pending.

## Goal

Capture real per-stage turn latency before committing to any perf change. Confirm or kill each hypothesized hot spot with numbers.

## Steps

1. Run chat-service with profiling on:
   ```bash
   CHAT_TURN_PROFILING=1 npm run chat:dev
   ```
   (or set in `.env.local`). Requires Cube up + LiteLLM creds.
2. Drive a representative set of turns:
   - cold cache miss (new question), warm cache miss (new question, warm meta),
   - cache hit (repeat question), chart-producing turn (refresh hook path),
   - clarify/disambiguation turn (memory cascade exercised).
3. Collect the `[turn] timing` log lines (field `turnTiming`). Each carries
   `outcome`, `totalMs`, and `stages[] = {label, at, delta}`.
4. Tabulate `delta` per stage across N turns; compute median + p90.

## Stage map (already instrumented)

`compose` → `meta-hash` → (`cache-replay` | `llm-first-event` → `llm-done`) → `persist`.

## What to decide from the data

- **`delta(meta-hash)`** — if ~0 on warm turns (expected), the "reorder cache lookup before meta" idea is dead. Only act if p90 is material on miss turns.
- **`delta(llm-first-event)` and `llm-done − llm-first-event`** — expected to dominate. If so, server-side micro-opts are noise; decomposition is the win.
- **`delta(persist)`** — if non-trivial, phase 3 KV-cache/SQLite batching is justified; if microseconds, skip it.
- **cache-hit `totalMs`** — the only path where server overhead is visible to users. Optimize here only if > ~30–50ms.

## Baseline (captured 2026-06-01, `local` ws, ballistar, n=5 miss + 4 hit)

`CHAT_TURN_PROFILING=1`, identical prompt "Show total daily revenue for the last 7 days". Miss turns forced via `X-Bypass-Cache: 1`.

**Cache MISS (LLM path) — median total 33,550 ms:**

| stage | median Δ | p90 Δ | % of turn |
|---|---|---|---|
| compose | 1.2 ms | 6.4 ms | ~0% |
| llm-first-event | 363 ms | 894 ms | 1.1% |
| **llm-done (model loop)** | **33,182 ms** | 33,793 ms | **98.9%** |
| persist | 5.2 ms | 21 ms | ~0% |

**Cache HIT (replay path) — median total 1.5 ms** (p90 2.9 ms): compose 0.53 ms · meta-hash 0.03 ms · cache-replay 0.45 ms.

### Verdict (data-backed)

- **The LLM call is 98.9% of a miss turn.** Everything the decomposition touched (compose + persist + orchestration) totals **~7 ms = 0.02%** of a 33.5 s turn.
- **The response cache is the only optimization that matters: 33,550 ms → 1.5 ms on a hit (~22,000×).** Measured, real. The refactor's `try-response-cache-hit` extraction sits on this path and works (`cache_hit=1`).
- **`meta-hash` = 0.03 ms** steady-state → the "meta before cache lookup" concern is confirmed a non-issue (LRU cache warm).

### Phase-3 candidates — all DROPPED-COLD with numbers

| candidate | would save | of a 33.5 s turn | verdict |
|---|---|---|---|
| KV-cache hit 2→1 round-trip | sub-ms (persist is 5 ms total) | ~0% | **drop** |
| memory-cascade parallelize | sub-ms (in-process SQLite) | ~0% | **drop** |
| stream-registry O(n)→O(1) | sub-ms at this concurrency | ~0% | **drop** (revisit only under high concurrent-turn load) |

Optimizing server-side stages = shaving µs off a 33 s turn. Confirmed not worth it; the cache is the lever.

## Success criteria — MET

- ✅ Baseline table recorded (above).
- ✅ Every phase-3 candidate marked dropped-cold with its number.

## Risk

- Can't run live turns locally (no creds/Cube) → fallback: enable in a staging deploy and pull the log lines; do NOT proceed to phase 3 on assumptions.

## Open questions

- Is there an existing load-gen / replay script for chat turns, or do we drive manually via the UI?
</content>
