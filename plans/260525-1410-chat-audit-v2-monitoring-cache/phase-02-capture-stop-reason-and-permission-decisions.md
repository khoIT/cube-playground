# Phase 02 — Capture & display stop_reason + permission_decision

## Context Links
- `chat-service/src/observability/sdk-event-extractor.ts:44-79` (`emitLlmCall` — currently passes `stopReason: undefined`)
- `chat-service/src/observability/observer-types.ts:23-47` (LlmCallEvent — already has `stopReason?: string`)
- `chat-service/src/observability/llm-trace-recorder.ts:60-81` (onLlmCall persists stop_reason if present)
- `chat-service/src/db/observability-migrate.ts:30` (`stop_reason` column already exists)
- `chat-service/src/core/claude-runner.ts:160-188` (msg loop dispatching to extractor)
- `chat-service/src/core/sse-stream.ts:124-137` (result event currently exposes cost/tokens but NOT stop_reason)
- `src/pages/DevAudit/turn-llm-calls-section.tsx:43-72` (renders the `Stop` column — currently shows `—` because data is null)

## Overview
- Priority: P1
- Status: completed
- Capture stop_reason on every assistant LLM call; capture permission_decision SDK events into a small dedicated table; surface both in the audit UI.

## Key Insights
- `llm_calls.stop_reason` column is already created. The Recorder writes `ev.stopReason ?? null`. The bug is upstream: `emitLlmCall` hardcodes `stopReason: undefined` because the SDK assistant message does not carry stop_reason — only the final `result` message does.
- Therefore the capture strategy must: (a) buffer the last `stepIndex` per turn during the loop, (b) on the `result` SDK message, UPDATE the last llm_calls row with the result's stop_reason, OR add a new observer hook `onTurnFinalized` that records turn-level stop_reason on chat_turns directly.
- KISS choice: add `stop_reason TEXT` to `chat_turns` (additive migration). Populate from the result message. The per-call column stays nullable and only fills when per-step stop_reason is later derivable (future SDK).
- For permission_decisions: the SDK emits SDK messages with `type === 'system'` and `subtype === 'permission_decision'` (verify exact shape at implementation time via raw sdk_events). Persist into a dedicated table for query speed and avoid relying on JSON path queries.

## Requirements

Functional:
- Each assistant chat_turns row carries a `stop_reason` (e.g. `end_turn` / `tool_use` / `max_tokens` / `stop_sequence` / `refusal`).
- A new table `permission_decisions(id, turn_id, tool_name, decision, reason, at)` is populated for every permission system message.
- Audit UI: turn-llm-calls-section shows a colored pill per row (`end_turn`→green, `tool_use`→amber, `max_tokens`/`refusal`→red, else neutral).
- Audit UI: turn-detail.tsx renders a "Permission Decisions" section when any rows exist for the turn.

Non-functional:
- Capture path must not throw — failures swallowed identically to existing observer try/catch pattern.
- New table writes guarded by recorder-buffer flush (FK to chat_turns).

## Architecture

```
claude-runner.ts msg loop
   ├─ msg.type === 'assistant'    → emitLlmCall (unchanged)
   ├─ msg.type === 'system' && subtype === 'permission_decision'
   │                              → emitPermissionDecision (NEW)
   └─ msg.type === 'result'       → emitTurnFinalized (NEW, carries stop_reason)

ObserverHooks gains:
   onPermissionDecision?(ev: PermissionDecisionEvent): void   // optional
   onTurnFinalized?(ev: TurnFinalizedEvent): void             // optional

LlmTraceRecorder.onTurnFinalized:
   UPDATE chat_turns SET stop_reason = ? WHERE id = turnId

LlmTraceRecorder.onPermissionDecision:
   INSERT INTO permission_decisions ...
```

Buffered recorder also queues these new events; flushed after appendTurn.

## Related Code Files

