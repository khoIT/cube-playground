# Phase 05 — turn.ts Composite Observer Wiring

## Context Links
- Integration seam: `chat-service/src/api/turn.ts:266-296` (toolContext build + claudeRunner.run loop)
- Existing fields persisted on assistant turn: `chat-service/src/api/turn.ts:299-314` (`appendTurn` with skill, inputTokens, outputTokens, costUsd)
- Composed prompt source: `chat-service/src/api/turn.ts:238-242` (system prompt text + allowedToolNames)
- Observer contract: phase-02-observer-hook.md
- Recorder + Tracer: phase-03, phase-04

## Overview
- **Priority:** P0 — turns capture nothing until this wiring runs.
- **Status:** complete
- **Brief:** Build a composite `ObserverHooks` from `{ recorder, tracer }`, persist new `system_prompt_text` + `model` columns on the assistant turn, and pass `observer` + `turnId` into `claudeRunner.run()`. Existing user-facing SSE forwarding loop is byte-identical (assert in tests).

## Key Insights
- Composite observer = multicast: each method calls `recorder.onXxx` THEN `tracer.onXxx`, both wrapped in their own try/catch (defense in depth — recorder's own try/catch already exists, but composite must not let one observer's failure kill the other).
- `tracer.flush()` is fire-and-forget — call it in the `finally` block but DO NOT await; the SSE response should not be delayed by Langfuse network. The Langfuse SDK queues internally; a missed flush is bounded loss.
- The system prompt text is composed at turn.ts:238 — that's the only place we have it; persist on the assistant turn row at appendTurn time. Currently `chat-store.ts:appendTurn` does not accept `systemPromptText` or `model` — extend the function signature.
- `model` = `config.chatModel` at the moment of the run.
- Audit row `{kind: 'observability', detail: {recorder: true, langfuse: isLangfuseEnabled()}}` for ops visibility.

## Requirements

### Functional
- Create `CompositeObserver` (or `buildCompositeObserver(observers: ObserverHooks[]): ObserverHooks`).
- In turn.ts, after `toolContext` and `tools` are built (line ~266) but BEFORE the `for await` loop:
  - `const recorder = new LlmTraceRecorder({ db: opts.db, turnId });`
  - `const tracer = new LangfuseTracer({ turnId, sessionId, ownerId: body.owner_id, skill: intent.skill });`
  - `const observer = buildCompositeObserver([recorder, tracer]);`
- Pass `observer` + `turnId` into `claudeRunner.run({ ..., observer, turnId })`.
- In the `finally` block (line ~380): `void tracer.flush();` (fire-and-forget, no await).
- Extend `chat-store.appendTurn` (assistant case only) to accept `systemPromptText`, `model`; pass at the assistant `appendTurn` call (turn.ts:301).
- Insert `chat_audit` entry `{kind: 'observability', detail: {enabled_recorder: true, enabled_langfuse: isLangfuseEnabled(), owner_id: body.owner_id}}` after observer construction.

### Non-functional
- turn.ts net LOC growth ≤ +30 lines (currently 387 → max 420; over the 200 LOC project guideline but file is already pre-existing oversize — adding modular changes is acceptable; do NOT refactor unrelated parts in this phase).
- User-facing SSE wire format unchanged (byte equality test in phase 08).
- Existing `compact_warning`, `session_created`, `query_artifact`, `chart` paths unmodified.

## Architecture

### Composite observer (~40 LOC)
```ts
// chat-service/src/observability/composite-observer.ts
export function buildCompositeObserver(observers: ObserverHooks[]): ObserverHooks {
  const safe = (fn: () => void) => { try { fn(); } catch (err) { /* log */ } };
  return {
    onLlmCall: (ev) => observers.forEach(o => safe(() => o.onLlmCall(ev))),
    onToolInvocation: (ev) => observers.forEach(o => safe(() => o.onToolInvocation(ev))),
    onSdkEvent: (ev) => observers.forEach(o => safe(() => o.onSdkEvent(ev))),
  };
}
```

### turn.ts diff (logical, not literal)
```ts
// after tools = buildSdkTools(toolContext) at line ~266
const recorder = new LlmTraceRecorder({ db: opts.db, turnId });
const tracer = new LangfuseTracer({ turnId, sessionId, ownerId: body.owner_id, skill: intent.skill });
const observer = buildCompositeObserver([recorder, tracer]);
chatStore.insertAudit(opts.db, { sessionId, turnId, kind: 'observability', detail: {
  enabled_recorder: true, enabled_langfuse: isLangfuseEnabled(), owner_id: body.owner_id
}});

// at the claudeRunner.run({...}) call (line ~277)
for await (const event of claudeRunner.run({
  sessionId, systemPrompt, allowedToolNames,
  message: body.message, tools, toolContext,
  turnId,            // ← new
  observer,          // ← new
})) { /* unchanged */ }

// in appendTurn (assistant case) at line ~301
chatStore.appendTurn(opts.db, {
  ...existing,
  systemPromptText: systemPrompt,
  model: config.chatModel,
});

// in finally (line ~380)
void tracer.flush();
```

