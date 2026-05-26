# Chat Stream: New-Chat Slot Leak + Reasoning Persistence

**Date:** 2026-05-26 09:15
**Severity:** High
**Component:** Chat stream store, session lifecycle, turn hydration
**Status:** Resolved

## What Happened

Two separate issues exposed the same architectural fragility: the chat-stream singleton store is keyed by session ID, but when a session is created during streaming or a new chat is opened while a prior session's state still lives in the store, identity and rendered state leak between chats.

**Issue 1:** Visiting `/chat` (sessionId=null) after exiting a prior session returned stale turn data from that session instead of starting fresh.

**Issue 2:** The assistant's thinking/reasoning visible during streaming disappeared when the turn completed, because hydration from the API overwrote already-streamed turns.

Both fixes shipped in two separate commits.

## Technical Grit

### Issue 1: The __new__ Slot Leak (Commit e63342e)

The store keys entries by `__new__` for null sessions. On `session_created` (during streaming), the store writes an `aliases` entry (`realId → __new__`) but leaves the entry *at* `__new__` with its `sessionId` field flipped to the real session ID.

After the chat is done and the user exits, the slot still holds that prior session's ID. Next `/chat` visit: `useChatStream({sessionId: null})` selector resolves to `__new__`, returns the stale entry. `liveSessionIdRef` gets set to `entry.sessionId` (the old session's ID), and the next `sendTurn` ships into the prior session.

**Fix:** In the useChatStream selector, treat the `__new__` slot as empty when `sessionId === null && entry.sessionId !== null && status not in-flight`. In-flight subscriptions still resolve the live ID (needed for URL replace on `session_created`).

Considered pushing the migration upstream in the store (move entry off `__new__` on stream exit), but that broke a contrived S3 cross-view-resume test that pinned subscribers at `sessionId=null` throughout done. Hook-level guard has narrower blast radius. Updated S3 to mirror production's null→real-id transition.

**Tests:** 2 new regression tests verify stale slot returns null when not in-flight, and in-flight case still flows the live ID.

### Issue 2: Reasoning Lost at Turn Completion (Commit 05e1110)

**Layer 1 — Hydration Race:** After `session_created`, chat-thread-page.tsx had a `useEffect` that fetched the session and called `sessionTurnsToMessages`. This overwrote already-streamed committedMessages with stale API response. But the thinking/reasoning *was* rendered in `buildStreamingSections` — it just got clobbered.

**Fix:** Skip hydration when `committedMessages.length > 0`. Reasoning section (already in buildStreamingSections) no longer gets overwritten.

**Layer 2 — Reasoning Never Captured:** The API `turn.ts` had an unused `reasoning_json` DB column. Turn deltas never accumulated `thinking` SSE events. Sessions endpoint never returned reasoning.

**Fix:**
- `turn.ts`: accumulates `thinking` deltas into `reasoningJson`, appends to turn on completion.
- `sessions.ts`: TurnDto adds `reasoning?: string | null` for assistant rows.
- FE ChatTurn type adds it; `sessionTurnsToMessages` prepends a `{type: 'reasoning', text}` section above the assistant text (matches streaming order, layout stable across live → persisted).
- ReasoningTrace collapsible component already existed; now has durable content.

**Out of scope:** Cache-hit replays (turn.ts:313) don't carry the original turn's reasoning — would need a cache payload schema bump. Historical pre-change rows stay null.

## Root Cause Analysis

Both bugs are the **same shape**: singleton store state shared across surfaces where one surface (chat-thread-page) does URL replace that another surface (panel) doesn't. That asymmetry leaks one chat's identity or rendered state into the next.

```
Single Store for Global Session State
        ↓
Asymmetric Surface Mounts (page + panel)
        ↓
URL Replace on session_created (page only)
        ↓
Stale slot identity or hydration state flows to next surface
```

Issue 1 leaks the session ID; Issue 2 leaks DOM-rendered state into the API hydration cycle. Both are surface-local guards, not upstream invariants. That means the next surface added will need the same guards.

## Lessons Learned

1. **Singleton stores + multi-view mounts need identity escrow.** The `aliases` map was right — just needed the selector to validate. Lesson: when keying by a user-supplied ID (sessionId=null) that changes during lifecycle, the selector must backstop stale references.

2. **Hydration must be defensive about streamed state.** Layer 1 (skip hydration if exists) was a safety net. Should have been layer 0. Lesson: any effect that fetches API state and overwrites in-flight renders is a footgun; gate it.

3. **Streaming state isn't ephemeral.** Reasoning, thinking, partial turns — all need persistence paths. The `reasoning_json` column existed for two years; nobody connected the dots. Lesson: if a DB column lives unused, audit what it was meant for and either wire it up or delete it.

## Next Steps

1. **Cache-hit reasoning carry-over** — Schema change needed to preserve reasoning in cache payloads. Defer; acceptable caveat for now.
2. **Audit multi-view asymmetries** — As new surfaces are added (e.g., chat sidebar for quick-browse), ensure they get the same `sessionId === null && entry.sessionId !== null` guard or a better upstream solution.
3. **Streaming → persisted state checklist** — Walk any new SSE field (audio, images, etc.) through "does this live in the DB? Does hydration clobber it? Is there a component to render it?" before shipping.

---

**Commits shipped:** e63342e, 05e1110
**Files modified:** src/pages/Chat/hooks/use-chat-stream.ts, src/pages/Chat/chat-thread-page.tsx, src/shell/chat-overlay/use-panel-chat-state.ts, src/pages/Chat/hooks/use-chat-session.ts, chat-service/src/api/turn.ts, chat-service/src/api/sessions.ts
**Tests:** 130 FE chat tests pass; 23 backend round-trip tests pass; typecheck clean.
