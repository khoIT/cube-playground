# Phase 02 — Runtime instrumentation (tool-call timing, event buffering, wire recorder)

## Overview
- **Priority:** P0. **Status:** ✅ Done. **Depends on:** 01
- Make `agent-runtime.ts` feed the `RunRecorder`: time each tool call, buffer SSE events, persist run+turn+tool_calls+events at turn end — alongside the existing `writeTurnAudit`. Additive; live turn behavior unchanged.

## Key context (verified)
- `agent-runtime.ts` builds `toolCalls: string[]` and writes turn audit in a `finally` block. It already sees `tool_call`, `tool_result` (with `callId`, `ok`), `cost`, `done`, `denied`, `error`, `assistant_delta` events (normalized in `agent-event-normalizer.ts`).
- Tool result is matched to its call by `callId` today only loosely (names). For duration we pair `tool_call`→`tool_result` by `callId`.
- Session holds `totalCostUsd`, `turnIndex`, scope/goal/owner/model in `agent-session-registry.ts`.

## Architecture
- Inject a `RunRecorder` into the runtime (default `sqliteRunRecorder`, overridable for tests — mirror the existing logger injection).
- During a turn, maintain a per-turn buffer:
  - on `tool_call`: push `{ callId, tool, seq, startedAt }` to an open-calls map; append event frame.
  - on `tool_result`: find open call by `callId`, set `endedAt`, `duration_ms`, `state` (`ok` if `ev.ok` else `failed`), capture error text if present; append event frame.
  - on `denied`: record a tool-call row `state='denied'` with reason as error_message; append event frame.
  - on `assistant_delta`: accumulate narration; append event frame.
  - on `cost`: update turn cost delta; append event frame.
- In the existing `finally` (where `writeTurnAudit` runs): compute `stop_reason`/`abort_cause`/`duration_ms`, then `recorder.flushTurn({ run, turn, toolCalls, events })`. Recorder failures must **never** break the turn (wrap in try/catch, log + continue).
- Capture `input_json`: the runtime sees tool inputs via the SDK tool-call event if available; if inputs aren't in the normalized event, extend `agent-event-normalizer.ts` minimally to pass `tool_call.input` through (PII-safe: agent-issued specs). Store `output_digest` from the (already redacted) tool result summary text/structuredContent.

## Related code files
**Modify:**
- `server/src/advisor/agent/agent-runtime.ts` — buffer + flush; inject recorder.
- `server/src/advisor/agent/agent-event-normalizer.ts` — pass through `tool_call.input` + `tool_result` error text if not already present (minimal).
- `server/src/advisor/agent/agent-session-registry.ts` — only if needed to expose model/owner for the run row (read-only).
- `server/src/advisor/agent/agent-types.ts` — extend RuntimeEvent for `input`/error fields if added.

## Implementation steps
1. Add optional `recorder` param to the runtime turn fn; default to `sqliteRunRecorder`, tests pass `noopRunRecorder` or a capturing fake.
2. Add the per-turn buffer + callId pairing for durations/states.
3. Normalizer: thread `input` (tool_call) + error message (tool_result) — keep PII-free.
4. Flush in `finally`; guard with try/catch so persistence never aborts a turn.
5. Update `recordRun` upsert each turn (turn_count, total_cost, last_active_at, final_stop_reason, had_error).

## Todo
- [ ] inject RunRecorder (default sqlite, test override)
- [ ] per-turn buffer: tool_call/result pairing → duration + state + error
- [ ] denied → tool-call row state='denied'
- [ ] narration + cost accumulation; event frames buffered
- [ ] normalizer passes input + error text (PII-free)
- [ ] flush at turn end, fully guarded (never breaks a turn)
- [ ] tests: deterministic stub-SDK turn → recorder receives run+turn+tool_calls+events; a forced timeout records `stop_reason='timeout'` + the failed `cube_query` tool call with duration+error

## Success criteria
- A stub-SDK turn that calls `diagnose` (ok) then `cube_query` (timeout/error) persists: run row, 1 turn row, 2 tool-call rows (1 ok, 1 failed with error + duration_ms > 0), and ≥4 event frames.
- Recorder throwing does **not** change the SSE the client receives nor the turn's stopReason (regression guard).
- Existing guardrail/runtime tests still pass (turns/budget/timeout/abort/oauth/canUseTool deny).

## Risks
| Risk | Mitigation |
|---|---|
| Persistence error aborts a live turn | Flush wrapped in try/catch; log + continue; never rethrow into the turn loop. |
| Normalizer change leaks PII into input_json | Inputs are aggregate query specs; reuse redaction; no-PII test scans the agent dir incl. these files. |
| callId missing on some SDK events | Fall back to FIFO pairing within the turn; mark duration null if unpaired. |

## Security
- All persisted I/O stays on the allowlist; outputs persisted post-redaction; no new PII surface.
