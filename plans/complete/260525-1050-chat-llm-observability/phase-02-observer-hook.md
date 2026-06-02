# Phase 02 — Observer Contract + claude-runner Hook

## Context Links
- Existing runner: `chat-service/src/core/claude-runner.ts:65-143` (RunParams + run generator)
- SDK→SseEvent mapper: `chat-service/src/core/sse-stream.ts:80-141` (extract per-msg `usage` here too)
- Turn integration seam: `chat-service/src/api/turn.ts:277-296` (for await loop)
- SDK assistant message shape: `chat-service/src/core/sse-stream.ts:42-67` (current minimal types)

## Overview
- **Priority:** P0 — defines the contract every later phase depends on.
- **Status:** done
- **Brief:** Define `ObserverHooks` interface and thread an optional `observer?` through `RunParams`. Inside the `for await` loop, emit per-LLM-call / per-tool-invocation / per-SDK-event signals via the observer **without** changing the yielded `SseEvent` stream.

## Key Insights
- The SDK loop at `claude-runner.ts:136-142` yields events; each `msg.type === 'assistant'` from the SDK = one LLM round-trip. Per-call usage lives on the assistant message's `message.usage` (Anthropic API standard) — must be extracted in observer path, NOT in `mapSdkMessage` (which would mutate user-facing `SseEvent`).
- Tool-use → tool-result pairing needs a `Map<tool_use_id, { startedAt, name, args }>` kept inside the run() invocation closure. On `tool_use` block start time; on matching `tool_result` block compute `latency_ms`.
- Observer events MUST flow via a **side channel** — never via the `yield` stream. turn.ts forwards yielded events to FE. Violating this changes the SSE wire format. (Constraint echo: byte-identical user-facing SSE.)
- Observer is per-turn; instantiate fresh in turn.ts and pass in. No process-scoped state in the runner — keeps test isolation clean.

## Requirements

### Functional
- Define `ObserverHooks`:
  ```ts
  interface ObserverHooks {
    onLlmCall(call: LlmCallEvent): void;        // sync; observer-impl may queue
    onToolInvocation(inv: ToolInvocationEvent): void;
    onSdkEvent(ev: SdkEventRecord): void;
  }
  ```
- Add optional `observer?: ObserverHooks` to `RunParams`.
- Inside `run()`:
  - Maintain `stepIndex` counter (incremented per `assistant` SDK msg).
  - Maintain `seq` counter for `sdk_events`.
  - On every SDK msg → `observer?.onSdkEvent({ seq, type, payload, at: Date.now() })`.
  - On `assistant` msg → extract usage + content blocks + stop_reason, call `observer?.onLlmCall({...})`.
  - On `assistant` `tool_use` block → record start in pending-tools map.
  - On `user` `tool_result` block → pop pending-tools, compute latency, call `observer?.onToolInvocation({...})`.
- Observer calls wrapped in `try/catch` — never break the runner loop.

### Non-functional
- Zero impact when `observer === undefined` (skip ifs at the conditional, no allocations).
- < 1 ms overhead per SDK msg when observer present (sync writes only here; recorder does its own batching).
- File LOC budget: `claude-runner.ts` < 200 (currently 143; +observer logic likely ~40 LOC → 183, OK). If overflow → split observer-extract helpers to `chat-service/src/observability/sdk-event-extractor.ts`.

## Architecture

### Side channel vs yield channel
```
SDK msg ─► mapSdkMessage() ─► yield SseEvent ────► turn.ts ─► writeSseEvent → FE  (UNCHANGED)
        └► extractObserverSignal() ─► observer.onXxx() ─► [recorder | tracer]   (NEW)
```

### Observer event shapes (TS interfaces in `observer-types.ts`)
```ts
interface LlmCallEvent {
  turnId: string; stepIndex: number; model: string;
  inputTokens: number; outputTokens: number;
  cacheCreationTokens?: number; cacheReadTokens?: number;
  costUsd?: number; latencyMs: number;
  startedAt: number; endedAt: number;
  content: unknown;            // raw assistant.message.content
  stopReason?: string;
}
interface ToolInvocationEvent {
  turnId: string; toolUseId: string; name: string;
  args: unknown; resultSummary: string; ok: boolean;
  latencyMs: number; startedAt: number; endedAt: number;
}
interface SdkEventRecord {
  turnId: string; seq: number; type: string; payload: unknown; at: number;
}
```

### Per-call latency
- LLM call latency = time between previous yield boundary (or run start) and current `assistant` msg arrival. Track `lastBoundary = Date.now()` after every observer.onLlmCall(); on next assistant msg compute `now - lastBoundary`.
- Tool invocation latency = time between `tool_use` block timestamp and matching `tool_result` block timestamp.

