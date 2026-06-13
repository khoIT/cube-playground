# Chat Service Integration Mapping — Phases 03/04/05/08 FE

**Date:** 2026-05-26  
**Scope:** Phase 03 (Memory Settings Panel + Header Chip), Phase 04 FE (Cancel Button), Phase 05 (Observability), Phase 08 FE (History Tab)

---

## Phase 03 — Memory Settings Panel + Header Chip

### 1. Session-focus store (phase 02 foundation)
**File:** `/Users/lap16299/Documents/code/cube-playground/chat-service/src/cache/session-focus-adapter.ts`

**Key signatures:**
- `getFocus(db, sessionId): SessionFocus` — lines 59–73 (returns empty on cache miss or flag-off)
- `mergeFocus(db, sessionId, ownerId, partial: Partial<SessionFocus>)` — lines 83–107 (read-modify-write pattern; spread-merge filters)
- `clearFocus(db, sessionId): void` — lines 113–116 (drop entire row from kv_cache)
- `renderFocusPreamble(focus: SessionFocus): string` — lines 126–170 (token-bounded preamble for system prompt)

**Data shape:**
```typescript
interface SessionFocus {
  skill?, concept?, artifactRef?, metric?, dimension?, timeRange?, segment?, filters?, intent?, entity?, updatedAt?
  // All fields wrap in SlotMemory<T>: { value: T; phrase?: string }
}
```
**Note:** Phase 02 snapshot (left by prior assistant turn); read at start of `compose()` by turn.ts:298–300. TTL: 24h, backed by `kv_cache` table (`kind='session_focus'`).

---

### 2. Disambig-memory store (slot-level session memory)
**File:** `/Users/lap16299/Documents/code/cube-playground/chat-service/src/cache/disambig-memory-adapter.ts`

**Key signatures:**
- `getResolutions(db, sessionId): DisambigResolutions` — lines 76–89 (tolerates legacy bare strings)
- `mergeResolution(db, sessionId, ownerId, partial: DisambigResolutions)` — lines 96–120 (filters accumulate per session)
- `clearResolutions(db, sessionId): void` — *not explicitly named in file, call kvEvict(db, 'disambig_resolution', sessionKey(sessionId))*

**Data shape:**
```typescript
interface DisambigResolutions {
  metric?, dimension?, timeRange?, filters?, intent?, concept?, entity?, updatedAt?
  // All wrap in SlotMemory<T>
}
```
**Note:** Phase 02a slot-level continuity; 24h TTL, backed by `kv_cache` table (`kind='disambig_resolution'`). Both adapters read by turn.ts:46.

---

### 3. Chat-store SDK conversation ID (phase 01)
**File:** `/Users/lap16299/Documents/code/cube-playground/chat-service/src/db/chat-store.ts`

**Key signatures:**
- `setSdkConversationId(db, sessionId, sdkConversationId): void` — lines 166–174 (UPDATE chat_sessions)
- `clearSdkConversationId(db, sessionId): void` — lines 182–189 (UPDATE chat_sessions SET sdk_conversation_id = NULL)

**Note:** Phase 01 resume handle. Cleared by compact-service or stale-ID retry. Called from turn.ts when sdk_session_captured event arrives.

---

### 4. SSE event emission (turn.ts + sse-stream.ts)
**File:** `/Users/lap16299/Documents/code/cube-playground/chat-service/src/api/turn.ts`

**Focus mutation sites:**
- Line 298–300: read session focus via `getFocus(db, sessionId)` for system prompt inject
- Line 45 import: `{ getFocus, mergeFocus, type SessionFocus }`
- *After turn completes (not visible in 150-line window):* mergeFocus called to snapshot focus from final assist turn

**File:** `/Users/lap16299/Documents/code/cube-playground/chat-service/src/core/sse-stream.ts`

**Event types (lines 1–100):**
- `{ type: 'token', data: { delta: string } }` — line 97
- `{ type: 'thinking', data: { delta: string } }` — line 99
- `{ type: 'tool_call', data: { ... } }` — line 100 (wrapped)
- `{ type: 'result', data: { ... } }` — SDK result message

**Emit helper:** `writeSseEvent(stream, event)` — imported by turn.ts line 28, called at turn.ts:201.

**Note:** New `focus_updated` event type (phase 03) TBD. Event list in mapSdkMessage() lines 90–102 shows the current taxonomy.

---