### chat-store.ts appendTurn extension
- Add optional `systemPromptText?: string; model?: string;` to `AppendTurnParams`.
- Add two columns to the INSERT (these columns added in phase 01).

## Related Code Files

### Create
- `chat-service/src/observability/composite-observer.ts` (~40 LOC)

### Modify
- `chat-service/src/api/turn.ts` — observer construction + run params + finally + audit insert (additive, ~25 LOC inserted).
- `chat-service/src/db/chat-store.ts:143-194` — extend `AppendTurnParams` with two optional fields; extend INSERT statement column list and bind values.

### Delete
- None.

## Implementation Steps
1. Create `composite-observer.ts`.
2. Extend `AppendTurnParams` in `chat-store.ts` with `systemPromptText`, `model`; update prepared INSERT statement column list and `.run(...)` bindings.
3. In `turn.ts`:
   - Import `LlmTraceRecorder`, `LangfuseTracer`, `buildCompositeObserver`, `isLangfuseEnabled`.
   - Construct recorder + tracer + observer after tools build, before for-await.
   - Insert audit row.
   - Pass `turnId` + `observer` into `claudeRunner.run(...)`.
   - Pass `systemPromptText: systemPrompt, model: config.chatModel` into assistant `appendTurn` call.
   - Add `void tracer.flush();` in the existing `finally` block (after `stream.end()` is fine; SSE close happens regardless).
4. Run typecheck — confirm `RunParams` now requires `turnId` and `claudeRunner.run` callers (only turn.ts) are satisfied.
5. Manual run: POST one turn → confirm `llm_calls`, `tool_invocations`, `sdk_events` rows appear in SQLite, and SSE stream looks identical to FE.

## Todo List
- [x] Create `composite-observer.ts`
- [x] Extend `AppendTurnParams` + INSERT statement
- [x] Wire recorder + tracer + observer in turn.ts
- [x] Pass `turnId` and `observer` to `claudeRunner.run`
- [x] Persist `systemPromptText` + `model` on assistant turn
- [x] Insert `observability` audit row
- [x] Fire-and-forget `tracer.flush()` in finally
- [x] Verify SSE byte-equality vs pre-change (manual diff or test)

## Success Criteria
- Post one turn → SQLite has ≥1 row in each of llm_calls / tool_invocations (if a tool was used) / sdk_events. Assistant turn row has non-null `system_prompt_text` + `model`.
- SSE wire output (event types + ordering) identical to pre-change baseline.
- Service still boots without `LANGFUSE_*` env; turns still complete.
- A throwing recorder (simulated by passing a poisoned db) does NOT crash the turn — error is logged, SSE completes.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Recorder/tracer constructor throws synchronously → turn fails | L | H | Construct each inside try/catch; on failure fall back to a no-op observer so turn proceeds. |
| `tracer.flush()` Promise rejection escapes (unhandled rejection crash) | M | H | `void tracer.flush().catch(err => fastify.log.warn({err}, 'langfuse flush failed'))`. |
| `appendTurn` signature change breaks other callers (e.g. compact-service writing system_preamble turns) | M | M | New fields are OPTIONAL. Grep callers: `chat-store.appendTurn` invocations — confirm all sites compile. |
| Extra audit insert costs latency on hot path | L | L | One sync SQLite insert; <1 ms. Negligible. |
| turn.ts file grows past 400 LOC, breaks future maintainability | M | L | Acceptable for this phase. Note in next-steps to consider extracting an "observability bootstrap" helper later. |

## Security Considerations
- system_prompt_text is now persisted to the DB. It contains skill instructions but not user secrets. Same database file already stores user messages and tool results — no new exposure surface.
- The new `chat_audit` `observability` row records `owner_id` (already done by existing intent_routed rows for consistency).
- Owner-scoping is NOT enforced at write time (turn is already authenticated by phase 1 owner check). Enforcement is at READ time in phase 06.

## Next Steps
- Phase 06 exposes the captured data via /debug endpoints (owner-scoped).
- Phase 07 consumes those endpoints in the triage UI.
- Phase 08 covers the byte-equality regression test.
