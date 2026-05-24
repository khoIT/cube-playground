---
phase: 1
title: "Spike: verify open Qs"
status: completed
priority: P1
effort: "0.5d"
dependencies: []
---

# Phase 1: Spike — verify open Qs

## Overview

Lock the few details brainstorm flagged as unresolved so Phase 2+3 design is safe. No code merged — just reading + a short notes file.

## Requirements

- Functional:
  - Confirm `useChatSession` fetch lib so we know how to "invalidate".
  - Confirm AbortController plumbing through `openChatTurn` so store can plug into `cancel()`.
  - Confirm where `activeTurnId` will be exposed on session fetch (Phase 2 needs it).
  - Confirm whether `turnId` today is unguessable (it's not — currently `sessionId:index`).
- Non-functional:
  - Output a 1-page notes md inside this plan dir; subsequent phases reference it.

## Architecture

Pure read-only investigation. No build, no test impact.

## Related Code Files

- Read: `src/pages/Chat/hooks/use-chat-session.ts`
- Read: `src/api/chat-sse-client.ts` (lines 205-286)
- Read: `chat-service/src/api/turn.ts` (turnId construction at ~line 227)
- Read: `chat-service/src/db/chat-store.ts` (session fetch shape)
- Create: `plans/260524-2216-chat-stream-resume/spike-notes.md`

## Implementation Steps

1. Confirm `useChatSession` is hand-rolled `useReducer` (NOT React Query/SWR). Verify `refetch()` is exported.
2. Confirm `openChatTurn()` returns `{ stream, cancel }` and `cancel()` calls `controller.abort()`.
3. Read `chat-service/src/api/turn.ts:227` — turnId today is `sessionId + ':' + userTurnIndex+1` (deterministic). Note this is **guessable** and must move to UUID v4 in Phase 5.
4. Read `chat-service/src/db/chat-store.ts` session-fetch SQL/JS to identify where to add `activeTurnId` join/column (Phase 6 work).
5. Write `spike-notes.md` with: fetch-lib choice, abort path, turnId hardening note, activeTurnId source-of-truth proposal.

## Success Criteria

- [x] Spike notes file exists, ≤80 lines, answers all 4 questions with file:line refs.
- [x] No code changes committed.

## Risk Assessment

- Risk: spike reveals a hidden coupling (e.g. `useChatSession` shared across views via context). Mitigation: if found, document and update Phase 2 design before proceeding.