### 5. Disambiguation chip (FE reference)
**File:** `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/components/disambig-chips.tsx`

**Structure:** Lines 1–72. Props: `prompt`, `slot` ('metric'|'dimension'|'timeRange'), `options: DisambigOption[]`, `onPick(pinText)`.  
**Usage:** Rendered below assistant turn when `disambiguate_query` tool returns clarification. Audit POST on chip click (postChatAudit with kind='disambig_chip_picked').

---

### 6. Settings page + Chat remembered defaults
**File:** `/Users/lap16299/Documents/code/cube-playground/src/pages/Settings/settings-page.tsx`

**Chat tab structure:** To be found. Likely tabs: General, Disambiguation, Memory.

**File:** `/Users/lap16299/Documents/code/cube-playground/src/pages/Settings/chat-remembered-defaults-list.tsx` + `use-chat-remembered-defaults.ts`

**Existing pattern:** `ChatRememberedDefaultsList` component pulls from user-level prefs (cross-session learning). **Phase 03 reuses this pattern for new ChatMemorySection (session-level focus + disambig slots).**

---

### 7. Chat composer — slash command wiring
**File:** `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/components/chat-composer.tsx`

**Slash command:** `/forget` to clear session focus + disambig resolutions.  
**Hook:** TBD. Likely `useSlashCommands()` or inline switch on text prefix.

---

## Phase 04 FE — Cancel Button

### 1. Streaming state in FE store
**File:** `/Users/lap16299/Documents/code/cube-playground/src/stores/chat-stream-store-actions.ts`

**StreamEntry shape (lines 42–68):**
```typescript
export interface StreamEntry {
  sessionId: string | null;
  turnId: string | null;  // ← Active turn ID once server emits turn_started
  status: StreamStatus;   // 'idle' | 'loading' | 'streaming' | 'done' | 'error'
  currentText, currentReasoning, currentArtifacts, currentCharts, currentToolCalls,
  cancel?: () => void,    // ← Cancel handle for live SSE fetch
  ...
}
```

**Key:** `turnId` populated when `turn_started` SSE event arrives (phase 04 server already emits at turn.ts:259).

---

### 2. useChatStream hook (FE)
**File:** `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/hooks/use-chat-stream.ts`

**Return shape (lines 116–136):**
- `status: StreamStatus` — current state ('streaming' when in flight)
- `currentText, currentToolCalls, ...` — live message buffers
- `sendTurn(message, bypassCache?): Promise<void>` — line 70–90
- `cancel(): void` — line 92–94 (calls `useChatStreamStore.getState().cancel(liveSessionIdRef.current)`)

**Note:** No explicit `currentTurnId` in hook return. Extract from store entry: `turnId` field.

---

### 3. Cancel endpoint (already implemented)
**File:** `/Users/lap16299/Documents/code/cube-playground/chat-service/src/api/turn.ts`

**Route:** `POST /agent/turn/:turnId/cancel` — lines 764–789

**Contract:**
- **202 Accepted:** `{ aborted: true }` when turn was running
- **410 Gone:** `{ aborted: false, code: 'not_running' }` when turn completed or turnId unknown
- **401/403:** owner check via X-Owner-Id header

**Owner check (line 778):** Reads session row, compares owner_id to header.

---

### 4. Chat UI mounting point
**File:** `/Users/lap16299/Documents/code/cube-playground/src/pages/Chat/chat-thread-page.tsx`

**Structure:** Lines 93–363. Renders ChatThreadView + ChatComposer side-by-side.  
**Status check:** Line 194 checks `isStreaming = status === 'loading' || status === 'streaming'`.

**Cancel button location:** Likely mounted next to ChatComposer or at top of streaming message (TBD UI).

---

## Phase 05 — Observability Unification

### 1. SDK event extractor (side-channel signals)
**File:** `/Users/lap16299/Documents/code/cube-playground/chat-service/src/observability/sdk-event-extractor.ts`

**Key signatures:**
- `emitSdkEvent(observer, turnId, seq, msg)` — lines 26–34 (raw firehose, one call per SDK message)
- `emitLlmCall(observer, turnId, stepIndex, model, startedAt, msg, pendingTools): number` — lines 45–80
  - Returns new `lastBoundary` timestamp
  - Registers tool_use blocks in pendingTools map
  - Emits 0 tokens (per-call usage unavailable; aggregate on result message)
