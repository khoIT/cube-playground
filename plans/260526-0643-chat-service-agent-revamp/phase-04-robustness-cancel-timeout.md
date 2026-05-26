# Phase 04 — Cancellation, Timeouts, Error UX

## Context Links

- SDK review §3.#9 — cancellation & timeout handling
- `chat-service/src/core/claude-runner.ts:145–207` — query iterator runs to completion, no abort path
- `chat-service/src/core/stream-registry.ts` — already tracks running turns (foundation for cancel routing)
- `chat-service/src/core/session-manager.ts` — per-session mutex; release path must run on cancel

## Overview

- **Priority:** P1
- **Status:** Pending
- **Flag:** `CHAT_TURN_TIMEOUT_MS` (numeric env, 0 = off)
- **Description:** Two failure modes today: a model loop or slow upstream hangs the turn indefinitely; a user wanting to abandon a turn has no path. Add: (1) per-turn `AbortController`, (2) configurable hard timeout, (3) `POST /api/chat/turn/:id/cancel` endpoint, (4) typed SSE error events the UI can render cleanly.

## Key Insights

- `stream-registry` already maps `turnId → sessionId` and tracks running turns — natural place to hold the AbortController.
- Cancellation must release the session mutex (`session-manager`) or the next turn deadlocks.
- Need SDK confirmation that `query()` accepts an abort signal in v0.3.150 (open question from SDK review).
- Timeouts and user-cancels share 90% of the codepath; differ only on the emitted error event reason.

## Requirements

**Functional**
- `claude-runner.RunParams` accepts optional `signal: AbortSignal`.
- `stream-registry` stores per-turn `{ controller: AbortController }`; exposes `abort(turnId, reason)`.
- New endpoint `POST /api/chat/turn/:turnId/cancel` → calls `registry.abort(turnId, 'user_cancel')`; returns 202.
- Hard timeout configured by `CHAT_TURN_TIMEOUT_MS` (default 120000); when crossed, registry aborts with reason `timeout`.
- New SSE event `turn_aborted { reason: 'user_cancel' | 'timeout' | 'server_error', message }` always followed by `turn_finalized`.
- Mutex released, session row marked clean, partial assistant text persisted (so UI can show "[cancelled]" replay).
- Cancellation MUST NOT clear `sdk_conversation_id` (Phase 01) or focus (Phase 02) — cancel ≠ session end.

**Non-functional**
- Abort propagates to running tool calls within 500ms.
- Cancel HTTP round-trip <100ms (synchronous abort signal; SSE stream emits `turn_aborted` async).
- Timeout fires within ±2s of configured value.

## Architecture

```
POST /api/chat/turn/:turnId/cancel
  └─ registry.abort(turnId, 'user_cancel')
       ├─ controller.abort()                  (signals query iterator)
       ├─ emit turn_aborted SSE
       └─ release session mutex

claude-runner.run()
  ├─ const controller = params.signal ? null : new AbortController()
  ├─ buildQueryOptions('standard', { abortSignal: signal })
  ├─ for await (msg of iter) {
  │     if (signal.aborted) break;
  │     ...
  │   }
  └─ finally → ensure mutex release + finalize

Timeout
  └─ setTimeout(() => registry.abort(turnId, 'timeout'), CHAT_TURN_TIMEOUT_MS)
     (cleared on natural completion)
```

## Related Code Files

**Modify**
- `chat-service/src/core/claude-runner.ts` (RunParams.signal; query() invocation; cleanup)
- `chat-service/src/core/query-options-presets.ts` (accept `abortSignal` override)
- `chat-service/src/core/stream-registry.ts` (store controller; expose abort())
- `chat-service/src/core/sse-stream.ts` (new event type)
- `chat-service/src/core/session-manager.ts` (ensure release on abort path)
- `chat-service/src/api/turn.ts` (wire signal + timeout, persist partial assistant text)
- `chat-service/src/config.ts` (`chatTurnTimeoutMs`)

**Create**
- `chat-service/src/api/cancel-turn.ts`
- `chat-service/src/__tests__/turn-cancel-roundtrip.test.ts`
- `chat-service/src/__tests__/turn-timeout-roundtrip.test.ts`

**FE (pairs naturally with Phase 03 chip work)**
- `src/pages/Chat/turn-cancel-button.tsx`
- `src/pages/Chat/use-cancel-turn.ts`

## Implementation Steps

1. **Spike** (small): verify SDK v0.3.150 `query()` accepts an `AbortSignal` (or equivalent). If not, document workaround (wrap iterator + break on signal).
2. Extend `stream-registry.ts` to store `{ controller }` per turn; add `abort(turnId, reason)`.
3. Refactor `claude-runner.run()` to honour `params.signal`; `finally` block always releases pending tool flushes.
4. Add `cancel-turn.ts` route module → 404 if turnId unknown to registry, 202 on abort initiated.
5. `turn.ts`: create AbortController per request; register with stream-registry; start timeout timer; pass signal to runner.
6. Emit `turn_aborted` SSE before `turn_finalized`; persist partial assistant text via `appendTurn(..., assistantText: partial, ...)`.
7. Mutex hygiene: ensure `release()` runs in `finally` even when iterator throws or signal fires.
8. FE: `useCancelTurn(turnId)` hook + `TurnCancelButton` rendered while turn is streaming (existing turn-state state machine).
9. Tests:
   - `turn-cancel-roundtrip.test.ts` — start turn, cancel mid-stream, assert SSE order, partial text persisted, mutex released, focus + sdk_conv_id preserved.
   - `turn-timeout-roundtrip.test.ts` — simulate slow SDK (sleep iterator), assert timeout fires within window.

## Todo List

- [ ] Spike SDK abort surface
- [ ] stream-registry abort path
- [ ] claude-runner signal honouring
- [ ] cancel-turn endpoint
- [ ] timeout timer + cleanup
- [ ] turn_aborted SSE event + partial persistence
- [ ] FE cancel button + hook
- [ ] Cancel + timeout round-trip tests
- [ ] Mutex release audit

## Success Criteria

- Cancel button visible during streaming turn; click → turn ends in ≤2s with `turn_aborted` + `turn_finalized`.
- Timeout fires deterministically; `chat_turns` row marked with stop_reason `aborted_timeout`.
- Partial assistant text persisted and replayable.
- Zero deadlocked sessions in soak test (10k turns, 5% canceled, 1% timed-out).
- `sdk_conversation_id` + focus preserved across cancel (verified by next-turn continuing context).

## Risk Assessment

- **R1 SDK abort missing** — spike gates implementation. Workaround: iterator-wrapping `break` on signal still works (no upstream cancellation, but local loop exits and SDK subprocess gets reaped when generator GC'd).
- **R2 Mutex leak** — most subtle failure mode. Mitigation: dedicated soak test + assertion that mutex map is empty after each scenario.
- **R3 Half-flushed observability** — buffered recorder must flush on abort to keep traces honest. Add `recorder.flushOnAbort()` path.
- **R4 Race: cancel arrives after natural completion** — abort() must be a no-op when registry no longer has the turn. Return 410 Gone, log debug.

## Security Considerations

- Cancel endpoint must check session ownership before aborting (same auth as turn POST).
- Rate-limit cancel endpoint to prevent abort floods.

## Next Steps

- Phase 05 (observability) consumes the new `turn_aborted` event for accurate completion-rate metrics.
- Phase 06 (research mode) needs reliable cancellation — research turns may run longer; cancel UX is the safety valve.
