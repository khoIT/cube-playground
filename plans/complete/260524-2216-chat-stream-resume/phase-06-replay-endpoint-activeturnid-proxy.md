---
phase: 6
title: "Replay endpoint + activeTurnId + proxy"
status: completed
priority: P2
effort: "1d"
dependencies: [5]
---

# Phase 6: Replay endpoint + activeTurnId + proxy

## Overview

Expose `GET /agent/turn/:turnId/stream?from=<offset>` on chat-service. Replay buffered events then tail live. Surface `activeTurnId` in `GET /api/chat/sessions/:id` so the client knows whether to attach-replay vs start-fresh. Add a thin server-proxy passthrough.

## Requirements

- Functional:
  - `GET /agent/turn/:turnId/stream?from=<offset>` returns `text/event-stream`:
    - Auth: same ownership check as `/agent/sessions/:id`.
    - If `from < entry.startOffset` (ring overflow): respond `409` JSON `{ error, availableFromOffset }` BEFORE switching to SSE — client knows to restart with the returned offset.
    - Stream all buffered events from `from` onward, in order.
    - If `entry.status === 'running'`, subscribe and tail live events until done/error/client-disconnect.
    - If `entry.status` is terminal at request time, finish immediately after replay.
  - `GET /api/chat/sessions/:id` (server route → chat-service) includes `activeTurnId: string | null` in payload. Null when no `running` turn for that session.
  - server/src/routes/chat.ts proxies the new replay route.
- Non-functional:
  - Same auth/perms as session-fetch.
  - Connection-drop on client side immediately calls `unsubscribe` on registry to prevent listener leak.

## Architecture

```
client GET /api/chat/sessions/:id/stream-replay?turnId=T&from=K
  → server proxy (server/src/routes/chat.ts)
    → GET {CHAT_SERVICE_URL}/agent/turn/T/stream?from=K
      → check ownership (session row → ownerId == request user)
      → check entry exists; if from < startOffset → 409 + {availableFromOffset}
      → SSE: write buffered events from K
      → if running: subscribe(turnId, e => write(e)); on disconnect → unsubscribe
      → if terminal: end stream
```

<!-- Updated: Validation Session 1 - findRunning resolves compact alias (Q1) -->
activeTurnId on session fetch:

```
GET /agent/sessions/:id response body now includes:
  { id, gameId, ownerId, createdAt, turns, activeTurnId: string | null }

activeTurnId derived: streamRegistry.findRunning(sessionId) → entry.turnId | null
  └─ findRunning() consults the session-alias map first (Phase 5), so a request
     against the PRE-compact sessionId still locates the live turn under the
     POST-compact sessionId. This handles the "refresh during auto-compact"
     edge case (turn.ts:95-113).
```

## Related Code Files

- Modify: `chat-service/src/api/turn.ts` (or split out) — new handler `getTurnStream(req)` for `GET /agent/turn/:turnId/stream`.
- Modify: `chat-service/src/api/sessions.ts` (the session-fetch handler — verify exact path via grep) — inject `activeTurnId`.
- Modify: `chat-service/src/core/stream-registry.ts` — add `findRunning(sessionId): RegistryEntry | undefined`.
- Modify: `chat-service/src/core/sse-stream.ts` — reuse existing event→wire serializer.
- Modify: `server/src/routes/chat.ts` — add proxy for `GET /api/chat/sessions/:sessionId/stream-replay`.
- Modify: `src/pages/Chat/hooks/use-chat-session.ts` — expose `activeTurnId` in returned state.

## Implementation Steps

1. Implement `findRunning(sessionId)` on registry (O(n) scan over running entries is fine at N=100).
2. Implement chat-service handler `GET /agent/turn/:turnId/stream`:
   - Auth: look up session via turnId → ownerId vs request.
   - 404 if turnId not in registry.
   - 409 + `{ availableFromOffset }` if `from < startOffset`.
   - Set SSE headers; write buffered events from `from` (loop over `entry.events`).
   - If running: subscribe; on each event, serialize via existing `sse-stream.ts` mapper and write. Flush.
   - On client disconnect (`req.socket.on('close')`): unsubscribe + early return.
   - On `finish`: close stream.
3. Modify session-fetch handler to include `activeTurnId: streamRegistry.findRunning(sessionId)?.turnId ?? null`.
4. Add server proxy in `server/src/routes/chat.ts`: same proxy pattern as the existing `POST /api/chat/sessions/:id/turn` (forward headers, pipe stream).
5. Surface `activeTurnId` through `useChatSession` returned state.
6. Manual smoke: trigger a long turn, open replay endpoint directly with curl from `from=0`, verify events arrive.
7. Auth negative test: try replay endpoint with wrong ownerId → 403.

## Success Criteria

- [x] Replay endpoint streams buffered + live tail correctly.
- [x] 409 with `availableFromOffset` on overflow.
- [x] 403 on wrong owner.
- [x] `activeTurnId` present in session-fetch response when running; null otherwise.
- [x] After auto-compact, session-fetch against the **pre-compact** sessionId still returns the live `activeTurnId` (alias resolution).
- [x] Server proxy forwards SSE without buffering.
- [x] Listener leak test: 100 connect-then-disconnect cycles → registry listener count returns to 0.

## Risk Assessment

- Risk: SSE proxy buffers chunks (some Node HTTP proxy middleware does). Mitigation: copy the existing proxy pattern from `server/src/routes/chat.ts:113-209` which already pipes upstream SSE successfully.
- Risk: client requests `from=K` where K > totalEmitted (future offset). Mitigation: clamp to current; immediately tail.

## Security Considerations

- Replay endpoint must verify session ownership via the same code path as `GET /api/chat/sessions/:id`. Add a small `requireSessionOwner(req, sessionId)` helper if not present.
- UUID v4 turnId already unguessable (Phase 5).
- Do not log payload content on subscribe/disconnect — only counts.
