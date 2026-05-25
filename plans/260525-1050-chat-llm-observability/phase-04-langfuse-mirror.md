# Phase 04 — Langfuse Mirror (Env-Gated)

## Context Links
- Observer contract: phase-02-observer-hook.md
- Config module: `chat-service/src/config.ts:34-109`
- Sibling observer impl: phase-03-sqlite-recorder.md (mirror pattern)
- Langfuse Node SDK docs: https://langfuse.com/docs/sdk/typescript

## Overview
- **Priority:** P1 — secondary sink. Service must boot and turns must run without it.
- **Status:** complete
- **Brief:** Implement `LangfuseTracer` that satisfies `ObserverHooks` and mirrors per-turn telemetry to Langfuse Cloud. **No-op** when `LANGFUSE_PUBLIC_KEY` or `LANGFUSE_SECRET_KEY` is missing. All SDK errors swallowed.

## Key Insights
- One Langfuse **trace** per chat turn (id = our turnId; sessionId = our sessionId; userId = ownerId; name = `chat-turn:${skill}`).
- One Langfuse **generation** per llm_call (parent = trace). Map our fields: `input` ← prompt+history slice, `output` ← assistant content, `model`, `usage`, `metadata.stepIndex`.
- One Langfuse **span** per tool_invocation (parent = trace). `input` ← args, `output` ← result_summary, `metadata.ok`, `metadata.toolUseId`.
- `sdk_events` are NOT mirrored to Langfuse — too noisy, Langfuse isn't built for firehose. SQLite owns the raw firehose; Langfuse owns the summarised generation/span view. (Constraint: keeps Langfuse usage cheap.)
- Trace started on first observer event for a turn (lazy init); flushed on `flush()` method called from turn.ts finally block.
- Langfuse SDK is async/promise-based and queues internally — calls to `generation()` / `span()` return immediately. Only `flush()` awaits the network round-trip.

## Requirements

### Functional
- Module exports `LangfuseTracer` class implementing `ObserverHooks` + an extra `flush()` method.
- Constructor: `new LangfuseTracer({ turnId, sessionId, ownerId, skill })` — does NOT initialise the SDK client yet.
- On first `onLlmCall` or `onToolInvocation`: lazily create the trace.
- `onLlmCall(ev)` → langfuse.generation({ traceId, name: `llm-call:${stepIndex}`, model, input, output, usage: { input, output, total }, startTime, endTime, metadata }).
- `onToolInvocation(ev)` → langfuse.span({ traceId, name: `tool:${name}`, input, output, startTime, endTime, metadata }).
- `onSdkEvent(ev)` → **no-op** (intentional).
- `flush()` → await `langfuse.shutdownAsync()` or equivalent; bounded with a 2 s timeout — never blocks the response past that.
- All SDK calls wrapped in try/catch — never throw.
- When env keys absent, constructor sets internal `disabled = true` flag; every method returns early.

### Non-functional
- Module file < 180 LOC. If `langfuse` SDK init grows verbose, split client factory to `langfuse-client.ts`.
- Zero allocations on disabled path (early return on first line of each method).
- New dependency: `langfuse` (latest stable). Added via `chat-service/package.json` dependencies.

## Architecture

### Config additions to `chat-service/src/config.ts`
```ts
langfusePublicKey: optional('LANGFUSE_PUBLIC_KEY', ''),
langfuseSecretKey: optional('LANGFUSE_SECRET_KEY', ''),
langfuseBaseUrl: optional('LANGFUSE_HOST', 'https://cloud.langfuse.com'),
```
Helper exported from config: `function isLangfuseEnabled(): boolean { return !!(config.langfusePublicKey && config.langfuseSecretKey); }`.

### Module layout
```
chat-service/src/observability/
├── langfuse-tracer.ts          (this phase, ~160 LOC)
└── langfuse-client.ts          (~50 LOC; createLangfuseClient() factory, returns null when disabled)
```

### Data flow (enabled path)
```
runner.onLlmCall ─► LangfuseTracer.onLlmCall ─► ensureTrace() ─► client.generation({...})
                                              └─► try/catch silent on any error
turn.ts (finally) ─► tracer.flush() ─► client.shutdownAsync()  (≤2s)
```

### Data flow (disabled path)
```
runner.onLlmCall ─► LangfuseTracer.onLlmCall ─► return  (disabled flag set in ctor)
```

## Related Code Files

### Create
- `chat-service/src/observability/langfuse-tracer.ts` (~160 LOC)
- `chat-service/src/observability/langfuse-client.ts` (~50 LOC)

