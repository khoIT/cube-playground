# Spike Notes — Phase 1

Quick read-only verification of open Qs before Phase 2 design.

## Q1. `useChatSession` fetch lib + invalidation

- Hand-rolled `useReducer` — NOT React Query / SWR.
  Ref: `src/pages/Chat/hooks/use-chat-session.ts:77` (`useReducer`).
- `refetch()` is exported and re-fires the same `fetch_` callback.
  Ref: `src/pages/Chat/hooks/use-chat-session.ts:125-129`.
- Invalidation strategy for Phase 3: store calls the `refetch` registered by the
  active `useChatSession` consumer. No external cache to bust.

## Q2. AbortController plumbing through `openChatTurn`

- `openChatTurn(options)` returns `{ stream, cancel }`. `cancel()` calls
  `controller.abort()` against an `AbortController` owned per fetch.
  Ref: `src/api/chat-sse-client.ts:205-286` (controller @ 207, returned cancel @ 284).
- The async iterator catches `AbortError` and returns cleanly — safe for a
  long-lived store to hold the cancel handle.

## Q3. `activeTurnId` source-of-truth (Phase 6)

- Session-fetch handler lives at `chat-service/src/api/sessions.ts:92-111`
  (`GET /sessions/:id`). Response body is `{ session, turns }`.
- Inject `activeTurnId` by computing
  `streamRegistry.findRunning(req.params.id)?.turnId ?? null` and adding it to
  the payload. No DB column needed — derived per request.
- Client mirror: `src/pages/Chat/hooks/use-chat-session.ts:99-107` reshapes the
  payload — add `activeTurnId` there too.

## Q4. `turnId` guessability today

- Today: `turn.ts:227` → `const turnId = sessionId + ':' + (userTurnIndex + 1)`.
  Composite, deterministic, guessable given a sessionId.
- `rg "turnId.split"` across `chat-service/src/` → no matches. No downstream
  parser depends on the composite shape.
- Confirmed consumers: `chat-store.appendTurn` (chat-store.ts:296 — opaque str)
  and `chat-store.insertAudit` (chat-store.ts:292 — opaque str). Safe to swap to
  `randomUUID()` v4 in Phase 5.

## Other observations relevant to Phase 2

- Reducer logic is already extracted into `use-chat-stream-reducer.ts` — Phase 2
  can lift it verbatim into the Zustand store with minimal churn.
- `useChatStream` currently fires `notifyChatSessionChanged(sid)` on
  `session_created` and `done`. Store must preserve both notifications so the
  left-nav rail keeps updating.
- Side-panel (`use-panel-chat-state.ts`) and main view (`chat-thread-page.tsx`)
  each maintain their own `committedMessages` local state + `hydratedRef` race
  guard. After Phase 3 they keep that local UI state but pull stream slice from
  the store.
- Existing Zustand stores in `src/stores/` use the per-instance factory +
  Context pattern (`createStore` + `useStore`). Chat-stream store uses the
  singleton `create<>()` pattern intentionally — streaming state is global.
- Compact session swap happens at `chat-service/src/api/turn.ts:95-113`. Phase 5
  alias map covers it.

## No code changes committed in Phase 1.
