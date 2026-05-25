# Code Review — chat-stream-resume

**Date:** 2026-05-24
**Scope:** Plan `plans/260524-2216-chat-stream-resume/` — 9 client + 8 server files, 34 tests.
**Verdict:** Solid implementation, no blocking issues. A few correctness nits + one defensive hardening.

---

## Critical

_None._

---

## High

### H1 — `runReplayAttempt` final overflow resets refCount (loses subscriber tracking)

`src/stores/chat-stream-store.ts:354-359`

```ts
// Final overflow → reset entry; UI will fall back to idle.
set((s) => {
  const next = new Map(s.streams);
  next.set(key, makeIdleEntry(sessionId));   // ← refCount=0, drops live subs' count
  return { streams: next };
});
```

Cmp against initial seed in `startTurn` (line 138-144) which preserves `refCount`.
Impact: refcount drifts after overflow. Nothing currently uses refcount for GC/cancel decisions, so observability-only. Fix: read `s.streams.get(key)?.refCount ?? 0` and carry it onto the idle entry.

### H2 — `getEntry` returns a new idle object on every call when entry is missing

`src/stores/chat-stream-store.ts:118-121`

```ts
getEntry: (sessionId) => {
  const s = get();
  return s.streams.get(resolveKey(s, sessionId)) ?? makeIdleEntry(sessionId);
}
```

This is fine for the selector path in `use-chat-stream.ts` (uses inline selector), but any direct caller of `getEntry()` inside a React selector would re-render every snapshot. Not used that way today — guard against future misuse with a comment or a frozen singleton idle entry.

---

## Medium

### M1 — Replay endpoint replay loop is technically race-free but fragile

`chat-service/src/api/replay.ts:73-94`

```ts
for (let i = localStart; i < entry.events.length; i++) { ... }   // synchronous
// ...
const unsubscribe = registry.subscribe(entry.turnId, (event) => { ... });
```

Single-threaded Node means no `append` can interleave between the `for` loop and `subscribe()`. Today this is safe. If `writeSseEvent` ever becomes async (e.g. backpressure-aware), events appended in that window would be lost (replay misses + listener registered too late). Consider:
- snapshot `entry.events.slice()` and capture `entry.totalEmitted` BEFORE writing, OR
- subscribe FIRST with a temporary buffer, then flush replay + buffered tail.

### M2 — `registry.aliases` map growth + brittle TTL cleanup

`chat-service/src/core/stream-registry.ts:189-203`

Sweeper deletes alias keys whose `k===entry.sessionId || v===entry.sessionId` when an entry expires. If multiple compacts happen on the same chain (`A→B→C`), aliases survive past their useful life and the cleanup only catches the keys/vals attached to the *deleted entry's current* sessionId. Memory leak is bounded by `STREAM_REGISTRY_TTL_MS × compact-rate` so unlikely to matter in practice, but worth a TODO.

### M3 — `append` mutates `entry.sessionId` on `session_created` without alias map update

`chat-service/src/core/stream-registry.ts:123-128`

```ts
if (event.type === 'session_created' && event.data.id !== entry.sessionId) {
  entry.sessionId = event.data.id;
}
```

The old sessionId (likely a synthetic `null`-style key or the pre-registration id) is NOT recorded in the alias map. If any client somehow holds the old id and later issues `findRunning(oldId)`, it returns undefined. Today the flow ensures `register()` is called AFTER session_created emits, so `entry.sessionId` already matches. Defense-in-depth: `aliases.set(oldId, newId)` here too.

### M4 — Replay route 409 body shape mismatch between server send + client decode

Server (`replay.ts:55-59`) sends `{ code, availableFromOffset, totalEmitted }`.
Client `ReplayOverflow` interface matches (`chat-sse-client.ts:312-316`). OK.
But the proxy at `server/src/routes/chat.ts:259-269` returns the upstream 409 body verbatim only when content-type is `application/json` — Fastify's default `reply.send({...})` does set that header, so the proxy works. Worth an integration test (only unit-tested on each side).

### M5 — `useAutoReplayAttach` doesn't reset `triggeredRef` when activeTurnId becomes null

`src/pages/Chat/hooks/use-auto-replay-attach.ts:19-26`

```ts
const triggeredRef = useRef<string | null>(null);
// ...
if (triggeredRef.current === activeTurnId) return;
triggeredRef.current = activeTurnId;
```

If a session has activeTurnId=A on first fetch, fires attach. Stream completes, next refetch returns activeTurnId=null. Then a NEW turn starts (activeTurnId=B). `triggeredRef.current !== 'B'` → fires. Good. But if user starts the turn locally via `startTurn` (no replay needed), then refetch returns the just-started turnId=B, attachReplay would fire — guarded by the `streaming`/`loading` check in the store, so it no-ops. Net OK, just a redundant call.