### Modify
- `chat-service/src/config.ts` — add three optional config fields + `isLangfuseEnabled()` helper. File currently 109 LOC → ~120 LOC, OK.
- `chat-service/package.json` — add `"langfuse": "^3.x"` to dependencies.

### Delete
- None.

## Implementation Steps
1. Add `langfuse` to `chat-service/package.json` and `npm install` from inside `chat-service/`.
2. Extend `config.ts` with the three optional fields and `isLangfuseEnabled()`.
3. Create `langfuse-client.ts`:
   - `export function createLangfuseClient()` — returns `Langfuse | null`. Reads config; if disabled returns null. Wraps SDK construction in try/catch (e.g. invalid host).
4. Create `langfuse-tracer.ts`:
   - Constructor: stores turnId/sessionId/ownerId/skill, calls `createLangfuseClient()`. If null → `this.disabled = true`.
   - Private `ensureTrace()`: creates `this.trace = client.trace({ id: turnId, sessionId, userId: ownerId, name: \`chat-turn:${skill}\` })`. Idempotent (guard on `this.trace`).
   - `onLlmCall(ev)`: if disabled, return. Else ensureTrace, client.generation({...}).
   - `onToolInvocation(ev)`: if disabled, return. Else ensureTrace, client.span({...}).
   - `onSdkEvent(ev)`: no-op (intentional — comment why).
   - `async flush()`: if disabled, return. Else `Promise.race([client.shutdownAsync(), timeout(2000)])` in try/catch.
5. Manual smoke: boot service WITHOUT env keys → service starts, turn runs, recorder writes SQLite, tracer methods all no-op (verified by stub spy in tests).

## Todo List
- [x] Add `langfuse` to package.json + install
- [x] Extend `config.ts` with langfuse fields + helper
- [x] Create `langfuse-client.ts` factory
- [x] Create `langfuse-tracer.ts` class
- [x] Implement lazy `ensureTrace`
- [x] try/catch every SDK call
- [x] 2s-bounded flush()
- [x] Boot service without env → confirm clean boot + working chat turn (no-op verified via probe)
- [ ] Boot with env → confirm trace appears in Langfuse dashboard (requires real credentials — deferred to integration)

## Success Criteria
- Boot test: with `LANGFUSE_PUBLIC_KEY=""` (unset), service boots and POST /agent/turn returns a normal SSE stream end-to-end.
- Unit test: with stubbed Langfuse client, `onLlmCall` triggers `client.generation()` exactly once per call.
- Unit test: with stubbed client throwing on every call, `onLlmCall` / `onToolInvocation` / `flush` swallow errors and never propagate.
- Manual: with real env keys against Langfuse Cloud sandbox, one turn produces one trace with N generations + M spans nested correctly.
- File LOC: `langfuse-tracer.ts` ≤ 180.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Langfuse SDK throws synchronously in constructor (bad host URL) | L | H | Factory wraps SDK construction in try/catch, returns null on failure → tracer goes to disabled path. |
| flush() hangs forever (network failure) | M | M | 2s timeout via `Promise.race`. turn.ts must still call `flush()` in a finally without await blocking the SSE close — handled in phase 05 (fire-and-forget the flush). |
| SDK pushes payloads to Langfuse with PII the user did not consent to mirror | M | M | Env-gated (off by default). Document the data sent in plan's security section. No automatic enablement. |
| Langfuse SDK adds breaking changes between minor versions | M | L | Pin `^3.x` and let dependabot handle. SDK calls are isolated to one file (one place to fix). |
| Lazy trace not initialised because turn errors before first observer signal (boot error) | L | L | `flush()` checks for missing trace and short-circuits. |

## Security Considerations
- **PII exposure:** assistant inputs/outputs and tool args/results are mirrored to Langfuse Cloud when enabled. **Default = disabled (no env vars).** Document in README/dev docs (phase 06's docs sync).
- **Secrets:** never log `LANGFUSE_SECRET_KEY`. Config getter is consumed only by client factory.
- **Audit trail:** turn.ts inserts an `chat_audit` entry `{kind: 'langfuse_mirror', detail: {enabled: bool}}` on every turn — gives ops visibility into whether mirroring ran. (Lightweight; reuses existing audit table.)

## Next Steps
- Phase 05 wires both observers into a composite passed to claudeRunner.
- Phase 06 surfaces a "view in Langfuse" deep link in the debug UI when enabled (small enhancement; mark optional).
