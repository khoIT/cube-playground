---
phase: 7
title: "Client attach-replay + Phase 2 tests (S4)"
status: completed
priority: P2
effort: "1d"
dependencies: [6]
---

# Phase 7: Client attach-replay + Phase 2 tests (S4)

## Overview

On chat view mount (after refresh), if session fetch returns `activeTurnId`, open the replay endpoint instead of starting a new turn. Stream merges into the same Zustand store so panel + main view continue rendering. Cover with tests for S4.

## Requirements

- Functional:
  - `useChatStream(sessionId)` on mount inspects session.activeTurnId. If present, calls `store.attachReplay(sessionId, turnId, fromOffset=0)`.
  - `attachReplay` opens `GET /api/chat/sessions/:sessionId/stream-replay?turnId=T&from=K`, parses SSE, dispatches events into the same store entry.
  - On 409 with `availableFromOffset`: warn user (toast: "missed some output, resuming from latest"), restart attach with the returned offset.
  - On 403/404: clear `activeTurnId` and show standard idle state.
- Non-functional:
  - One attach per turnId — refcount + status guard from Phase 2 still applies.
  - Replay path uses the same SSE parser as `openChatTurn` (DRY).

## Architecture

```
useChatStream(sessionId) mount
  ├─ subscribe(sessionId)
  └─ if !streams[sessionId] && session.activeTurnId:
        store.attachReplay(sessionId, session.activeTurnId, fromOffset=0)
            │
            ├─ openChatTurnReplay(turnId, from)  → AsyncIterable<SseEvent>
            ├─ store.streams[sessionId] = { status:'streaming', turnId, ... }
            └─ dispatch loop (same as Phase 2 startTurn loop)
```

New helper:

```ts
// src/api/chat-sse-client.ts
export function openChatTurnReplay(sessionId, turnId, fromOffset) {
  // GET /api/chat/sessions/:sessionId/stream-replay?turnId=...&from=...
  // returns { stream, cancel }   (same shape as openChatTurn)
}
```

## Related Code Files

- Modify: `src/api/chat-sse-client.ts` — add `openChatTurnReplay`; share SSE parser internals with `openChatTurn`.
- Modify: `src/stores/chat-stream-store.ts` — add `attachReplay(sessionId, turnId, fromOffset)`; merge with existing dispatch loop via helper.
- Modify: `src/pages/Chat/hooks/use-chat-stream.ts` — on mount, if session.activeTurnId and no live entry, call `attachReplay`.
- Modify: `src/pages/Chat/hooks/use-chat-session.ts` — already exposing `activeTurnId` from Phase 6.
- Create: `tests/chat-stream-refresh-resume.spec.ts` (Playwright) OR JSDOM fallback covering S4.

<!-- Updated: Validation Session 1 - shared parser locked (Q5); 409 toast UX locked (Q7) -->
## Implementation Steps

1. Refactor SSE parsing inside `chat-sse-client.ts` so `openChatTurn` and `openChatTurnReplay` share the line-parser + AsyncIterable wrapping. New private `parseSseFromResponse(response, abortSignal)` helper. Add a focused unit test for the helper (parser correctness, multi-block buffer, malformed JSON skip) so the refactor is regression-guarded independent of integration tests.
2. Implement `openChatTurnReplay(sessionId, turnId, fromOffset)`:
   - GET with `text/event-stream` accept, abort controller, signal.
   - Return `{ stream, cancel }`.
3. Implement `attachReplay` store action — same dispatch loop as `startTurn`, but skips the user-message-append step (assistant turn is already happening server-side).
4. Implement 409 handling: parse JSON body before SSE; if status 409, read `availableFromOffset`, fire a toast ("Some output was skipped, resuming from the latest available frame"). Then attach once from the returned offset. Guard against infinite loop: if the retried attach also returns 409, give up, clear `activeTurnId` locally, and surface idle state. Reuse the project's existing toast util (search `src/QueryBuilderV2/components/` for the canonical helper used by Copy/Filter components).
5. Modify `useChatStream` mount effect to call `attachReplay` when needed.
6. Manual smoke: start a long turn, hard-refresh browser, observe replay attach within 1s.
7. Tests:
   - Unit: `attachReplay` happy path, 409 retry, 403 → clear state.
   - Browser/JSDOM: mock session-fetch with `activeTurnId`, mock replay endpoint with controllable AsyncIterable, mount component, push N events, then `done` → assert UI matches; assert refetch fires.
8. Manual perf check: 2000-event replay completes <500ms on local.

## Success Criteria

- [x] S4 (manual): hard-refresh mid-stream → chat view re-attaches within 1s, shows buffer + live tail.
- [x] All Phase 2 unit + integration tests green.
- [x] No regressions in Phase 1 tests.
- [x] Bundle size delta < +5KB (new code is small).

## Risk Assessment

- Risk: race between session fetch and `startTurn` from user submit. Mitigation: `startTurn` guard (already in Phase 2) — if a stream entry exists, no-op or queue.
- Risk: stale `activeTurnId` after `done` arrives between session fetch and replay attach (turn finished by then). Mitigation: replay endpoint streams whatever's buffered + finishes; client treats this as a no-op replay, refetch runs on `done`.
- Risk: shared SSE parser refactor introduces regression. Mitigation: Phase 4 tests still cover happy path; add focused parser unit tests.

## Security Considerations

- Auth re-verified at replay endpoint (Phase 6).
- Client treats 403/404 as "no active turn" — never displays partial state from a turn it can't auth against.
