# Parallel-Emit Shim + Live Soak — Phase 05 Cutover Gate

**Date**: 2026-05-27 06:21
**Severity**: Low (de-risking infra; no user-facing change)
**Component**: chat-service observability (TurnTracer cutover gate)
**Status**: Resolved — soak passed 10/10, cutover recommended (not yet executed)

## What Shipped

The parallel-emit shim that was *deferred* in the 2026-05-26 cook session, plus the live soak it exists to enable.

1. **Shim** — `parallel-emit-shim.ts`: `RecordingObserver` captures the legacy inline dispatch, `RecordingSink` captures the shadow `TurnTracer`, `diffRecordings()` compares them position-by-position.
2. **Log writer** — `parallel-emit-log.ts`: append-only JSONL → `runtime/parallel-emit/diffs.jsonl`. Kept separate so the diff logic stays fs-free / unit-testable.
3. **Wiring** — `claude-runner.ts` takes an optional `tracer?` and drives `onSdkMessage`/`finalize` alongside the legacy emits (try/catch guarded). `turn.ts` builds the shadow tracer + recorder only when `OBS_PARALLEL_EMIT=true`; diffs after the loop. `config.ts` adds the flag (default off).
4. **Harness** — `run-parallel-emit-soak.ts`: fires N real questions at a live instance, drains SSE, summarizes the diff log with a cutover verdict.
5. **Tests** — `parallel-emit-shim.test.ts` (5), incl. an end-to-end test that drives a literal replica of the runner's legacy loop vs the tracer → byte-identical.

## Soak Result

Isolated instance on :3006 against a **DB copy** (kept the live :3005 untouched), `OBS_PARALLEL_EMIT=true`, 10 real questions through the live model with real Cube tool round-trips.

- **10/10 turns byte-identical**, 0 divergences, 290 events compared (`sdk_event=150`, `llm_call=96`, `tool_invocation=34`, `turn_finalized=10`).
- Max latency delta 15ms (independent `Date.now()` reads — excluded from the structural diff).
- No-double-write proof: per-turn DB rows equalled recorded legacy counts **exactly** (1×, not 2×).

Full report: `plans/reports/soak-260527-0555-parallel-emit-observability-cutover.md`.

## Decisions / Lessons

- **The cutover itself is invisible.** Same SQLite tables, same Langfuse traces — the soak proves byte-identity on purpose. Value is code-level: new destinations become a 10-line `TraceSink` instead of a hot-path edit; lets us delete `composite-observer.ts`. New *visible* data only arrives when a sink is added (structured logs, abort persistence).
- **Volatile fields must be excluded from the diff**, not normalized away blindly. Both paths read `Date.now()` independently, so `latencyMs`/`startedAt`/`endedAt`/`at` and the per-denial uuid `id` legitimately differ. Stripping exactly those (and nothing semantic) is what makes "match" meaningful — surfaced timing as an informational delta instead.
- **Replicate the real legacy loop in the equivalence test**, don't re-derive it. The unit test drives the actual `emit*` helpers in the runner's exact order so it proves the tracer matches the *runner*, not a second copy of the tracer.
- **Isolate soak writes via a DB copy + separate port** rather than enabling the flag on the running dev server — env can't be injected into a live process, and SQLite WAL allows only one writer.

## Unresolved / Follow-ups

- Abort path (`turn_aborted`) and `permission_decision` not exercised live (all turns completed; bypassPermissions mode) — unit-tested only. Include a cancelled turn in the post-cutover soak.
- Single game sampled (`ballistar`); a mixed-game soak (`ptg`/`cfm_vn`) would close schema-shape coverage.
- Cutover not executed. Higher-value alternative raised: wire an abort sink so cancelled turns become queryable (genuinely new data, vs the zero-delta refactor).