- `emitToolInvocations(observer, turnId, msg, pendingTools)` — referenced at claude-runner.ts:250 (not visible in excerpt)
- `emitTurnFinalized(observer, turnId, msg)` — referenced at claude-runner.ts:258

**Note:** All wrapped in try/catch at call site in claude-runner (lines 227–260).

---

### 2. Composite observer (multicaster)
**File:** `/Users/lap16299/Documents/code/cube-playground/chat-service/src/observability/composite-observer.ts`

**Methods (lines 42–75):**
- `onLlmCall(ev: LlmCallEvent)` — per-LLM-call metadata
- `onToolInvocation(inv: ToolInvocationEvent)` — per-tool result pairing
- `onSdkEvent(ev: SdkEventRecord)` — raw SDK message firehose
- `onTurnFinalized(ev: TurnFinalizedEvent)` — optional, turn-level stop_reason + permission denials
- `onPermissionDecision(ev: PermissionDecisionEvent)` — optional, per-permission audit

**Pattern:** Wraps exception handling (safeCall helper) so one observer failure doesn't block others.

---

### 3. Langfuse tracer (observer sink)
**File:** `/Users/lap16299/Documents/code/cube-playground/chat-service/src/observability/langfuse-tracer.ts`

**Usage:** Implements ObserverHooks interface. Configured via env: LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY, LANGFUSE_HOST (defaults to cloud.langfuse.com).

**Note:** Span open/close, trace context management — TBD in phase 05 implementation.

---

### 4. Observability-store (persistence layer)
**File:** `/Users/lap16299/Documents/code/cube-playground/chat-service/src/db/observability-store.ts`

**Tables + insert functions:**
- `insertLlmCall(db, row: LlmCallRow)` — lines 39–62 (UNIQUE(turn_id, step_index))
  - Columns: id, turn_id, step_index, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd, latency_ms, started_at, ended_at, content_json, stop_reason
- `insertToolInvocation(db, row: ToolInvocationRow)` — lines 67–88 (UNIQUE(turn_id, tool_use_id))
  - Columns: id, turn_id, tool_use_id, name, args_json, result_summary, ok, latency_ms, started_at, ended_at
- `insertSdkEvent(db, row: Omit<SdkEventRow, 'id'>)` — lines 94–100 (append-only, AUTOINCREMENT id)
  - Columns: turn_id, seq, type, payload_json, at

---

### 5. Dispatch sites in claude-runner
**File:** `/Users/lap16299/Documents/code/cube-playground/chat-service/src/core/claude-runner.ts`

**Emission points:**
1. **Line 228:** `emitSdkEvent(observer, turnId, seq++, msg)` — every SDK message (after abort check)
2. **Line 242:** `emitLlmCall(observer, ..., msg, pendingTools)` — on `msg.type === 'assistant'`
3. **Line 250:** `emitToolInvocations(observer, ..., msg, pendingTools)` — on `msg.type === 'user'` (tool results)
4. **Line 258:** `emitTurnFinalized(observer, ..., msg)` — on `msg.type === 'result'`
5. **Line 265:** `flushPendingTools(observer, ..., pendingTools)` — after loop (tool_use without result)

**Async iterator:** `for await (const msg of iter)` at line 198 drives all emission.

---

## Phase 08 FE — Business-Metric History Tab

### 1. Metric detail page tabs
**File:** `/Users/lap16299/Documents/code/cube-playground/src/pages/Catalog/metric-detail/metric-detail-tabs.tsx`

**Current tabs (lines 44–52):**
- 'overview', 'formula', 'lineage', 'slices', 'activity'

**Pattern:** Pure UI component (DetailTabKey type, LABELS map, ORDER array). onClick calls onChange(key) to lift selection to parent.

**Note:** Phase 08 adds 'history' tab (6th tab).

---

### 2. Business-metric history API
**File:** `/Users/lap16299/Documents/code/cube-playground/server/src/routes/business-metrics.ts`

**Route:** `GET /api/business-metrics/:id/history` — lines 262–279

**Contract:**
- Query params: `limit` (default 50), `since` (epoch ms)
- Response: `{ entries: AuditEntry[] }` (newest-first)
- 404: metric not found

**Backend:** Calls `listAudit(db, id, { limit, since })` — TBD in business-metrics store.

---

### 3. Chat-service metric history tool (agent-facing)
**File:** `/Users/lap16299/Documents/code/cube-playground/chat-service/src/tools/get-business-metric-history.ts`

