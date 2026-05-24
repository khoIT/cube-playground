---
phase: 3
title: "Bind both views + invalidate on done"
status: completed
priority: P1
effort: "0.5d"
dependencies: [2]
---

# Phase 3: Bind both views + invalidate on done

## Overview

Wire the side panel and the `/chat/:id` main view to the new store. On `done`, trigger `useChatSession.refetch()` so DB-authoritative turns reconcile into the views.

## Requirements

- Functional:
  - Both panel and main view render the same live stream when they share a `sessionId`.
  - Switching modules mid-stream: panel keeps rendering tokens.
  - Switching back to `/chat/:id`: main view picks up at the same accumulated state, continues live.
  - On `done`: session fetched fresh; live accumulators clear; UI shows DB-persisted assistant turn.
- Non-functional:
  - No duplicate SSE connection (S5).

## Architecture

```
chatStreamStore (singleton, all sessions)
    ▲                                          ▲
    │ select(sessionId=X)                      │ select(sessionId=X)
    │                                          │
ChatPanel (use-panel-chat-state)         Chat page (use-chat-stream consumer)
    │                                          │
    └─ on 'done' → invalidateSession(X) ──────┘
                          │
                          ▼
                  useChatSession.refetch()
                          │
                          ▼
              GET /api/chat/sessions/:id → store/UI shows DB turns
```

Invalidation strategy: store exposes a tiny event bus (or just call `refetch()` directly from the active hook on `done`). Cleanest: store dispatches a one-shot `onDone(sessionId)` callback set by `useChatSession` on mount.

## Related Code Files

- Modify: `src/shell/chat-overlay/use-panel-chat-state.ts` — replace local stream state with `useChatStream(sessionId)`.
- Modify: `src/shell/chat-overlay/chat-panel.tsx` — pass through unchanged; verify it reads from the hook only.
- Modify: `src/pages/Chat/hooks/use-chat-session.ts` — register `onSessionDone(sessionId, refetch)` with store on mount; cleanup on unmount.
<!-- Updated: Validation Session 1 - main view path verified as chat-thread-page.tsx (Q2) -->
- Modify: `src/pages/Chat/chat-thread-page.tsx` (the `/chat/:id` route component; also imports the shared `ChatComposer` from `./components/chat-composer`) to use `useChatStream(sessionId)`.

## Implementation Steps

1. Add `onDone` callback registry to store: `onDoneListeners: Map<sessionId, () => void>`, `setOnDone(sessionId, cb)`, `clearOnDone(sessionId)`. Fire on `status === 'done'` transition.
2. Modify `useChatSession`: in mount effect, call `store.setOnDone(sessionId, refetch)`; cleanup unregisters.
3. Update `use-panel-chat-state.ts` to consume `useChatStream(sessionId)` and stop holding its own stream state. Keep panel-specific UI state (e.g. composer draft) local.
4. Update main `/chat/:id` view to consume the same hook. Confirm submit path goes through `store.startTurn`.
5. Manual smoke: open `/chat/:id`, submit, switch module → panel renders; switch back → main view renders. (Automated tests in Phase 4.)
6. DevTools network: verify only ONE SSE fetch per turn.

## Success Criteria

- [x] S1 (manual): submit + switch module → panel shows live tokens.
- [x] S2 (manual): switch back to `/chat/:id` → main view continues live.
- [x] S3 (manual): after `done`, both views match `GET /api/chat/sessions/:id` payload (spot-check DB row).
- [x] S5 (manual): only one `POST /api/chat/sessions/:id/turn` in network tab per submit.
- [x] No regressions in existing chat smoke flow (chart rendering, artifact deeplink).

## Risk Assessment

- Risk: ChatComposer in panel and in main view both wire `submit` — double-submit on submit-from-panel-then-nav. Mitigation: `startTurn` status guard from Phase 2 + composer disables while `status === 'streaming'`.
- Risk: `refetch` clobbers fresh user turn started immediately after `done`. Mitigation: refetch only fires once per turn; if a new `startTurn` happened between `done` and refetch landing, drop the stale fetch (compare turn count or use AbortController inside `useChatSession`).
