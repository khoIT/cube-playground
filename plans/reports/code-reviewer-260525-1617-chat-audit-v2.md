# Adversarial Review — chat-audit v2

Date: 2026-05-25  
Scope: 7 phases (01–06, 08) just landed on `main`. 1386 tests pass.  
Focus: red-team against PII leaks, owner isolation, SSE drift, races, allowlist bypass, migration order, localStorage.

---

## Critical Issues (must fix)

### C1. FE bypass-cache toggle + model selector are dead code (proxy strips headers)

- File: `server/src/routes/chat.ts:154-164`
- Concern: FE sets `X-Bypass-Cache` and `X-Model` on `POST /api/chat/sessions/:id/turn`
  (verified at `src/api/chat-sse-client.ts:282-284`). The server proxy at chat.ts:156-161
  forwards ONLY `Content-Type`, `X-Cube-Token`, `X-Cube-Game`, `X-Owner-Id`. The new headers
  never reach chat-service. Result: settings-page "Bypass response cache" toggle, composer
  per-message bypass toggle, AND model override in `useChatServiceSettings` are silent no-ops.
  The chat-service code paths at `chat-service/src/api/turn.ts:268,270` are unreachable from
  prod traffic.
- Fix: in `server/src/routes/chat.ts:156`, conditionally forward the two headers when
  present on `request.headers`:
  ```ts
  const fwd: Record<string,string> = { 'Content-Type':'application/json', 'X-Cube-Token':token,
    'X-Cube-Game':body.game, 'X-Owner-Id':owner };
  const bypass = request.headers['x-bypass-cache'];
  if (typeof bypass === 'string') fwd['X-Bypass-Cache'] = bypass;
  const model = request.headers['x-model'];
  if (typeof model === 'string') fwd['X-Model'] = model;
  ```
  Add an integration test asserting both headers round-trip.

### C2. `POST /agent/turn` accepts soft-deleted sessions → silent resurrection

- File: `chat-service/src/api/turn.ts:101-109`
- Concern: `chatStore.getSession` returns soft-deleted rows (no `deleted_at` filter at the
  store level — verified at `chat-service/src/db/chat-store.ts:32-41`). The turn endpoint
  only checks existence + owner. A client retaining a deleted `session_id` can keep posting
  turns; the session implicitly resurrects (turns appended; `last_turn_at` updates) while
  `deleted_at` stays set → it remains hidden from the chat UI list but is still being
  written. Race window: 7 days until retention-sweep purges the session, at which point the
  newly-appended turns are CASCADE-deleted with no warning to the user.
- Fix: in `turn.ts:103-105`, treat `existing.deleted_at != null` as 404, identical to the
  sessions GET handler at `api/sessions.ts:104`. Plan risk row R3 anticipates this pattern;
  this is the missed callsite.

---

## Notable Issues (should fix)

### N1. Cache-hit replay bypasses stream registry → refresh-resume sees empty turn

- File: `chat-service/src/api/turn.ts:287` + `chat-service/src/cache/replay-cached-turn.ts:35`
- Concern: `replayCachedTurn(cached, stream)` is called with no `emitFn`, so it writes
  token/result events directly via `writeSseEvent` without invoking `registry.append`. If a
  client disconnects and reconnects through `/agent/turn/:turnId/stream` mid-replay (window
  is microseconds — better-sqlite3 sync replay → done), the registry ring will only contain
  `turn_started` + `done`, with token/result missing. Tiny race window in practice but
  violates the SSE wire-shape contract (replay test only covers in-process shape).
- Fix: pass `emit` (the closure at turn.ts:181 that does both registry+stream) as `emitFn`
  to `replayCachedTurn`. One-line change.

### N2. Missing `loading` event on cache-hit path

- File: `chat-service/src/cache/replay-cached-turn.ts`
- Concern: Live turns emit `loading` before tokens; cache-hit replay skips it. FE seeds
  state to `'loading'` client-side already (verified at `src/stores/chat-stream-store.ts:339`),
  so this doesn't break the current UI, but the wire-shape "byte-identical to live"
  contract in the plan is not honored. Future consumers that key off `loading` will drift.
- Fix: emit `{ type: 'loading', data: {} }` as the first event in `replayCachedTurn`.

### N3. Cache-hit turns pollute leaderboard legacy bucket

- File: `chat-service/src/db/leaderboard-store.ts:100-104` + `api/turn.ts:292-307`
- Concern: cache-hit branch inserts an assistant `chat_turns` row with no `stop_reason`
  set (the observability stack is never constructed in that branch). Leaderboard's
  success-rate logic treats NULL `stop_reason` as pre-phase-02 legacy and excludes from
  scoring. Cache-hit turns will inflate `legacyCount` and skew success-rate denominators
  in any deployment that turns on caching.
- Fix: in the cache-hit branch (turn.ts ~302), pass `stopReason: 'end_turn'` to appendTurn
  (need to add column to AppendTurnParams) OR post-insert `updateTurnStopReason(db, turnId,
  'end_turn')`. Cache hits are by definition successful end_turns (gated at write time).

