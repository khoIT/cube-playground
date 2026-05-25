# Phase 04 — Star/Flag a turn + Cross-turn search

## Context Links
- `chat-service/src/api/debug.ts` (host for new annotation + search endpoints)
- `chat-service/src/db/chat-store.ts:43-71` (existing LIKE-with-escape pattern — reuse for search)
- `chat-service/src/db/observability-store.ts:194-225` (`listSessionsForDebug` — pattern for owner-scoped queries)
- `src/pages/DevAudit/dev-audit-page.tsx` (two-pane shell — needs top-nav + search input)
- `src/pages/DevAudit/session-list.tsx` (debounced search pattern — reuse for cross-turn search)
- `src/pages/DevAudit/turn-detail.tsx` (header — star/flag toggle)

## Overview
- Priority: P2
- Status: completed
- Two collaborating features: per-turn annotation (star + flag + free-text note) and a flat cross-turn search across user/assistant text + tool args/results. Search results replace the session list when query non-empty.

## Key Insights
- Annotations are owner-scoped to prevent one developer from seeing another's stars (cross-owner read still 403). Stored in a new table FK→chat_turns ON DELETE CASCADE so deleting a session naturally purges them (relevant since phase 01 hard-purge cascades).
- Search is a multi-LIKE union — the dataset is small enough (single-digit thousands of turns per dev) that LIKE without FTS5 is fine. If perf becomes an issue, layer FTS5 via additive migration in a future phase. (YAGNI now.)
- Cross-turn search must be owner-scoped via session join — query filter `chat_sessions.owner_id = ?`.

## Requirements

Functional:
- New table: `turn_annotations(turn_id TEXT PK FK→chat_turns ON DELETE CASCADE, owner_id TEXT NOT NULL, starred INTEGER NOT NULL DEFAULT 0, flag TEXT, note TEXT, updated_at INTEGER NOT NULL)`. Owner-scoped lookups.
- `POST /debug/turns/:turnId/annotation` — upsert (body: `{ starred?: boolean, flag?: string|null, note?: string|null }`). 401/403 via X-Owner-Id.
- `DELETE /debug/turns/:turnId/annotation` — removes the row.
- `GET /debug/search?q=&game=&starred=&cursor=&limit=` — returns `{ results: SearchHit[], nextCursor: string|null }`. `SearchHit = { turnId, sessionId, sessionTitle, role, snippet, matchSource, createdAt, starred, flag }`.
- /debug/turns/:turnId returns annotation when present.
- UI: star/flag toggle on assistant turn headers in turn-detail.tsx (golden star icon when starred; flag dropdown with `bug|important|review|none`; small note field collapsible).
- UI: search bar at top of dev-audit-page.tsx. When q non-empty, replace SessionList with a flat result list; clicking a result navigates to /dev/chat-audit/:sessionId and scrolls to the turn.

Non-functional:
- Search latency < 200ms over a single-dev DB (~5k turns).
- Pagination cursor: `${started_at}:${turn_id}` (deterministic, unique).
- 256 char snippet, query term substring-highlighted.

## Architecture

```
turn_annotations
   ├─ FK→chat_turns(id) ON DELETE CASCADE  (auto-purge on hard delete)
   └─ owner_id stored for fast filter

POST /debug/turns/:turnId/annotation:
   verify turn owner via existing getTurnOwnerId(...)
   INSERT OR REPLACE INTO turn_annotations ...

GET /debug/search?q=...:
   build LIKE pattern with escape
   SELECT ct.id AS turn_id, ct.session_id, cs.title, ct.role, ct.started_at,
          ct.user_text, ct.assistant_text, ta.starred, ta.flag
     FROM chat_turns ct
     JOIN chat_sessions cs ON cs.id = ct.session_id
     LEFT JOIN turn_annotations ta ON ta.turn_id = ct.id AND ta.owner_id = ?
     WHERE cs.owner_id = ?
       AND (game IS NULL OR cs.game_id = ?)
       AND (starred IS NULL OR ta.starred = 1)
       AND (ct.user_text LIKE ? ESCAPE '\\'
            OR ct.assistant_text LIKE ? ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM tool_invocations ti WHERE ti.turn_id = ct.id
                       AND (ti.args_json LIKE ? OR ti.result_summary LIKE ?)))
     ORDER BY ct.started_at DESC
     LIMIT ? OFFSET ?    -- replaced with cursor where-clause for stable paging

UI:
   dev-audit-page.tsx
      ├─ SearchBar (controlled, debounced 300ms via existing pattern)
      ├─ if q.trim() empty → SessionList   (existing)
      └─ else            → SearchResultList (new)

   turn-detail.tsx header
      └─ TurnAnnotationToggle (star icon + flag dropdown + note expand)
```

## Related Code Files