---

## Low

### L1 — `ReplayOverflowError` thrown from generator can race with `cancel()`

`src/api/chat-sse-client.ts:376-377` throws inside the generator, before the first `yield`. `runDispatchLoop` rethrows it; `runReplayAttempt` catches → recurses. If the user clicked Stop in the tiny window before the second attempt, the abort signal won't be visible because we built a fresh `controller` in the new `openChatTurnReplay`. Minor; user can click Stop again.

### L2 — Test file `chat-stream-store-attach-replay.test.ts` uses `any` for event data type

Lines 8, 49, 65. Style nit — type as `unknown` or the generated `SseEvent`. The other store-tests do the same so consistent at least.

### L3 — Server proxy `stream-replay` doesn't validate that `turnId` looks like a UUID

`server/src/routes/chat.ts:228-231` accepts any non-empty string. Server-side downstream returns 404 on unknown turnId so it's safe, but a length/charset check would shed obvious garbage at the edge.

### L4 — `notifyChatSessionChanged` not fired on `compact_warning`

Compact swaps the sessionId mid-stream. `useChatSession` listens for changed events to refetch. If a compact happens and the client is showing the OLD sessionId, it won't refetch automatically. Done-time notification covers it, but live sidecar views may show stale turns until done. Minor.

### L5 — `chat-stream-store.ts` is 361 lines — over the 200-line guideline

The reducer is already split out into `chat-stream-store-actions.ts`. The two private helpers (`runDispatchLoop`, `runReplayAttempt`) could move to a `chat-stream-store-internal.ts`. Pragmatically acceptable since they need closure over `set/get`.

---

## Test Quality

Excellent — tests assert **behavior**, not implementation:
- `cross-view-resume.test.tsx` mounts real components, asserts DOM after stream events.
- `chat-stream-store.test.ts` covers the lifecycle the store owns (refcount, alias, done-notify, unmount-doesn't-cancel).
- `chat-stream-store-actions.test.ts` is pure unit on the reducer.
- `stream-registry.test.ts` covers all branches of the registry including TTL eviction with real timers.
- `replay-endpoint.test.ts` boots a Fastify instance and asserts HTTP codes + SSE wire format.

Idle-fallback test (`gives up after a second 409`) asserts `status === 'idle'` — that's the behavior the user sees, even though the in-memory refcount is technically off (H1).

The deleted `use-chat-stream-reducer.test.ts` migrated cleanly into `chat-stream-store-actions.test.ts`.

---

## Positive

- **Singleton-vs-factory rationale documented** at the top of `chat-stream-store.ts` — exactly the question a reviewer would ask, answered upfront.
- **Pure reducer split** keeps state transitions testable without async/Zustand wiring.
- **Server emits `turn_started` immediately** so the client gets a stable handle before any token.
- **Alias map on both sides** (client store + server registry) keeps compact-session swaps transparent to clients.
- **TTL sweeper uses `unref()`** so tests/process exit cleanly.
- **finished entries don't block fresh registrations** — cap counts running only, with a dedicated test.
- **Backpressure-aware AbortController** ties the upstream socket to the client socket in proxy.
- **Ownership check at replay endpoint** goes through the session row (right place, not just header trust).

---

## Concerns by Severity

| Sev | ID | Title | Action |
|-----|----|-------|--------|
| High | H1 | refCount lost on attachReplay final overflow | Carry refCount onto the idle entry |
| High | H2 | `getEntry` returns fresh object on each miss | Add comment or freeze a singleton |
| Med | M1 | Replay loop synchronous-only safety | Add comment now, refactor if writeSseEvent becomes async |
| Med | M2 | Alias map unbounded across chained compacts | TODO + revisit if memory grows in prod |
| Med | M3 | `append` doesn't alias on session_created | Defensive `aliases.set(oldId, newId)` |
| Med | M4 | Proxy 409 body integration not tested | Add integration test |
| Med | M5 | useAutoReplayAttach fires on local-start turnId | Acceptable; relies on store guard |
| Low | L1-L5 | Minor style/edge nits | Optional cleanup |

---

## Unresolved Questions

1. Should the server registry track session_created→registered-sessionId in `aliases` too (M3), or rely on the current "register after session_created" ordering invariant being maintained by callers?
2. H1 fix shape: prefer carrying refCount through `runReplayAttempt`, or expose a "reset-keeping-refcount" helper from `chat-stream-store-actions.ts`?
3. Should `notifyChatSessionChanged` fire on `compact_warning` (L4) so the sidecar view refetches mid-stream, or wait until done?

---

**Status:** DONE_WITH_CONCERNS
**Summary:** No blockers. One refcount-tracking bug (H1) is observability-only today. Defensive hardening recommended for M1-M3 to keep the registry robust under future changes.
