---
phase: 4
title: Search default top-10
status: completed
priority: P2
effort: 3h
dependencies:
  - 2
---

# Phase 4: Search default top-10

## Overview

The Search tab shows a "Start typing to search…" hint before any query. Replace that empty state with a **default top-10 list per mode** (Turns / Sessions / Cached Queries) so admins get affordance + immediate value. Two of three modes already return rows on empty `q`; only the Turns endpoint needs a small server change.

## Requirements

- Functional: with an empty query, each mode renders up to 10 default rows:
  - **Sessions** → 10 most-recent sessions (`/debug/sessions` empty `q`, recent ordering — already works).
  - **Cached** → top 10 by `hit_count DESC` (`searchCachedQueries` empty filter — already works, `response-cache-store.ts:178,238`).
  - **Turns** → 10 most-recent turns. **Requires server change** (`/debug/search` currently returns `[]` on empty `q`).
- Default lists are clearly labeled (e.g. "Recent sessions" / "Top cached queries" / "Recent turns") to distinguish from search results. Typing switches to filtered results as today.
- Non-functional: default lists apply on BOTH surfaces (standalone + admin). On the standalone non-admin view, "recent sessions/turns" are naturally self-scoped by `X-Owner-Id`; on admin scope=all they're org-wide — acceptable.

## Architecture

**Server (chat-service):** in `chat-service/src/api/debug-search.ts:33-55`, when `q` is empty, instead of returning `{ results: [], nextCursor: null }`, return the most-recent N turns (default 10, capped). Reuse the existing turn-listing store path; order by `created_at DESC`. Keep the existing cursor contract (`nextCursor` may be null for the default list — no pagination needed for a 10-row affordance). Respect the same owner/scope/game filters the search already honors so the default list matches the active context.
- If no recent-turns helper exists, add a thin `listRecentTurnsForDebug(db, { ownerId, gameId, limit })` in `observability-store.ts` mirroring the sessions ordering, projected to the `SearchHit` shape (turnId/sessionId/title/role/snippet/createdAt/starred/flag).

**Client (`search-tab.tsx`):**
- Drop the `isEmpty → EMPTY_HINTS` branch. Always render the mode's result list; on empty `q` it shows the default list returned by the hook.
- Hooks: `useDebugSessionsSearch` and `useDebugCachedQueriesSearch` currently **skip the fetch when `q` is empty** (`use-debug-sessions-search.ts`, `use-debug-cached-queries-search.ts`). Relax that guard to fetch with empty `q` (limit 10) so defaults load. `useDebugSearch` (turns) likewise must fire on empty `q` after the server supports it.
- Add a small header label above the list indicating default vs filtered state ("Top 10 — start typing to search").

## Related Code Files

- Modify (server):
  - `chat-service/src/api/debug-search.ts` — empty-`q` branch returns recent-N turns.
  - `chat-service/src/db/observability-store.ts` — add `listRecentTurnsForDebug` if no existing projection fits.
- Modify (client):
  - `src/pages/DevAudit/search-tab.tsx` — remove empty-hint branch; always render lists; add default-state label.
  - `src/pages/DevAudit/use-debug-search.ts` — allow empty `q` fetch (limit 10) for the default turns list.
  - `src/pages/DevAudit/use-debug-sessions-search.ts` — fetch on empty `q` (limit 10).
  - `src/pages/DevAudit/use-debug-cached-queries-search.ts` — fetch on empty `q` (limit 10).
  - Result components may need a tiny "default mode" affordance label, but row rendering is unchanged.
- Tests: `src/pages/DevAudit/__tests__/search-tab.test.tsx` (update empty-state expectations).

## Implementation Steps

1. Server: add/confirm a recent-turns query; wire the empty-`q` branch in `debug-search.ts` to return up to `limit` (default 10) recent turns honoring owner/scope/game.
2. Verify by curl/test: `GET /api/chat/debug/search?game=…` (no `q`) → 10 recent turns; cached + sessions empty-`q` already return rows.
3. Client hooks: relax the three empty-`q` guards to fetch with `limit=10`.
4. `search-tab.tsx`: replace the `isEmpty` hint with always-on lists + a "Top 10 · start typing to search {mode}" label; keep debounced URL behavior for actual queries.
5. Confirm clicking a default row navigates correctly (sessions → detail, turns → `#turn-`, cached → original session#turn) — same handlers as filtered results.
6. Update `search-tab.test.tsx`; `tsc --noEmit`; run chat-service debug-search tests if present.

## Success Criteria

- [ ] Opening Search (empty input) shows 10 default rows in each mode, labeled as defaults.
- [ ] `GET /api/chat/debug/search` with empty `q` returns ≤10 recent turns (was `[]`).
- [ ] Typing filters as before; clearing the input returns to the default list.
- [ ] Default rows are clickable and navigate identically to search hits.
- [ ] Behavior holds on both `/dev/chat-audit/search` and `/admin/dev/chat-audit/search`.

## Risk Assessment

- **Risk:** recent-turns query cost on large tables. *Mitigation:* `ORDER BY created_at DESC LIMIT 10` on an indexed timestamp; no full scan. Confirm an index exists on the turns table's `created_at` (or session/turn ordering column); if not, note it — do not add an index speculatively without measuring.
- **Risk:** empty-`q` now hits three endpoints on tab open (extra load). *Mitigation:* only the active mode's hook fires; limit 10; cheap.
- **Risk:** changing the `/debug/search` empty-`q` contract affects the standalone Sessions-tab inline search (which also uses `useDebugSearch`). *Check:* Sessions-tab gates on `debouncedQ.trim().length > 0` before showing search results (`sessions-tab.tsx:116`), so an empty-`q` default list won't leak into that pane. Verify after the hook change.

## Next Steps

Verified alongside Phase 3 in Phase 5.
