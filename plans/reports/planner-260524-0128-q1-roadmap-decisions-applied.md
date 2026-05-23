# Planner — Q1 Chat Assistant Roadmap: 10 Locked Decisions Applied

**Plan:** `plans/260524-0059-chat-assistant-q1-roadmap/`
**Date:** 2026-05-24
**Scope:** Embed 10 locked decisions; no redesign.

## Decisions × phases touched

| # | Decision | Phases | Change |
|---|---|---|---|
| Q1 | Scheduler in chat-service (node-cron); HTTP-calls main server refresh endpoint | 05, 12 | Major rewrite. Scheduler relocated to `chat-service/src/services/scheduler.ts`. Refresh handler HTTP-POSTs `server /api/segments/:id/refresh`. Server `cron-runner.ts` no longer extended. |
| Q2 | Behavior-inferred persona via topic histogram; cold-start = all 16 starters | 01 | Replaced persona Q + manual picker with `persona-histogram.ts` cosine-ranking. Added `categoryTags` to starter schema. Removed "persona blocks shipping" risk. |
| Q3 | No cross-game memory transfer in Q1 (not even opt-in stub) | 11 | Key-insight bullet rewritten; scope reaffirmed; no schema change. |
| Q4 | F17 dropped from Q2 entirely; chat uses deeplink for CDP | plan.md | Removed F17 from deferred list; added parenthetical note. |
| Q5 | In-app toast only Q1; email/Slack deferred | 05 | Driver interface stays narrow; description updated. M1 status table phase-05 track relabeled "B — chat-service Backend". |
| Q6 | TF-IDF via SQLite FTS5 only; no embeddings | 10 | Dropped `chat_turn_embeddings` table, `embedding-worker.ts`, `embedding-model.ts`, backfill step, embedding-related risks. FTS5-only flow. Renamed migrate to `fts-migrate.ts`. |
| Q7 | All new tables in chat-service SQLite | 05, 10, 11, 12 | Phase-05 + phase-12 paths moved from `server/src/...` to `chat-service/src/...`. Phase-11 (already chat-service DB) confirmed. Phase-10 already chat-service DB. |
| Q8 | `{{field:cube.member}}` LOCKED | 02 | Removed "TBD"/"proposed" hedging in steps + risk; renamed todo item. |
| Q9 | New `monitored_segments` + `monitored_segment_runs` tables in chat-service DB; cross-DB foreign-ref by id | 12 | Replaced `segments` table extension with new tables. Schema matches spec (id, owner_id, game_id, segment_id, schedule_cron, last_run_at, last_status, created_at, updated_at). Added cross-DB drift risk row. |
| Q10 | Prefill composer only — NO auto-submit | 01 | Click behavior + step 7 + test assertion + todo updated. |

## plan.md changes
- "Open questions" section → "Resolved decisions" table (10 rows).
- Deferred list: F17 removed; parenthetical note added.
- M1 status table: phase-05 track → "B — chat-service Backend".

## Phase 01 (`phase-01-discovery-starter-library.md`)
- Decision: Q2 + Q10.
- Persona detection key-insight rewritten (behavior-inferred + cold-start).
- Functional requirements: click prefills (no auto-submit); cold-start vs ≥3-session ranking.
- Added `persona-histogram.ts` to Architecture.
- Implementation steps replaced (1–3 = histogram + tags + cosine ranking).
- Todo list updated; "persona blocks shipping" risk removed.

## Phase 02 (`phase-02-schema-cartographer.md`)
- Decision: Q8.
- Step 6: "TBD — propose" → "LOCKED".
- Risk row mitigation tightened.
- Todo renamed to call out token syntax.

## Phase 05 (`phase-05-monitoring-infra.md`) — MAJOR REWRITE
- Decision: Q1 + Q5 + Q7.
- Overview, Key Insights, Requirements, Architecture, Schema location comment, Data flow, Related Code Files, Implementation Steps, Todo, Risks, Next Steps, Rollback all rewritten for chat-service-owned scheduler + DB + routes + proxy passthrough.
- Server `cron-runner.ts` removed from "Existing infra".
- Routes namespaced `/api/chat/notifications` (proxied through server).

## Phase 10 (`phase-10-persistent-chat-history.md`)
- Decision: Q6.
- Removed: `chat_turn_embeddings`, `embedding-worker.ts`, `embedding-model.ts`, backfill step, embedding model decision, embedding-related risks, "Embeddings stored as BLOB" security note.
- Kept: FTS5 virtual table + triggers + `turn-search.ts` (FTS-only).
- Rollback simplified.

## Phase 11 (`phase-11-user-glossary-memory.md`)
- Decision: Q3.
- Key-insight bullet rewritten to lock per-user × per-game-only scope and explicitly bar opt-in stub for Q1.
- No schema/code change needed (already chat-service DB).

## Phase 12 (`phase-12-saved-monitored-segments.md`) — MAJOR REWRITE
- Decision: Q1 + Q7 + Q9.
- Overview, Key Insights, Requirements, Storage block, Architecture, Data flow, Related Code Files, Implementation Steps, Todo, Risks, Next Steps, Rollback all rewritten.
- New `monitored_segments` table schema matches Q9 spec exactly.
- Refresh: chat-service refresher HTTP-POSTs `server /api/segments/:id/refresh`.
- Routes namespaced `/api/chat/segments/:id/...` (proxied through server).
- Added "Cross-DB ref drift" risk row (segment deleted in segments.db).

## Unresolved cascading questions (surfaced during rewrite)

1. **Migration driver entry-point** — phase-05, phase-10, phase-11, phase-12 each add tables in chat-service DB. Spec recommends a single migrate driver. Where does it live (e.g. `chat-service/src/db/migrate.ts`) and how do phase-specific migrate files (`monitoring-migrate.ts`, `fts-migrate.ts`, `glossary-overrides-migrate.ts`, `monitored-segments-migrate.ts`) compose into it? Suggest: one bootstrap calls each migrate in order.
2. **Server proxy auth pass-through** — phase-05 + phase-12 add `/api/chat/...` proxy passthroughs in `server/src/routes/chat.ts`. Confirm existing chat proxy already forwards session/owner headers to chat-service — refresh-endpoint HTTP call in phase-12 also needs session creds; verify shared auth mechanism (cookie? header? internal token?).
3. **Cross-DB ref drift policy** — Q9 stores `segment_id` in chat-service DB with no FK to `segments.db`. On segment deletion in main server, what happens to monitored_segments row? Current spec: refresher marks inactive on 404. Confirm whether server should emit deletion event for chat-service to consume, OR chat-service is fine with reactive cleanup only.
4. **node-cron vs setInterval choice** — phase-05 recommends `node-cron`. Confirm this is acceptable (small dep) vs in-process `setInterval(60s)` (zero deps). Both work; node-cron gives per-handler schedule (e.g. daily at 09:00 user-local) which monitored-segments needs.
5. **Topic-histogram cold-start threshold** — phase-01 uses ≥3 sessions to flip from uniform to ranked. Where is the session count read from (`chat_sessions` count by owner)? And: is the 3-session threshold configurable or hard-coded?

**Status:** DONE
**Summary:** 10 locked decisions embedded across plan.md + 6 phase files (01, 02, 05, 10, 11, 12). Phases 05 + 12 fully rewritten; phases 01 + 10 partially rewritten; phases 02 + 11 surgical edits. No new phases, no renumbering, no backwards-compat shims.
**Concerns/Blockers:** 5 cascading questions surfaced (see above) — none block phase-by-phase implementation, but #1 (migration driver) should be answered before phase-05 coding starts.