Modify:
- `chat-service/src/observability/observer-types.ts` — add `PermissionDecisionEvent`, `TurnFinalizedEvent`; extend `ObserverHooks` with optional methods
- `chat-service/src/observability/sdk-event-extractor.ts` — new `emitPermissionDecision`, `emitTurnFinalized` helpers
- `chat-service/src/core/claude-runner.ts` — dispatch system-permission and result messages to the new helpers
- `chat-service/src/observability/llm-trace-recorder.ts` — implement the two new hooks
- `chat-service/src/observability/composite-observer.ts` — pass through the new hooks (optional method delegation)
- `chat-service/src/db/observability-migrate.ts` — create `permission_decisions` table
- `chat-service/src/db/migrate.ts` — `addColumnIfMissing(db, 'ALTER TABLE chat_turns ADD COLUMN stop_reason TEXT;')`
- `chat-service/src/db/observability-store.ts` — `insertPermissionDecision`, `listPermissionDecisionsByTurn`, `updateTurnStopReason`
- `chat-service/src/api/debug.ts` — extend `GET /debug/turns/:turnId` response with `permissionDecisions: PermissionDecision[]`; include `stopReason` on the turn DTO via `rowToDebugTurn`
- `src/pages/DevAudit/use-debug-api-types.ts` — add `stopReason` to `DebugTurn`; add `PermissionDecision` + extend `DebugTurnDetail`
- `src/pages/DevAudit/turn-llm-calls-section.tsx` — replace plain `c.stop_reason ?? '—'` with `<StopReasonPill value={...} />`
- `src/pages/DevAudit/turn-detail.tsx` — add a "Permission Decisions" section below tool invocations when array non-empty

Create:
- `chat-service/src/observability/__tests__/permission-decisions.test.ts` — extractor + recorder happy path
- `src/pages/DevAudit/stop-reason-pill.tsx` — < 50 LOC, color-mapped pill
- `src/pages/DevAudit/turn-permission-decisions-section.tsx` — < 100 LOC, table renderer

## Implementation Steps

1. **Schema**: ALTER chat_turns ADD COLUMN stop_reason; CREATE TABLE permission_decisions(id TEXT PK, turn_id TEXT FK→chat_turns ON DELETE CASCADE, tool_name TEXT, decision TEXT, reason TEXT, at INTEGER). Index on turn_id.
2. **Types**: extend ObserverHooks with optional `onTurnFinalized` and `onPermissionDecision`. Old observers without these methods continue to compile.
3. **Extractor**: add `emitTurnFinalized(observer, turnId, msg)` reading `msg.stop_reason ?? msg.subtype` from the result message. Add `emitPermissionDecision(observer, turnId, msg)` extracting `tool_name`, `decision`, `reason` from system msg payload. Both no-op when observer lacks the hook.
4. **Runner**: in the for-await loop, add two new dispatches after the existing assistant/user branches. Try/catch each per the existing pattern.
5. **Recorder**: implement the two new hooks in `LlmTraceRecorder`. Buffer them in `BufferedLlmTraceRecorder` and replay them on flush AFTER llm_calls (so FK is satisfied — chat_turns row exists when flush runs).
6. **Read API**: extend `/debug/turns/:turnId` to return `permissionDecisions` array; extend `rowToDebugTurn` to expose `stopReason` from chat_turns.
7. **FE**: render pill in llm-calls table (color mapping: end_turn=green, tool_use=amber, refusal/max_tokens=red, else neutral). Render permission_decisions section when array non-empty.
8. **Verify**: trigger a tool-restricted skill → confirm system permission events appear in raw sdk_events first; then confirm they also appear in the new table after the next turn.

## Todo List

- [x] Migrations (chat_turns.stop_reason + permission_decisions table)
- [x] Extend ObserverHooks + extractor helpers
- [x] Wire dispatches in claude-runner
- [x] Recorder implements new hooks + buffered replay order correct
- [x] Read API surfaces both fields
- [x] FE pill component
- [x] FE permission-decisions section
- [x] Unit test extractor outputs
- [x] Integration test: turn with stop_reason=tool_use shows correct pill

## Success Criteria

- Every assistant turn row exposes `stopReason` in /debug/turns/:turnId
- The `Stop` column in llm-calls table is colored, no more `—` for new turns
- Trigger a permission-denied path → permission_decisions row visible in audit UI
- No regression in existing observability tests

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| SDK actual shape of permission system messages differs from assumption | M | M | Step 8 verify via raw sdk_events first; refine extractor in TDD loop |
| New hooks crash older recorder impls (Langfuse) | L | L | Hooks are optional — old impls simply skip |
| Race: result message arrives, runner finalizes turn, but recorder flushes before chat_turns INSERT | L | M | Existing buffered-flush pattern already handles this — `bufferedRecorder.flush()` is called AFTER `appendTurn` |

## Security Considerations
- permission_decisions may contain tool args fragments — apply the same 4 KB truncation cap as `result_summary`.
- No new auth surface.

## Next Steps
- Phase 03 uses chat_turns.stop_reason for the success-rate computation.
- Phase 06 uses stop_reason='end_turn' as the cache-write gate.

## Unresolved Questions
- Exact SDK message shape for permission decisions (subtype literal, payload fields) — resolved in step 8 via raw sdk_events inspection.
