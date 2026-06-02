# Phase 02 — Unified search with mode toggle

## Context Links
- Design: `design/hifi-mockup.html` (Search tab section)
- Existing search hook: `src/pages/DevAudit/use-debug-search.ts`
- Existing result list: `src/pages/DevAudit/search-result-list.tsx`
- Chat-service search route: `chat-service/src/api/debug-search.ts`
- Proxy: `server/src/routes/chat.ts:617`

## Overview
- **Priority:** P1
- **Status:** completed
- **Description:** Replace the inline banner search input + sidebar swap with a dedicated `/dev/chat-audit/search` page hosting ONE input + chip group `[Turns] [Sessions] [Cached queries]`. Mode determines which API + result layout to use.

## Key Insights
- Existing `useDebugSearch` already handles cursor pagination over `/debug/search` (turns only). Reuse as `Turns` mode.
- `Sessions` mode = call `/debug/sessions?q=` (already supports `q` substring filter, see `chat-service/src/api/debug.ts:142`). No new endpoint.
- `Cached queries` mode = NEW filter against `response_cache.user_text_normalized`. The cleanest path: extend `/debug/cache-effectiveness` to optionally take `q` and return matching `topQueries`-style rows. KISS — no new endpoint; phase 04 plugin honors `?q=`.
- URL state: `/dev/chat-audit/search?q=&mode=turns|sessions|cached` (mode default = `turns`).
- Debounce 300ms, same as existing.

## Requirements
**Functional**
- One search input, autofocus on tab activation.
- Mode chips: `Turns` (default) | `Sessions` | `Cached queries`. Click → URL `?mode=` updates, results reload.
- Empty query → empty state (placeholder text "Search across turns, sessions, or cached queries").
- Each mode renders distinct result layout (see Architecture).
- Click a result → navigate appropriately:
  - Turn → `/dev/chat-audit/sessions/<sid>#turn-<tid>`
  - Session → `/dev/chat-audit/sessions/<sid>`
  - Cached query → highlight modal or expand inline (see hi-fi mockup)

**Non-functional**
- Each new file < 200 LOC.
- Reuse `useDebugSearch` for Turns mode unchanged.
- No new aggregate API across owners.

## Architecture

```
UnifiedSearchPage (src/pages/DevAudit/unified-search-page.tsx)
├── SearchInput (controlled, debounced 300ms)
├── SearchModeChips (src/pages/DevAudit/search-mode-chips.tsx — turn/session/cached pills)
└── ResultsArea
    ├── mode=turns    → <SearchResultList ... /> (existing, re-skinned)
    ├── mode=sessions → <SearchSessionResults /> (renders DebugSession rows w/ snippet)
    └── mode=cached   → <SearchResultsCached /> (renders TopQueryRow w/ hit count, $ saved)
```

**Data flow per mode:**

| Mode    | Endpoint                                  | Hook                              | Row layout                                                     |
|---------|-------------------------------------------|-----------------------------------|----------------------------------------------------------------|
| turns   | `/api/chat/debug/search?q=&game=`         | `useDebugSearch` (existing)       | session title · turn snippet w/ highlight · model · skill · timestamp |
| sessions| `/api/chat/debug/sessions?q=&game=`       | NEW `useDebugSessionsSearch`      | title · created · turn count · last-turn time                  |
| cached  | `/api/chat/debug/cache-effectiveness?q=&game=&topN=20` (phase 04) | NEW `useCachedQueriesSearch` | query snippet · skill · model · hits · $ saved                |

## Related Code Files
**Modify**
- `src/pages/DevAudit/search-result-list.tsx` — re-skin to match hi-fi (no API change, only visual).

**Create**
- `src/pages/DevAudit/unified-search-page.tsx` (~150 LOC) — page-level controller (URL sync, debounce, mode dispatch).
- `src/pages/DevAudit/search-mode-chips.tsx` (~50 LOC) — pure chip group.
- `src/pages/DevAudit/search-results-cached.tsx` (~80 LOC) — cached-query rows.
- (Optional inline) `useDebugSessionsSearch` + `useCachedQueriesSearch` — can be local to unified-search-page.tsx if < 50 LOC each, OR split into `use-search-sessions.ts` / `use-search-cached.ts`. Split if total page file > 180 LOC.

## Implementation Steps
1. Create `search-mode-chips.tsx`: pill group, active chip = T.brand bg + T.surface fg, inactive = T.surfaceSubtle + T.n700. Mono labels.
2. Create `unified-search-page.tsx`:
   - Read `q` + `mode` from `useLocation().search` (URLSearchParams).
   - Local input state, debounce 300ms → push to URL.
   - Switch on mode → fetch via 3 hooks; render correct result component.
   - Empty state when `q.trim().length === 0`: brand-muted hint + 3 chip examples.
3. Create `search-results-cached.tsx`: table rows, mono numerics, T.n600 dividers. Click row → expand inline showing original turn link.
4. Re-skin `search-result-list.tsx` to match hi-fi (token swap; keep all logic).
5. Phase 02 depends on phase 04 ONLY for cached-mode results — if phase 04 not ready, ship Turns + Sessions modes first; cached chip shows "Coming soon" placeholder.
6. Compile check.

## Todo List
- [x] `search-mode-chips.tsx`
- [x] `unified-search-page.tsx` (URL sync + debounce + mode dispatch)
- [x] `search-results-cached.tsx`
- [x] Re-skin `search-result-list.tsx`
- [x] Add session-search hook (5-10 LOC inline OR new file)
- [x] Add cached-search hook (consumes phase 04 plugin)
- [x] Manual mode-switch + deep-link test
- [x] Compile

## Success Criteria
- Typing in input updates URL after 300ms; URL reload restores query + mode.
- Switching chip with non-empty query refetches against the new endpoint without page flash.
- All 3 result layouts render hi-fi-correct.
- Empty query state matches mockup.
- Clicking a turn result navigates to correct anchor and highlights the turn.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Cached-mode depends on phase 04 — order skew breaks build | Med | Med | Cached chip behind `if (results)` guard; renders "Coming soon" until backend ready |
| `/debug/sessions?q=` LIKE filter is title-only — users expect content search | High | Med | Document: Sessions mode = title-match only; for content use Turns mode. Show hint under input. |
| URL `mode` value tampering (e.g. `?mode=evil`) | Low | Low | Whitelist parse: `mode = ['turns','sessions','cached'].includes(raw) ? raw : 'turns'` |
| Debounce + mode-change race re-fetches stale page | Low | Low | AbortController per fetch (same pattern as existing useDebugSearch) |

## Security Considerations
- All 3 endpoints owner-scoped via existing X-Owner-Id (`debug-shared.ts:extractOwnerId`).
- Cached-mode result rows show OWNER's data only — chat-service enforces by joining on `chat_sessions.owner_id` for the `original_turn_id` lookup. (See phase 04 store impl.)

## Next Steps
- Phase 06 will add keyboard shortcuts (cmd-K opens this tab + focuses input).
- Phase 04 must ship `?q=` param in `/debug/cache-effectiveness` for cached mode.