**Tool name:** `get_business_metric_history`

**Input schema (lines 19–23):**
```typescript
{ id: string, limit?: number, since?: number }
```

**Result type (lines 25–44):**
```typescript
type OkResult = { ok: true; entries: AuditEntry[] }
type NotFoundResult = { ok: false; error: 'NOT_FOUND'; message: string }
type ServerErrorResult = { ok: false; error: 'server_error'; detail: { ... } }
```

**AuditEntry shape (lines 25–36):**
```typescript
{
  id: number, ts: number, metricId: string,
  action: 'create'|'update'|'trust_change'|'delete',
  oldValueJson, newValueJson, actorKind, actorId, reason, requestId
}
```

---

## Summary Integration Points

| Phase | File | Function | Signature | Used By |
|-------|------|----------|-----------|---------|
| **03** | session-focus-adapter.ts | getFocus | (db, sessionId) ⇒ SessionFocus | turn.ts:298 |
| **03** | session-focus-adapter.ts | mergeFocus | (db, sessionId, ownerId, partial) ⇒ void | turn.ts (post-turn, implicit) |
| **03** | session-focus-adapter.ts | clearFocus | (db, sessionId) ⇒ void | Settings /forget endpoint |
| **03** | disambig-memory-adapter.ts | getResolutions | (db, sessionId) ⇒ DisambigResolutions | turn.ts:46 |
| **03** | disambig-memory-adapter.ts | mergeResolution | (db, sessionId, ownerId, partial) ⇒ void | disambiguate-query tool |
| **03** | chat-store.ts | setSdkConversationId | (db, sessionId, id) ⇒ void | turn.ts (on sdk_session_captured) |
| **03** | chat-store.ts | clearSdkConversationId | (db, sessionId) ⇒ void | compact-service, stale-retry |
| **03** | sse-stream.ts | writeSseEvent | (stream, event) ⇒ void | turn.ts:201 (forward loop) |
| **04** | chat-stream-store.ts | getEntry | (sessionId) ⇒ StreamEntry | FE subscribe loop |
| **04** | chat-stream-store-actions.ts | StreamEntry.turnId | null \| string | FE: cancel button checks status + checks if turnId exists |
| **04** | turn.ts | POST /agent/turn/:turnId/cancel | (req, reply) ⇒ 202\|410 | FE cancel button calls fetch |
| **05** | sdk-event-extractor.ts | emitSdkEvent | (observer, turnId, seq, msg) ⇒ void | claude-runner.ts:228 |
| **05** | sdk-event-extractor.ts | emitLlmCall | (observer, turnId, stepIndex, model, startedAt, msg, pendingTools) ⇒ number | claude-runner.ts:242 |
| **05** | composite-observer.ts | buildCompositeObserver | (observers[]) ⇒ ObserverHooks | turn.ts (build observer before claudeRunner.run) |
| **05** | observability-store.ts | insertLlmCall | (db, row) ⇒ void | LlmTraceRecorder sink |
| **05** | observability-store.ts | insertToolInvocation | (db, row) ⇒ void | LlmTraceRecorder sink |
| **08** | business-metrics.ts | GET /api/business-metrics/:id/history | (req, reply) ⇒ { entries } | FE history tab + agent tool |
| **08** | get-business-metric-history.ts | handler | (args, ctx) ⇒ OkResult\|NotFoundResult\|ServerErrorResult | Claude agent when user asks |

---

## Unresolved Questions

1. **Phase 03:** Where exactly does mergeFocus get called after turn completes? Is it in turn.ts post-observer loop or in a separate "finalize" function?
2. **Phase 03:** What is the exact signature of the new `/focus` endpoints (GET, DELETE)? Phase 02 spec does not exist; infer from disambig-clear pattern.
3. **Phase 04:** Where is the "Stop generating" button mounted in the UI? Does it go in ChatComposer footer or at top of streaming message?
4. **Phase 05:** What is the full signature of `emitToolInvocations` and `emitTurnFinalized`? They are called from claude-runner but not visible in the 200-line excerpt.
5. **Phase 05:** Is LangfuseTracer a new class or does it already exist? Span lifecycle (open/close) TBD.
6. **Phase 08:** What is the signature of `listAudit(db, metricId, {limit, since})`? Table schema TBD.
7. **Phase 08:** Should the FE history tab request latest entries on mount or paginate lazily? Load strategy TBD.

