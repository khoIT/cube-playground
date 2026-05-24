# Brainstorm — Resume Cube Chat Stream Across Views

- Date: 2026-05-24
- Branch: main
- Status: Design approved, ready for `/ck:plan`

## Problem Statement

When user starts a Cube chat conversation and switches modules mid-generation, the right-side chat panel (which stays open across modules) appears empty until the stream finishes. Same happens if user returns to the main `/chat/:id` view: nothing visible until `done`. Streaming content is only rendered by whichever React subtree owns the SSE connection at that moment.

### Why it happens (verified from scout)

- SSE event loop + streaming state live inside `useChatStream` hook (`src/pages/Chat/hooks/use-chat-stream.ts`, `use-chat-stream-reducer.ts`) — local to whichever component mounts it.
- Side panel (`src/shell/chat-overlay/use-panel-chat-state.ts`) and the `/chat/:id` page each create their own chat state; no shared store.
- Server only persists the assistant turn on `done` event (`chat-service/src/api/turn.ts:269-285`). Partial turns are never in the DB.
- No active-stream registry in chat-service. `GET /api/chat/sessions/:id` returns only completed turns.

Net: state is fragmented per view, and there is no server fallback to recover mid-flight events.

## Requirements

### Functional
- F1. Switching modules with the right panel open: live stream continues to render in the panel.
- F2. Clicking back into `/chat/:id` mid-stream: same live state appears in the main view.
- F3. On `done`, DB-authoritative session refetched and reconciled into the views.
- F4. (Phase 2) After full page refresh in same tab, an in-flight turn re-attaches and continues rendering.

### Non-functional
- N1. No new SSE connections per view — one stream per active turn.
- N2. Use Zustand (already in codebase: `src/stores/qb-ui-store.ts`, `playground-store.ts`).
- N3. Phase 2 chat-service in-memory buffer must have TTL bound (no unbounded growth).
- N4. No multi-tab / multi-device resume (explicit non-goal).

## Approaches Considered

### Phase 1 — state sharing

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **Zustand store keyed by sessionId** | Matches existing pattern; selectors avoid over-rendering; refcount/start-once is natural | New store file, modest refactor of `useChatStream` | **Picked** |
| React Context at app root | No new dep | Wide re-render fanout unless contexts split per session | Rejected |
| Singleton service + `useSyncExternalStore` | Most React-decoupled | Introduces unfamiliar pattern; not used elsewhere | Rejected |

### Phase 2 — refresh resume

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **In-memory ring buffer + replay endpoint** | Cheap; survives refresh; bounded memory | Dies on chat-service restart; single-instance only | **Picked** for Phase 2 |
| Incremental DB writes per chunk | Survives anything | Schema churn, write amplification, hot row contention | Rejected (overkill) |
| Skip entirely | Zero work | Refresh still breaks | Rejected |

## Final Design

### Phase 1 — Client-side hoist (module-switch resume)

**New file:** `src/stores/chat-stream-store.ts` (Zustand)

State shape:
```ts
type StreamEntry = {
  sessionId: string;
  status: 'idle' | 'streaming' | 'done' | 'error';
  currentText: string;
  currentReasoning: string;
  currentArtifacts: QueryArtifact[];
  currentCharts: ChartArtifact[];
  currentToolCalls: ToolCallEvent[];
  refCount: number;       // for subscribe/unsubscribe bookkeeping
  cancel?: () => void;    // SSE AbortController hook
  error?: string;
};

type ChatStreamStore = {
  streams: Map<string, StreamEntry>;
  startTurn(sessionId, prompt, opts): Promise<void>;
  subscribe(sessionId): void;       // increments refCount
  unsubscribe(sessionId): void;     // decrements; NEVER cancels mid-stream
  reset(sessionId): void;
};
```

**Refactor:** `useChatStream(sessionId)` becomes a thin selector + lifecycle hook:
- On mount: `subscribe(sessionId)`.
- On unmount: `unsubscribe(sessionId)` — does **not** cancel the in-flight fetch. Stream runs to completion regardless of which views are mounted.
- Returns the selected slice for that sessionId.

**Stream ownership:** First subscriber that calls `startTurn` creates the SSE iteration. Subsequent subscribers attach to the same in-memory state.

**Completion sync:** When the SSE loop sees `done`, the store:
1. Marks `status = 'done'`.
2. Calls `useChatSession.invalidate(sessionId)` (or React Query equivalent) so a fresh `GET /api/chat/sessions/:id` reconciles DB-authoritative turns.
3. Clears the `current*` accumulators.

**Both consumers (`chat-panel.tsx` + main `/chat/:id` page) call `useChatStream(sessionId)` and render off the same slice.**

