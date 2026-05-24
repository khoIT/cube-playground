---
phase: 2
title: "Client store + useChatStream refactor"
status: completed
priority: P1
effort: "1d"
dependencies: [1]
---

# Phase 2: Client store + useChatStream refactor

## Overview

Move streaming state out of React local state into a Zustand store keyed by `sessionId`. Convert `useChatStream` into a selector + lifecycle hook with refcount that never cancels mid-stream on unmount.

## Requirements

- Functional:
  - One Zustand store with `Map<sessionId, StreamEntry>`.
  - `startTurn(sessionId, prompt)` kicks off SSE if not already streaming for that session.
  - `subscribe(sessionId)` / `unsubscribe(sessionId)` increment/decrement refcount only — never abort the fetch.
  - SSE event handlers dispatch directly to store; existing reducer logic moves into store actions.
- Non-functional:
  - Selectors must be granular enough to avoid panel re-rendering when main view's irrelevant state mutates.
  - Zero new SSE connections per turn (one fetch, multiple subscribers).

## Architecture

```
ChatComposer.submit() ──▶ chatStreamStore.startTurn(sessionId, prompt)
                            │
                            ├─ openChatTurn(...) → AsyncIterable<SseEvent>
                            ├─ Store sets streams[sessionId] = { status:'streaming', refCount: existing, cancel, ... }
                            └─ async loop dispatches events → store reducer

ChatPanel (right panel) ──▶ useChatStream(sessionId)
                              └─ subscribe + select streams[sessionId]
/chat/:id main view ──────▶ useChatStream(sessionId)
                              └─ subscribe + select streams[sessionId]   (same slice)
```

StreamEntry shape:

```ts
type StreamEntry = {
  sessionId: string;
  status: 'idle' | 'streaming' | 'done' | 'error';
  currentText: string;
  currentReasoning: string;
  currentArtifacts: QueryArtifact[];
  currentCharts: ChartArtifact[];
  currentToolCalls: ToolCallEvent[];
  refCount: number;
  cancel?: () => void;
  error?: string;
};
```

## Related Code Files

- Create: `src/stores/chat-stream-store.ts` (Zustand store, ≤200 lines; if larger, split actions into `chat-stream-store-actions.ts`).
- Modify: `src/pages/Chat/hooks/use-chat-stream.ts` — becomes thin selector + subscribe/unsubscribe lifecycle hook.
- Modify: `src/pages/Chat/hooks/use-chat-stream-reducer.ts` — reducer logic migrates into store; file either deleted or downgraded to pure event→state helper exported and unit-tested.
- Read for context: `src/stores/qb-ui-store.ts`, `src/stores/playground-store.ts` (existing Zustand idioms — note these use the **per-instance factory + Context** pattern via `createStore` + `useStore`; the chat-stream store deliberately uses a **singleton** via `create<>()` because streaming state is global to the app, not per-tab).
- Read for context: `src/api/chat-sse-client.ts:205-286`.

## Implementation Steps

1. Create `chat-stream-store.ts` with `create<ChatStreamStore>()(...)`. Map state shape, getter selectors, and immer-style updates (or shallow with `set`).
2. Migrate reducer event cases (`token`, `thinking`, `tool_call`, `tool_result`, `query_artifact`, `chart`, `done`, `error`) into store actions. Keep the event→state mapping pure and re-export for unit tests.
<!-- Updated: Validation Session 1 - startTurn guard locked to silent no-op (Q4) -->
3. Implement `startTurn(sessionId, prompt, opts)`:
   - Guard: if `streams[sessionId]?.status === 'streaming'`, silent no-op. Composer disable handles UX; store guard is defense-in-depth.
   - Initialize entry → `status: 'streaming'`, empty accumulators, set `cancel` from `openChatTurn(...).cancel`.
   - Spawn async loop awaiting `stream`. Dispatch each event. On `done`/`error`, transition status.
4. Implement `subscribe(sessionId)` / `unsubscribe(sessionId)`: refcount only. Never call `cancel`.
5. Refactor `useChatStream(sessionId)`:
   - On mount: `useEffect(() => { subscribe(sessionId); return () => unsubscribe(sessionId); }, [sessionId])`.
   - Return shallow-selected slice via `useChatStreamStore(s => s.streams.get(sessionId) ?? IDLE)`.
   - Expose imperative `startTurn` and `cancel` for the composer's "Stop generating" button.
6. Unit-test the pure event→state helper (cover all 8 event types + status transitions).
7. Type-check & build. No UI consumers wired yet — that's Phase 3.

## Success Criteria

- [x] `chat-stream-store.ts` ≤200 lines, passes TS strict.
- [x] Event→state helper unit tests cover all event types & status transitions, all green.
- [x] `useChatStream` builds, returns identical selector shape to today (consumer-API compatible).
- [x] `npm run build` (or equivalent) passes.

## Risk Assessment

- Risk: identity-sensitive selectors (returning new object refs per call) cause runaway re-renders. Mitigation: use `useShallow` from `zustand/shallow` or split into multiple atomic selectors.
- Risk: `startTurn` race when composer double-submits. Mitigation: status guard + treat as no-op; surface to UI via existing busy state.
- Risk: file exceeds 200 LOC. Mitigation: split into store + actions module (long descriptive kebab-case names).