Modify:
- `chat-service/src/db/migrate.ts` — call new `migrateAnnotations(db)` helper
- `chat-service/src/api/debug.ts` — three new handlers; export annotation type
- `chat-service/src/api/debug.ts` (or new `debug-search.ts` if file would exceed 200 LOC — recommend split)
- `src/pages/DevAudit/dev-audit-page.tsx` — search bar + conditional list swap
- `src/pages/DevAudit/turn-detail.tsx` — add `<TurnAnnotationToggle turn={...} />` in header
- `src/pages/DevAudit/use-debug-api.ts` + types — new `useDebugSearch`, `useDebugAnnotation`

Create:
- `chat-service/src/db/annotations-migrate.ts` — table + index migration
- `chat-service/src/db/annotations-store.ts` — upsert/delete/getByTurn helpers (< 100 LOC)
- `chat-service/src/db/turn-search-store.ts` — the search query + cursor logic (< 150 LOC)
- `chat-service/src/api/debug-search.ts` — Fastify plugin registered under the debug prefix (< 150 LOC)
- `chat-service/src/api/debug-annotations.ts` — Fastify plugin (< 100 LOC)
- `src/pages/DevAudit/turn-annotation-toggle.tsx` — star + flag + note (< 200 LOC)
- `src/pages/DevAudit/search-result-list.tsx` — flat row renderer (< 150 LOC)
- Tests: annotation CRUD, search owner isolation, search cursor stability, snippet builder

## Implementation Steps

1. **Schema**: `annotations-migrate.ts` creates `turn_annotations` + index on `(owner_id, starred)`. Hook into `migrate.ts` after `migrateObservability`.
2. **Store**: `annotations-store.ts` — `upsertAnnotation`, `deleteAnnotation`, `getAnnotation`. Use INSERT OR REPLACE keyed on turn_id; updated_at = Date.now() each upsert.
3. **Search store**: `turn-search-store.ts` — `searchTurns({ ownerId, q, gameId, starredOnly, cursor, limit })` returning `{ rows, nextCursor }`. Cursor decoded as `${startedAt}:${turnId}` then translated into a WHERE clause `(started_at < ? OR (started_at = ? AND id < ?))`.
4. **Snippet**: `buildSnippet(text, query, windowChars=256)` — utility in `turn-search-store.ts`. Centers window around the match offset; HTML-escape via the FE since DTO returns raw text.
5. **API**: split debug.ts — register `debug-annotations.ts` and `debug-search.ts` as separate plugins under the same `db` opt. Reuse `extractOwnerId` and `getTurnOwnerId` from debug.ts (export them from there).
6. **FE hooks**: add `useDebugSearch(q, opts)` + `useTurnAnnotation(turnId)` + `useSetTurnAnnotation()` (mutation).
7. **FE UI**:
   - Top search bar in `dev-audit-page.tsx`: 300ms debounce; when set, mount `SearchResultList` instead of `SessionList`.
   - `turn-annotation-toggle.tsx`: star toggle (visible always), flag dropdown (4 options), note inline expand.
   - Result row click navigates `history.push('/dev/chat-audit/' + sessionId + '#turn-' + turnId)`. Session detail scrolls into view by id on mount.
8. **Verify**: search "delete" returns turns where assistant explained a deletion; star a turn → confirm row in DB and persistent across reload.

## Todo List

- [x] Annotation migration + store + tests
- [x] Search store + cursor + tests
- [x] Split debug.ts into debug-annotations.ts + debug-search.ts
- [x] FE: search bar in dev-audit-page
- [x] FE: result list component
- [x] FE: annotation toggle in turn header
- [x] FE: scroll-to-turn anchor when navigating from search
- [x] Manual: search across user_text, assistant_text, tool args, tool result

## Success Criteria

- Starring a turn persists across reload and across machines (via snapshot if extended — note: this phase does NOT extend snapshot for annotations; they're owner-scoped + dev-local. Document as accepted trade-off.)
- Search returns ranked-by-recency hits with snippet; cross-owner data NEVER appears
- Cursor pagination is stable when new turns arrive during paging (uses started_at, not OFFSET)

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| LIKE %q% on big tool_invocations becomes slow | M | M | Single-LIKE on text columns first; tool_invocations subquery only matched when text match fails — add later if it becomes hot |
| Snippet builder leaks PII into UI from another owner's data via misuse | L | H | Owner filter is on JOIN; integration test that explicitly seeds two owners and asserts isolation |
| Annotation row count grows unbounded | L | L | One row per turn max; bounded by chat_turns size |
| File ownership conflict between phase 04 changes to dev-audit-page.tsx and phase 05 nav link | M | L | Coordinate: phase 04 adds search bar; phase 05 adds top-nav. Both edit the same file → must be sequenced, not parallel. Plan reflects this. |

## Security Considerations
- Annotation reads strictly owner-scoped via WHERE owner_id = X-Owner-Id.
- Search JOIN enforces `cs.owner_id = ?` — never returns another owner's turn.
- Note field capped at 1 KB (server-side validate).

## Next Steps
- Future: extend snapshot v4 with annotations if cross-machine sync is requested.
- Future: add FTS5 if search ever exceeds 200ms.

## Unresolved Questions
- Should annotations propagate via chat-snapshot.json? Locked NO for v2 (dev-local). Re-evaluate later.