### Phase 2 — Server-side replay (refresh resume)

**chat-service additions:**

1. **Turn ID assigned at start.** `POST /agent/turn` returns `turnId` in the first SSE event (`session_created` or a new `turn_started`).
2. **Ring buffer.** `Map<turnId, { events: SseEvent[], status, createdAt }>` in `chat-service/src/core/stream-registry.ts`. Append every emitted event; cap at N events per turn; TTL ~5 min after `done`/`error`; sweep on interval.
3. **Replay endpoint.** `GET /agent/turn/:turnId/stream?from=<offset>`:
   - Stream buffered events from `offset` first.
   - If turn still running, tail live events (subscribe to registry's emitter).
   - If turn already done, finish stream after replay.
4. **Client attach.** On chat view mount, if `useChatSession` returns a session with an `activeTurnId`, call the replay endpoint instead of starting a new turn. Same store, same reducer, just a different fetch source.

**Constraints:**
- Single chat-service instance assumption holds today; if scaled out later, swap registry for Redis pub/sub.
- No persistence across chat-service restarts (acceptable — restarts are rare; user retries).

## Related Code Files

To modify (Phase 1):
- `src/pages/Chat/hooks/use-chat-stream.ts` — gut local reducer, become a store selector.
- `src/pages/Chat/hooks/use-chat-stream-reducer.ts` — move reducer logic into store actions.
- `src/shell/chat-overlay/use-panel-chat-state.ts` — replace local stream state with store selector.
- `src/pages/Chat/hooks/use-chat-session.ts` — expose invalidate; trigger from store on `done`.
- `src/api/chat-sse-client.ts` — unchanged unless we add abort plumbing for store.

To create (Phase 1):
- `src/stores/chat-stream-store.ts` — new Zustand store.

To modify (Phase 2):
- `chat-service/src/api/turn.ts` — emit `turnId`; write events to registry as they emit.
- `chat-service/src/core/sse-stream.ts` — wire replay path.
- `src/api/chat-sse-client.ts` — add `openChatTurnReplay(turnId, fromOffset)`.
- `server/src/routes/chat.ts` — proxy the new replay route.

To create (Phase 2):
- `chat-service/src/core/stream-registry.ts` — ring buffer + TTL sweeper.

## Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| Race: turn completes between `subscribe()` and store reads | M | Read store snapshot synchronously in selector; reducer applies events in order |
| Multiple turns started for same session (double submit) | M | Mutex already in `turn.ts:350`; client guards `startTurn` if `status === 'streaming'` |
| Memory leak from never-cancelled streams | L | All streams end naturally on `done`/`error`; add idle-timeout safeguard |
| Refetch on `done` clobbers a fresh user submission | L | Tag refetch by turnId; ignore if a newer turn already started |
| Ring buffer OOM (Phase 2) | M | Per-turn event cap + global registry size cap + TTL sweep |
| chat-service restart loses Phase 2 buffer | M | Documented limitation; client falls back to "wait until next session fetch" |

## Security Considerations

- Replay endpoint must enforce same auth as `GET /api/chat/sessions/:id`. Reject if requesting user does not own the session.
- TurnId must be unguessable (uuid v4) to prevent cross-session probing.

## Success Criteria

- S1. User submits prompt, switches module within 200ms, returns within 3s: side panel shows accumulated text since first token, then continues live.
- S2. User submits prompt, switches to `/chat/:id` main view mid-stream: main view shows accumulated text + continues live.
- S3. On `done`, the final assistant message in both views matches `GET /api/chat/sessions/:id` payload exactly.
- S4. (Phase 2) User refreshes page mid-stream: within 1s of mount, chat view re-attaches and shows accumulated buffer + live tail.
- S5. No duplicate SSE connections per turn (verified via DevTools network panel).

## Next Steps

1. Run `/ck:plan` with this report as context to produce `plan.md` + phase files.
2. Phase 1 — implement store, refactor hooks, wire both views. Ship.
3. Phase 2 — design `stream-registry` API, implement replay endpoint, client attach logic.

## Unresolved Questions

- Q1. Does `useChatSession` use React Query, SWR, or a hand-rolled fetch? Determines invalidate API in the `done` handler. (Scout did not surface this — verify in implementation.)
- Q2. Is there an existing AbortController plumbed through `openChatTurn`? If not, Phase 1 needs to add one so the store can cancel on explicit user action (e.g. "Stop generating" button), independent of unmount.
- Q3. Phase 2 — when client attaches via replay, what is the source of `activeTurnId`? Add `activeTurnId` to `GET /api/chat/sessions/:id` response, or new lightweight endpoint?
