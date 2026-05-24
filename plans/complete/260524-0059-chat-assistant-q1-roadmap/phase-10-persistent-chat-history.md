# Phase 10 — Persistent Chat History (F9)

## Context Links
- Brainstorm: §M3 F9.
- Existing infra: chat-service SQLite (`chat_sessions`, `chat_turns`, `chat_audit`).

## Overview
- **Priority:** P1 (M3)
- **Status:** pending
- **Description:** Cross-session chat history with semantic search, scoped per `(owner_id, game_id)`. Adds session resume + search; sessions table already exists, this phase adds search index + UI.

## Key Insights
- Sessions already persist; this phase is **search + scoped listing** on top.
- Memory scope confirmed: per-user × per-game only Q1. Cross-game transfer deferred (Q3 open question).
- Search uses SQLite FTS5 only (decision Q6). No vector embeddings in Q1. Defer semantic search to Q2 if precision@5 falls below 0.7 on QA query set.

## Requirements

### Functional
- `GET /api/chat/sessions?ownerId=&gameId=&q=` — list + search.
- Search matches against `chat_turns.user_text` + `chat_turns.assistant_text` (lexical, FTS5).
- Pagination 20 per page; sort by `last_turn_at DESC`.
- UI: search bar in `chat-history-rail.tsx`.
- Session resume already supported via route `/chat/:id`; this phase improves discoverability.

### Non-functional
- Search response <300ms p95 for owner with <1000 sessions.

## Architecture
- **Schema additions:**
  ```
  CREATE VIRTUAL TABLE IF NOT EXISTS chat_turns_fts USING fts5(
    user_text, assistant_text, content='chat_turns', content_rowid='rowid'
  );
  ```
- **Service:** `chat-service/src/services/turn-search.ts` — FTS5 query + ranking only.
- **Route:** extend existing `/api/chat/sessions` to accept `q` + `gameId`.
- **UI:** `src/pages/Chat/components/chat-history-rail.tsx` — add search input + result list.

### Data flow
```
new turn ─► chat-store insert ─► fts5 trigger updates index
search request ─► fts5 ranked hits ─► sessions
```

## Related Code Files

### Existing infra
| Capability | Path | Use |
|---|---|---|
| Sessions schema | `chat-service/src/db/schema.sql` | Add fts table + triggers |
| Chat store | `chat-service/src/db/chat-store.ts` | Hook turn insert → fts update |
| Sessions list endpoint | `chat-service` routes (locate `/api/chat/sessions`) | Add q + gameId params |
| History rail | `src/pages/Chat/components/chat-history-rail.tsx` | UI surface |
| Sessions hook | `src/pages/Chat/hooks/use-chat-sessions-list.ts` | Accept search param |

### Create
- `chat-service/src/db/fts-migrate.ts`
- `chat-service/src/services/turn-search.ts`
- `chat-service/src/services/__tests__/turn-search.test.ts`
- `src/pages/Chat/components/history-search-input.tsx`

### Modify
- `chat-service/src/db/schema.sql` (add fts5 virtual table + triggers)
- `chat-service/src/db/chat-store.ts` (insert triggers maintain fts index)
- Sessions list route (search params)
- `src/pages/Chat/hooks/use-chat-sessions-list.ts` (pass q)
- `src/pages/Chat/components/chat-history-rail.tsx` (search input)

### Delete
- None.

## Implementation Steps
1. Add FTS5 virtual table + triggers. (Embedding deferred to Q2.)
2. Schema additions + migrate.
3. Add fts5 triggers on `chat_turns` insert/update/delete.
4. `turn-search.ts` — query FTS, rank by bm25.
5. Extend route + hook for `q`/`gameId`.
6. Build `history-search-input.tsx`; wire to rail.
7. Tests: insert turn → FTS hit; search ranks recent + relevant.

## Todo List
- [ ] Schema + migrate (FTS5 only)
- [ ] `turn-search.ts`
- [ ] Route + hook extension
- [ ] Search UI in rail
- [ ] Tests

## Success Criteria
- ≥30% of sessions reference history (M3 target — measured via "Resume from history" action in audit).
- Search returns relevant turn within top-5 for QA query set (precision@5 ≥0.7).
- Search latency <300ms p95.

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| FTS triggers slow inserts | Low | Med | Benchmark; switch to manual update on commit batch if needed. |
| Cross-game leakage in search | Med | High | All queries enforce `(owner_id, game_id)` filter; integration test. |

## Security Considerations
- **PII boundary:** session content includes user prompts (may contain sensitive segments names). All search queries filtered by `owner_id` + `game_id` server-side. **Never** trust client-supplied owner.
- FTS index rebuilt on `chat_sessions` cascade delete.

## Next Steps
- Blocked by: phase-05 not required (independent DB).
- Blocks: phase-11 (glossary memory may reuse embedding infra), phase-13 (recents rail consumes session list).

## Rollback
Drop new FTS virtual table + triggers; sessions list reverts to existing behaviour. Existing sessions intact.
