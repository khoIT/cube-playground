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

## Success criteria

- A short baseline table (median/p90 per stage per outcome) recorded in this file.
- Each phase-3 candidate explicitly marked **confirmed-hot** or **dropped-cold** with its number.

## Risk

- Can't run live turns locally (no creds/Cube) → fallback: enable in a staging deploy and pull the log lines; do NOT proceed to phase 3 on assumptions.

## Open questions

- Is there an existing load-gen / replay script for chat turns, or do we drive manually via the UI?
</content>
