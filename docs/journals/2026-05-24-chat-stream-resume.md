# Chat Stream Resume — SSE Persistence & Multi-View Replay

**Date:** 2026-05-24 18:52
**Severity:** High
**Component:** Chat streaming (client singleton store + server registry)
**Status:** Resolved

## What Happened

Chat SSE streams were tethered to React component lifecycle. Two failure modes shipped to production-like behavior:
1. **Module switch mid-stream** → unmount killed fetch, side panel blanked until `done` event arrived.
2. **Hard refresh mid-stream** → all buffered tokens lost; no server-side replay.

Shipped Phase 1 (client hoist) + Phase 2 (server replay) to root the stream state in a Zustand singleton keyed by `sessionId`, with an in-memory turn buffer + fallback endpoint for recovery.

## What We Built

**Client side (5 commits):**
- Singleton `chat-stream-store` (Zustand) replaces per-component `useReducer`. Unmount no longer cancels the fetch.
- `useChatStream` hooks into a refcount lifecycle; cleanup fires only when all subscribers detach AND the stream completes.
- Session-ID aliasing via `Map<realId, originalKey>` so mid-stream `session_created` events (which swap the ID) don't flicker the store entry.
- Multi-view: `chatSessionChanged` window event (fired on stream done) triggers refetch in other views holding the same session. No new callback registry needed.

**Server side:**
- Ring buffer per turn (`stream-registry.ts`): 2000-event capacity, 100-turn bound, 5min TTL, 60s-interval sweeper with `.unref()` for clean test/shutdown.
- UUID v4 `turnId` replaces guessable `sessionId:index`. Clients get `turn_started` SSE event immediately to grab the stable handle.
- `GET /agent/turn/:turnId/stream?from=<offset>` replays events from offset into the ring, then tails live. Returns 409 + `availableFromOffset` if ring has looped (client retries with `from=0`).
- Compact-session swap calls `registry.aliasSession(old, new)` so stale clients find the turn.
- Session fetch returns `activeTurnId` so clients know if a replay is available.

## The Reality

Code review flagged **H1: refCount lost on replay overflow** — final overflow fallback reset the entry with `refCount=0`, breaking observability (not GC/cancel today, so no functional impact). Fixed pre-merge by carrying refCount through `runReplayAttempt`.

Defensive nits M1-M3 noted (async safety comment, alias cleanup TODO, session_created alias write). All punted as acceptable post-ship. Nothing broke in testing.

## Numbers

- 1,064 tests passing (851 root + 213 chat-service). 5 pre-existing failures in unrelated test file.
- 44 new tests: actions (10), store (6), attach-replay (4), cross-view scenarios S1/S3/S5 (3), parser (4), registry (11), replay endpoint (6).
- 9 client files, 8 server files touched. 5 commits spanning 3 days of iteration.

## Key Decisions

1. **Singleton > factory + context** — streaming state is global; per-instance dies on unmount. Context was overkill.
2. **Alias map over re-keying** — `session_created` swaps ID mid-stream. Re-keying the Map flickered because the entry key changed. Aliases resolve in O(1) without mutating.
3. **Reused `chatSessionChanged` window event** — already existed from dispatch done-notify. Multi-view-friendly, no new infra.
4. **Refcount is observability-only** — nothing GCs or cancels based on it. Good sanity check; design didn't need it yet.

## What Stung

The refcount drift in `runReplayAttempt` wasn't caught by the overflow unit test because idle-fallback behavior (status changes to `idle`) is correct from the user's POV. Only a thorough reviewer spotting the `startTurn`/`makeIdleEntry` pattern inconsistency caught it. Code review + test pairing saved us here.

## Next Steps

- Watch for memory bloat in registry aliases across chained compacts (M2 TODO).
- If `writeSseEvent` ever becomes async, replay loop needs a snapshot/buffer guard (M1 comment).
- Optional: add integration test for proxy 409 shape (M4 — both sides unit-tested, proxy untouched).

**Status:** DONE