## Related Code Files

### Create
- `chat-service/src/observability/observer-types.ts` (~50 LOC) — interface + event shapes
- `chat-service/src/observability/sdk-event-extractor.ts` (~80 LOC, IF claude-runner approaches 200 LOC) — pure helpers to pull usage + map content blocks; otherwise inline.

### Modify
- `chat-service/src/core/claude-runner.ts:65-73` — add `observer?: ObserverHooks` to `RunParams`; thread `turnId` (currently turn.ts knows it but the runner doesn't — add `turnId: string` to `RunParams` too).
- `chat-service/src/core/claude-runner.ts:136-142` — wrap the `for await` body with observer calls (try/catch each).
- `chat-service/src/types.ts` — re-export observer types (optional, for callers).

### Delete
- None.

## Implementation Steps
1. Create `observer-types.ts` with the three event interfaces and `ObserverHooks`.
2. Add `turnId: string` and `observer?: ObserverHooks` fields to `RunParams`.
3. Inside `run()`, before the `for await` loop, initialize: `let stepIndex = 0`, `let seq = 0`, `let lastBoundary = Date.now()`, `const pendingTools = new Map<string, { startedAt, name, args }>()`.
4. Inside the loop, BEFORE `mapSdkMessage(msg)`:
   - Wrap `observer?.onSdkEvent({ turnId, seq: seq++, type: msg.type, payload: msg, at: Date.now() })` in try/catch.
5. After mapping but still inside the loop, branch on `msg.type`:
   - `'assistant'`: extract usage (`msg.message.usage`), content, stop_reason. Call `observer?.onLlmCall({ turnId, stepIndex: stepIndex++, latencyMs: Date.now() - lastBoundary, ...})`. Update `lastBoundary`. For each `tool_use` block in content → `pendingTools.set(block.id, { startedAt: Date.now(), name: block.name, args: block.input })`.
   - `'user'`: for each `tool_result` block in content → pop `pendingTools.get(block.tool_use_id)`, compute `latencyMs`, call `observer?.onToolInvocation({...})`.
6. Pass `turnId` from turn.ts (phase 05). DO NOT yield anything new.
7. Run typecheck — confirm `RunParams` callers still satisfy the (extended) interface (turnId becomes required; update turn.ts call site in phase 05).

## Todo List
- [x] Create `observer-types.ts`
- [x] Extend `RunParams` with `turnId` and optional `observer`
- [x] Add step counter, seq counter, lastBoundary, pendingTools to `run()`
- [x] Wire `onSdkEvent` (every msg)
- [x] Wire `onLlmCall` (every assistant msg)
- [x] Wire `onToolInvocation` (every tool_result with matching tool_use)
- [x] try/catch each observer call
- [x] Confirm no new yielded SseEvent types (mapSdkMessage output unchanged)
- [x] File exceeded 200 LOC: split helpers to `sdk-event-extractor.ts` (runner now 195 LOC)

## Success Criteria
- `claude-runner.ts` test: with mocked SDK iterable producing { assistant(text+tool_use), user(tool_result), result }, observer receives: 1 onLlmCall, 1 onToolInvocation with non-zero latency_ms, ≥3 onSdkEvent.
- yielded `SseEvent` sequence identical to a run without observer (byte equality on serialized array).
- `claude-runner.ts` LOC < 200.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Observer throws → loop dies → turn fails for user | M | H | try/catch every observer call; on catch log + continue. Test: throwing observer doesn't break run(). |
| Tool_use without matching tool_result (model abandons) | M | L | At end of run(), flush pendingTools as `ok=false, resultSummary='no_result'`. |
| SDK adds `partial_assistant` messages we don't recognise → step counter drifts | L | M | Only increment `stepIndex` on the final `assistant` msg shape (has `message.content` array). Skip partials. |
| `msg.message.usage` shape varies by SDK version | M | M | Extractor tolerates undefined fields; falls back to `result` event's totals at turn end (already captured at turn.ts:288-290). Recorder records what it has. |
| Observer becomes shared singleton (leaks turns across requests) | L | H | Instantiated per-call in turn.ts (phase 05). Add assertion in recorder constructor: `turnId` required at construction. |

## Security Considerations
- Observer payloads include raw user messages and tool args — PII risk. Same data already exists in `chat_turns`/SSE replay; no new exposure. Owner-scoping enforced at debug-API read time (phase 06).
- No env vars introduced in this phase.

## Next Steps
- Phase 03 implements the SQLite-recorder side of the contract.
- Phase 04 implements the Langfuse-tracer side.
- Phase 05 composes them and passes `observer` from turn.ts.