### N4. PII threat-model — owner B sees original owner A's session/turn UUIDs in DOM

- File: `src/pages/DevAudit/turn-detail.tsx:185-188`
- Concern: per-game cache scope means owner B's cache-hit turn's `originalTurnId` /
  `originalSessionId` point to owner A's records. The CacheHitBadge renders these IDs in
  the href and title attribute. Backend correctly 403s if owner B clicks through, but the
  IDs themselves leak in DOM — owner B learns owner A asked the same question.
  `responseCacheEnabled` is `false` by default so prod risk is gated, but pre-ship audit
  should consider redacting or omitting original IDs from the FE response when the
  requesting owner doesn't own that session.
- Fix: backend can return `originalTurnId: null, originalSessionId: null` when
  `chat_sessions[id=original_session_id].owner_id !== requestingOwnerId`. Single JOIN at
  serialization time in `debug.ts:200-225` (rowToDebugTurn).

### N5. localStorage settings unmount-flush reads stale storage

- File: `src/pages/Settings/ChatService/use-chat-service-settings.ts:92-101`
- Concern: unmount cleanup calls `writeSettings(readChatServiceSettings())` — it reads the
  OLD localStorage value and writes it back. If the user toggled a setting <250ms before
  unmount, the latest state is in React state (`settings`), not in storage. The flush is a
  no-op and the change is lost.
- Fix: capture `settings` via a ref and write `writeSettings(latestRef.current)` on unmount.

### N6. `response_cache.original_turn_id` is not a FK → dangling refs after retention sweep

- File: `chat-service/src/db/response-cache-migrate.ts:17-32`
- Concern: cache entries survive their `original_turn_id` being CASCADE-deleted when the
  parent session is hard-purged. Future cache hits replay correctly (assistant text is
  embedded in `value_json`), but the CacheHitBadge link 404s. Minor UX bug.
- Fix: add `REFERENCES chat_turns(id) ON DELETE SET NULL` to `original_turn_id`, OR have
  retention-sweep call `clearForGame` for purged sessions' games. Either works.

### N7. Cache hit can race with retention sweep on `chat_turns` FK

- File: `chat-service/src/api/turn.ts:292` + `services/retention-sweep.ts`
- Concern: better-sqlite3 is synchronous + single-writer at the WAL layer, so cross-tick
  races are unlikely. But: if the cache hit's `appendTurn` references `session_id` for a
  session whose `deleted_at` was just set (and N6's lack of FK on the cache → C2 path is
  also relevant), the row writes successfully but is invisible to chat UI. Combined with
  C2, deleted-session resurrection becomes the more likely path.
- Fix: same as C2 — reject turns on `deleted_at != null` sessions.

---

## Verified Safe

- Owner isolation in new debug routes (search/annotations/leaderboard/cache-clear): each
  uses `extractOwnerId` + JOIN on `chat_sessions.owner_id` OR `getTurnOwnerId` pre-check.
  Spot-checked all 4. ✓
- `cache-clear` defense-in-depth: requires owner have a session in the target game ✓
- Model allowlist: `resolveModel` rejects unknown values silently → falls back to
  `config.chatModel`. No header injection vector. ✓
- Soft-delete filter coverage: `listSessions` filters at SQL level; `/sessions/:id` filters
  in-handler; debug routes intentionally include deleted. The ONE gap is C2 (turn endpoint). ✓
- Migrations idempotent: schema.sql uses IF NOT EXISTS; ALTER ADD COLUMN wrapped in
  duplicate-column catch; new tables CREATE IF NOT EXISTS. Fresh DB + upgrade path both work. ✓
- Annotation note 1KB cap enforced server-side at `annotations-store.ts:48` ✓
- localStorage settings: no XSS surface — values are typed primitives written as text,
  consumed as strings/booleans, never injected as HTML. ✓

---

## Confidence Score

**8.5/10** — two critical issues block ship; C1 is high-impact (entire UI toggles are
silent no-ops). C2 is a quiet correctness bug. N1–N7 are smaller. Recommend fixing C1+C2
and one of N3/N5 before landing on main; the rest can be follow-up.

---

## Unresolved Questions

- Should cache hits skip the leaderboard entirely (filter `cache_hit=0` in
  `leaderboard-store.ts`), rather than back-fill `stop_reason='end_turn'`? Either is
  defensible; choice is product.
- Should the FE bypass-cache toggle be wired even when `responseCacheEnabled=false` on the
  server? Current FE has no signal of the server flag — toggle is exposed regardless. Worth
  a `/health` cache-flag echo so the FE can hide the control when cache is disabled.

---

**Status:** DONE_WITH_CONCERNS  
**Summary:** Two critical bugs found (proxy header stripping; turn endpoint accepts
soft-deleted sessions). Seven notable issues. Core design is sound; owner isolation,
migrations, allowlist all check out.
