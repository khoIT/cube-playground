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
- Semantic search via local embeddings (sqlite-vec or simple TF-IDF) — avoid external API dep.

## Requirements

### Functional
- `GET /api/chat/sessions?ownerId=&gameId=&q=` — list + search.
- Search matches against `chat_turns.user_text` + `chat_turns.assistant_text` (lexical) AND embeddings (semantic).
- Pagination 20 per page; sort by `last_turn_at DESC`.
- UI: search bar in `chat-history-rail.tsx`.
- Session resume already supported via route `/chat/:id`; this phase improves discoverability.
- Embedding generation: background job per new turn (async, non-blocking).

### Non-functional
- Search response <300ms p95 for owner with <1000 sessions.
- Embedding job retries with backoff; failure does not block chat.

## Architecture
- **Schema additions:**
  ```
  CREATE TABLE IF NOT EXISTS chat_turn_embeddings (
    turn_id TEXT PRIMARY KEY REFERENCES chat_turns(id) ON DELETE CASCADE,
    embedding BLOB NOT NULL,           -- float32 vector
    model TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS chat_turns_fts USING fts5(
    user_text, assistant_text, content='chat_turns', content_rowid='rowid'
  );
  ```
- **Service:** `chat-service/src/services/turn-search.ts` — combines FTS + embedding similarity.
- **Embedding worker:** `chat-service/src/services/embedding-worker.ts` — polls unprocessed turns, calls local embedding model (e.g. all-MiniLM via Node bindings or fallback hash-based TF-IDF for Q1).
- **Route:** extend existing `/api/chat/sessions` to accept `q` + `gameId`.
- **UI:** `src/pages/Chat/components/chat-history-rail.tsx` — add search input + result list.

### Data flow
```
new turn ─► chat-store insert ─► fts5 trigger updates index
                              ↘ embedding-worker queue
worker tick ─► embed text ─► insert chat_turn_embeddings
search request ─► fts5 hits ∪ top-k embedding cosine ─► merge + rank ─► sessions
```

## Related Code Files

### Existing infra
| Capability | Path | Use |
|---|---|---|
| Sessions schema | `chat-service/src/db/schema.sql` | Add embeddings + fts tables |
| Chat store | `chat-service/src/db/chat-store.ts` | Hook turn insert → fts update + queue |
| Sessions list endpoint | `chat-service` routes (locate `/api/chat/sessions`) | Add q + gameId params |
| History rail | `src/pages/Chat/components/chat-history-rail.tsx` | UI surface |
| Sessions hook | `src/pages/Chat/hooks/use-chat-sessions-list.ts` | Accept search param |

### Create
- `chat-service/src/db/embedding-migrate.ts`
- `chat-service/src/services/turn-search.ts`
- `chat-service/src/services/embedding-worker.ts`
- `chat-service/src/services/embedding-model.ts` (local model wrapper)
- `chat-service/src/services/__tests__/turn-search.test.ts`
- `src/pages/Chat/components/history-search-input.tsx`

### Modify
- `chat-service/src/db/schema.sql` (add embedding + fts tables + triggers)
- `chat-service/src/db/chat-store.ts` (queue embedding on insert)
- Sessions list route (search params)
- `src/pages/Chat/hooks/use-chat-sessions-list.ts` (pass q)
- `src/pages/Chat/components/chat-history-rail.tsx` (search input)

### Delete
- None.

## Implementation Steps
1. Decide embedding model. Recommend: TF-IDF / hashing trick for Q1 (zero external dep), pluggable to a real model in Q2. Confirm with user.
2. Schema additions + migrate.
3. Add fts5 triggers on `chat_turns` insert/update/delete.
4. Embedding worker (cron 30s or in-process queue).
5. `turn-search.ts` — query FTS, rank, optionally re-rank with embedding similarity.
6. Extend route + hook for `q`/`gameId`.
7. Build `history-search-input.tsx`; wire to rail.
8. Backfill embeddings for existing turns (one-shot script).
9. Tests: insert turn → FTS hit; embedding present after worker tick; search ranks recent + relevant.

## Todo List
- [ ] Embedding model decision
- [ ] Schema + migrate (FTS + embeddings)
- [ ] Embedding worker
- [ ] `turn-search.ts`
- [ ] Route + hook extension
- [ ] Search UI in rail
- [ ] Backfill script
- [ ] Tests

## Success Criteria
- ≥30% of sessions reference history (M3 target — measured via "Resume from history" action in audit).
- Search returns relevant turn within top-5 for QA query set (precision@5 ≥0.7).
- Search latency <300ms p95.

## Risk Assessment
| Risk | L | I | Mitigation |
|---|---|---|---|
| Embedding worker falls behind | Med | Med | Queue size monitor; backfill resumes after restart. |
| FTS triggers slow inserts | Low | Med | Benchmark; switch to manual update on commit batch if needed. |
| Cross-game leakage in search | Med | High | All queries enforce `(owner_id, game_id)` filter; integration test. |
| Embedding model size bloat | Low | Med | TF-IDF / hashing first; defer real model. |

## Security Considerations
- **PII boundary:** session content includes user prompts (may contain sensitive segments names). All search queries filtered by `owner_id` + `game_id` server-side. **Never** trust client-supplied owner.
- Embeddings stored as BLOB; deleted on `chat_sessions` cascade.
- Backfill script logs zero turn content.

## Next Steps
- Blocked by: phase-05 not required (independent DB).
- Blocks: phase-11 (glossary memory may reuse embedding infra), phase-13 (recents rail consumes session list).

## Rollback
Drop new tables + worker; sessions list reverts to existing behaviour. Existing sessions intact.
