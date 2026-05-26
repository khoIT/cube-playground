# Phase 05 — Observability Unification

## Context Links

- SDK review §3.#3 — observability unification
- `chat-service/src/observability/sdk-event-extractor.ts` — side-channel raw SDK event handling
- `chat-service/src/observability/composite-observer.ts` — fan-out to current sinks
- `chat-service/src/core/claude-runner.ts:173–213` — three observer dispatch sites
- Langfuse tracer module (existing)

## Overview

- **Priority:** P1 — unblocks confident expansion (Phase 06 research mode needs reliable traces)
- **Status:** Pending
- **Description:** Two parallel observability paths exist (raw SDK extractor + Langfuse tracer); both reparse SDK messages, risk drift. Collapse into one tracer that consumes the SDK firehose and emits typed signals to all sinks (DB rows, Langfuse spans, structured logs).

## Key Insights

- The three dispatch sites in `claude-runner.ts` (LLM call, tool invocation, turn finalised) re-derive context the SDK already encoded. One canonical event normaliser fixes drift.
- Land behind a **parallel-emit shim** first (both old + new run in parallel, compared); cut over only after a week of zero-diff in metrics.
- Cancellation (Phase 04) adds a new completion code; design the new tracer to natively model abort reasons.

## Requirements

**Functional**
- New module `chat-service/src/observability/turn-tracer.ts` exposing:
  - `class TurnTracer { onSdkMessage(msg) ; finalize(usage) ; abort(reason) }`
  - Emits typed events: `LlmCall`, `ToolInvocation`, `Thinking`, `TurnFinalized`, `TurnAborted`.
- New sink interface `TraceSink` with `emit(event: TraceEvent)`.
- Existing sinks adapted:
  - `LangfuseSink` (current tracer behind the interface).
  - `DbSink` (writes to `llm_calls`, `tool_invocations`, `sdk_events`).
  - `StructuredLogSink` (pino-compatible JSON lines).
- `claude-runner.ts` reduced to a single `tracer.onSdkMessage(msg)` call per iteration.
- Old observer dispatch (composite-observer, sdk-event-extractor) deleted **after** parallel-emit cutover.

**Non-functional**
- Zero loss of existing signals; new emitter produces a strict superset.
- Per-turn overhead unchanged (single normaliser is cheaper than today's three).
- Sink failures isolated (one bad sink can't break the others).

## Architecture

```
SDK message stream
  └─ TurnTracer.onSdkMessage()
       ├─ normalise → TraceEvent
       ├─ for sink of sinks: try { sink.emit(event) } catch (e) { log }
       └─ updates internal counters (tokens, tools, cost)

claude-runner.run() loop
  for await (const msg of iter) {
    if (signal.aborted) { tracer.abort('user_cancel'); break; }
    tracer.onSdkMessage(msg);
    for (const event of mapSdkMessage(msg)) yield event;
  }
  tracer.finalize({ inputTokens, outputTokens, costUsd });
```

## Related Code Files

**Modify**
- `chat-service/src/core/claude-runner.ts` (replace 3 dispatch sites with 1 call)
- `chat-service/src/api/turn.ts` (instantiate TurnTracer with sinks; remove old observer wiring)
- `chat-service/src/observability/langfuse-tracer.ts` (adapt to `TraceSink` interface)
- `chat-service/src/db/observability-store.ts` (consumed by DbSink — schema unchanged)

**Create**
- `chat-service/src/observability/turn-tracer.ts`
- `chat-service/src/observability/sinks/langfuse-sink.ts`
- `chat-service/src/observability/sinks/db-sink.ts`
- `chat-service/src/observability/sinks/structured-log-sink.ts`
- `chat-service/src/observability/sinks/parallel-emit-shim.ts` (temporary)
- `chat-service/src/observability/__tests__/turn-tracer.test.ts`
- `chat-service/src/observability/__tests__/sinks-isolation.test.ts`

**Delete (after parallel-emit cutover)**
- `chat-service/src/observability/sdk-event-extractor.ts`
- `chat-service/src/observability/composite-observer.ts`

## Implementation Steps

1. Define `TraceEvent` discriminated union (`LlmCall`, `ToolInvocation`, `Thinking`, `TurnFinalized`, `TurnAborted`). Pin field names; document each.
2. Implement `TurnTracer` consuming `(turnId, sessionId, sinks)`. Internal `onSdkMessage` switches on message type, computes deltas, calls `sink.emit`.
3. Port each sink:
   - **DbSink**: identical row writes as today; wraps existing buffered recorder.
   - **LangfuseSink**: wraps current tracer's create-span logic.
   - **StructuredLogSink**: new; emits one JSON line per event with stable schema.
4. Build `ParallelEmitShim`: receives messages, calls BOTH the new tracer AND the old observer; logs diffs (event count, field mismatch) per turn.
5. Wire shim behind `OBS_PARALLEL_EMIT=true`. Default true in staging, false in prod for week 1.
6. Soak in staging — collect diff report. Iterate on tracer until diff is zero across 1000 turns.
7. Flip prod to parallel emit; verify zero diff for 1 week.
8. Cutover: remove old observer; delete `sdk-event-extractor.ts` + `composite-observer.ts`.
9. Add cancellation hook: `tracer.abort(reason)` writes `TurnAborted` event with reason; sinks persist abort + reason on chat_turns row.
10. Tests:
    - `turn-tracer.test.ts` — fixture SDK messages → expected TraceEvent stream.
    - `sinks-isolation.test.ts` — failing sink doesn't kill tracer; counters still update.

## Todo List

- [ ] TraceEvent + TurnTracer
- [ ] DbSink, LangfuseSink, StructuredLogSink
- [ ] ParallelEmitShim + staging soak
- [ ] Diff-zero confirmed in staging
- [ ] Parallel emit in prod (1 week)
- [ ] Cutover; delete old observer modules
- [ ] Cancellation reason wiring (depends Phase 04)
- [ ] Tracer + isolation tests
- [ ] Dashboard: per-event-type emit rate, sink-failure rate

## Success Criteria

- Zero diff between old and new emitters across 7 prod days (count + field-by-field).
- Sink failure in one sink does not drop events from another (test enforced).
- `claude-runner.ts` observer code shrinks from ~40 LOC to <10 LOC.
- Cancellation reason ends up on the chat_turns row + the Langfuse span.

## Risk Assessment

- **R1 Silent signal loss** — mitigated by parallel-emit + diff dashboard; cutover only after 7-day green.
- **R2 Performance regression** — new normaliser is one fewer pass than today; benchmark to confirm.
- **R3 Schema lock-in** — `TraceEvent` shape exposed to sinks. Use semver in module docs; treat as internal API.

## Security Considerations

- StructuredLogSink must redact prompt bodies + tool args (already redacted upstream — re-verify).
- Langfuse keys read from existing env; no new credential surface.

## Next Steps

- Phase 06 research mode hooks the new tracer for higher-fidelity latency / token traces.
- Phase 09 test coverage builds on the new tracer's testability.
