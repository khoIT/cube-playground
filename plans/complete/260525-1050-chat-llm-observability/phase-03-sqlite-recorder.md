# Phase 03 — SQLite Trace Recorder

## Context Links
- Observer contract: phase-02-observer-hook.md → `ObserverHooks`
- DB tables: phase-01-db-migrations.md (`llm_calls`, `tool_invocations`, `sdk_events`)
- Existing store pattern: `chat-service/src/db/chat-store.ts:161-194` (`appendTurn` via prepared statements)
- WAL + sync pragma: `chat-service/src/db/migrate.ts:47-49`

## Overview
- **Priority:** P0 — primary source of truth for the triage UI.
- **Status:** done
- **Brief:** Implement `LlmTraceRecorder` that satisfies `ObserverHooks` and writes to the three new tables. Per-event writes (not batched) — better-sqlite3 is sync + WAL, the volume is bounded by turn LOC, no need for batching complexity (KISS).

## Key Insights
- better-sqlite3 is synchronous; existing `chat-store.ts` does per-call `db.prepare(...).run(...)`. Same pattern wins.
- Recorder is instantiated **once per turn** by turn.ts, holding `db` ref + `turnId`. Stateless beyond construction args. Each method does one INSERT.
- Idempotency: `INSERT OR IGNORE` on `llm_calls` keyed by `UNIQUE(turn_id, step_index)` and `tool_invocations` keyed by `UNIQUE(turn_id, tool_use_id)`. Replays of a flaky SDK don't double-write.
- `sdk_events` uses AUTOINCREMENT id + `(turn_id, seq)` index — no idempotency UNIQUE; recorder just appends. If the same SDK msg arrives twice (SDK retry), we capture both — that's signal, not noise.

## Requirements

### Functional
- Export class `LlmTraceRecorder` implementing `ObserverHooks`.
- Constructor: `new LlmTraceRecorder({ db, turnId })`.
- `onLlmCall(ev)` → INSERT OR IGNORE INTO llm_calls with computed `id = uuid()`.
- `onToolInvocation(ev)` → INSERT OR IGNORE INTO tool_invocations.
- `onSdkEvent(ev)` → INSERT INTO sdk_events (no IGNORE; append-only).
- All payload columns (`content_json`, `args_json`, `result_summary`, `payload_json`) stored as `JSON.stringify(payload)`. Truncation guard: `result_summary` ≤ 4 KB, `payload_json` ≤ 64 KB; longer values are truncated and tagged with a `[truncated]` suffix.

### Non-functional
- Per-event INSERT < 2 ms p95 on local SQLite (WAL).
- File LOC < 150.
- No async APIs (better-sqlite3 sync).
- Recorder must NOT throw upward — wrap every INSERT in try/catch, log warn via injected logger (or `console.warn` if no logger).

## Architecture

### Module layout
```
chat-service/src/observability/
├── observer-types.ts           (phase 02)
├── llm-trace-recorder.ts       (this phase, ~140 LOC)
└── observability-store.ts      (~80 LOC; thin CRUD layer mirroring chat-store)
```

Why split `observability-store.ts`?
- Mirrors existing `chat-store.ts` pattern (data ops live in `db/*` semantically). `observability-store.ts` exports `insertLlmCall(db, row)`, `insertToolInvocation(db, row)`, `insertSdkEvent(db, row)` + read helpers needed by phase 06.
- Keeps recorder file < 150 LOC.
- Phase 06 imports the same `*-store` read helpers (`listLlmCallsByTurn`, `listToolInvocationsByTurn`, `listSdkEventsByTurnPaginated`) — DRY.

### Data flow
```
runner.onLlmCall({...}) ─► LlmTraceRecorder.onLlmCall ─► observability-store.insertLlmCall(db, row)
                                                       └─► try/catch + warn on conflict
```

## Related Code Files

### Create
- `chat-service/src/observability/llm-trace-recorder.ts` (~140 LOC) — implements `ObserverHooks`.
- `chat-service/src/db/observability-store.ts` (~120 LOC) — INSERT + SELECT helpers + truncation util.

### Modify
- None in this phase (turn.ts wiring happens in phase 05).

### Delete
- None.

## Implementation Steps
1. Create `observability-store.ts` exporting:
   - `insertLlmCall(db, row)` with prepared statement using `INSERT OR IGNORE`.
   - `insertToolInvocation(db, row)` with `INSERT OR IGNORE`.
   - `insertSdkEvent(db, row)` with plain `INSERT`.
   - `listLlmCallsByTurn(db, turnId)`, `listToolInvocationsByTurn(db, turnId)`, `listSdkEventsByTurn(db, turnId, { cursor, limit })`.
   - Internal `truncate(value, max)` helper (used for `result_summary` and `payload_json`).
2. Create `llm-trace-recorder.ts`:
   - Constructor stores `db`, `turnId`.
   - `onLlmCall(ev)`: build row (uuid id, stringify content), call `insertLlmCall`. Try/catch + console.warn.
   - `onToolInvocation(ev)`: same shape, calls `insertToolInvocation`.
   - `onSdkEvent(ev)`: calls `insertSdkEvent` with stringified payload.
3. Add a thin re-export from `chat-service/src/observability/index.ts` if it helps imports — skip if not needed (YAGNI).
4. Manual smoke: instantiate recorder against an in-memory DB, fire 3 events, read back via store helpers.

## Todo List
- [x] Create `observability-store.ts` with 3 insert + 3 select helpers
- [x] Implement `truncate(value, max)` util
- [x] Create `llm-trace-recorder.ts` class
- [x] Wrap each INSERT in try/catch + warn
- [x] Confirm `result_summary` truncation works
- [x] Confirm `sdk_events.seq` matches insertion order via index
- [x] Verify LOC of both files < 200

## Success Criteria
- Unit test: `LlmTraceRecorder` against `:memory:` DB — 1 onLlmCall + 1 onToolInvocation + 3 onSdkEvent produces 1 / 1 / 3 rows respectively.
- Idempotency test: calling `onLlmCall` twice with same `(turnId, stepIndex)` produces ONE row.
- Truncation test: a 100 KB `result_summary` stored as ≤ 4 KB + ends with `[truncated]`.
- All recorder methods complete without throwing even when DB is closed (failure caught + logged).

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Large `content_json` (Anthropic responses can be 100 KB+) bloats DB | M | M | Cap `content_json` at 64 KB with truncation marker. Document in storage helper. |
| `INSERT OR IGNORE` silently drops rows when uniqueness conflict is unexpected | L | M | Test verifies the only legitimate conflict is the idempotency case; any other conflict path is a phase-02 bug, not recorder's. |
| WAL mode + many small writes = WAL bloat | L | L | Existing service already in WAL with chat_turn inserts at similar volume. Not net-new. |
| Sync DB writes on hot turn path add latency | L | L | Already established pattern in chat-store; observed perf is fine. |

## Security Considerations
- Stored content_json carries assistant outputs that may include sensitive tool outputs (SQL, query results). Same data already in chat_turns artifacts; no new exposure surface.
- Truncation prevents pathological row sizes that would slow read queries in phase 06.

## Next Steps
- Phase 04 (Langfuse) implements parallel observer — same contract, different sink.
- Phase 05 wires `LlmTraceRecorder` into turn.ts as one leg of a composite observer.
- Phase 06 reads via `observability-store.ts` select helpers.
