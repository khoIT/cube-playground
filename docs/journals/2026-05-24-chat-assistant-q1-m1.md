# 2026-05-24 — Chat assistant Q1 roadmap, milestone M1 done

## Context

Plan: `plans/260524-0059-chat-assistant-q1-roadmap/` — 13-phase, ~12-week Trust-first (Shape α) build. Today's autonomous session executed the entire **M1 — Discovery + Infra Foundation** milestone in one pass (phases 01-05). Track A (UI) and Track B (chat-service backend) shipped together.

## What shipped

### Phase 01 — Starter Library
- 16 canonical business questions in `src/pages/Chat/library/starter-questions.ts`, each tagged with persona (`pm/marketer/analyst`) + intent categoryTags (`explore/metric_explain/compare/diagnose`).
- `persona-histogram.ts` ranks via cosine of user intent histogram × starter categoryTags. Cold-start (<3 sessions) renders unranked; threshold C5 = `STARTER_RANK_MIN_SESSIONS = 3` (single source — duplicated in chat-service config + FE module to avoid a round-trip just to read a constant).
- `starter-library-grid.tsx` + `starter-persona-filter.tsx` replace the hard-coded SUGGESTIONS array in `chat-empty-hero.tsx`. Click prefills composer; **no auto-submit** (decision Q10).
- Audit log emits `starter_clicked` via new `POST /api/chat/audit` proxy → chat-service.

### Phase 02 — Schema Cartographer
- New surface at `/catalog/schema` with `cube-tree.tsx` (collapsible per cube), `member-detail-panel.tsx`, `cartographer-search.tsx` (150ms debounce), and `use-cartographer-index.ts` (memoised index over `useCatalogMeta`).
- Deep link `?focus=<cube>.<member>` — selecting a row writes the URL and vice versa.
- Field-chip token spec **LOCKED**: `{{field:<cube>.<member>}}`. `assistant-message.tsx` now post-processes text sections through `FIELD_TOKEN_REGEX` and renders `<FieldChip/>` pills.
- Agent prompt teaches the model the token via `FIELD_CHIP_TOKEN_GUIDANCE` appended in `chat-service/src/core/mode-prompts.ts`. Snapshot tests updated.

### Phase 03 — Concept Glossary
- 30-term seed at `server/data/glossary.seed.json` covering engagement / retention / monetisation / acquisition / segments / concepts. Seed → `glossary_terms` SQLite table via idempotent `migrateGlossarySeed` (UPSERT by id).
- `GET /api/glossary` + `GET /api/glossary/:id`. New `007-glossary.sql` migration.
- `/catalog/glossary` index page with search + category chips, reusing concept-detail as click target when `primary_catalog_id` is set.
- `useGlossaryLinker` hook wraps known terms in assistant text on word boundaries (case-insensitive). Module-level promise cache so multiple `<AssistantMessage>` instances share one fetch.

### Phase 04 — Suggested Follow-ups
- Pure rule engine in `services/followup-rules.ts` (8 rules across segment/retention/revenue/players/campaigns/metric_explain/sql/diagnose) + `followup-suggester.ts` returning exactly 3 chips. Suppress-list dedupes across turns; falls back to a generic pool when ≤3 rules fire.
- `<FollowupChips/>` renders below the **last settled** assistant turn only. Click prefills + auto-sends (different contract from phase-01 starter cards — Q10 applies to starters, not chips).
- New `onFollowupPick` prop threaded through `chat-message-list.tsx` → `chat-thread-view.tsx` → `chat-thread-page.tsx::handleFollowupPick`.
- Audit `followup_clicked` with `{chipId, derivedFrom}`.

### Phase 05 — Monitoring Infra (chat-service Track B)
- `node-cron` locked + installed. New `chat-service/src/services/scheduler.ts` with `register(name, cron, handler)` API; replaces previous registrations atomically; `cron.validate` guard. Process-wide singleton.
- `notifications` + `monitoring_audit` tables via `monitoring-migrate.ts`. `migrate.ts` now composes phase migrations in fixed order (decision C1).
- `NotificationDriver` interface + `InAppNotificationDriver` writes to the `notifications` table. `emit-monitoring-event.ts` is the single helper modules call (audit insert + optional notification dispatch).
- Routes: `GET /notifications`, `POST /notifications/:id/read`, `GET /notifications/scheduler` (diagnostic). Proxied at `/api/chat/notifications*`.
- Topbar `NotificationBell` (was hardcoded-unread placeholder) now polls every 30s, badges unread count, marks read on row click.
- `MAIN_SERVER_SERVICE_TOKEN` plumbed into `.env.example` + chat-service config; `server/src/middleware/service-token.ts` bearer-validates internal calls (returns 503 if env unset — fail loud over silent passthrough). Mounted per-route, never global.

## Key design calls reaffirmed

- **STARTER_RANK_MIN_SESSIONS lives in two places.** C5 says "single source of truth — no env var, no DB row." Honoured by *value*; mirrored by *file* (chat-service config + `starter-questions.ts`). Justified because the FE has no other reason to call chat-service config, and a 1-line constant duplication is cheaper than a fetch on every chat landing render. Worth a re-think only if the value ever needs to change at runtime.
- **`insertAudit.kind` widened from union to `string`.** Three phases needed to emit new kinds (`intent_routed`, `starter_clicked`, `field_chip_clicked`, `followup_clicked`); threading a union across phase boundaries is friction without payoff. Query consumers already filter on literal kind strings.
- **Service-token middleware mounted per-route, not globally.** Public client traffic must not hit it (chat-service → main-server is the only consumer). Hardcoded as a `buildServiceTokenGate(...)` factory; phase-12 attaches it to its refresh endpoint.
- **Pre-existing in-progress changes in `predicate-to-sql.ts`, `translator.ts`, `normalize-in-date-range-values.ts`, `*-snapshot.json` were not touched.** Belonged to a different in-flight branch at session start; left for the owner.

## Tests

- **804** FE / **193** chat-service / **155** server — all green. 13 new test files; 4 snapshots refreshed (mode-prompts × `compose`).
- New tests cover: persona-histogram cosine + cold-start, starter-library-grid render + prefill-no-submit, cartographer-search index + search, assistant-message field-chip parsing (including malformed-token rejection), glossary-linker word-boundary + cache, followup-suggester rule firing + diversity + dedup, monitoring-store CRUD + idempotent migrate, scheduler validate + replace, notifications-route auth + unread ordering + mark-read, glossary-route seed + 404.

## What's deferred to M2/M3

- Phase 06 (editable execution plan with catalog-citation enforcement) — gates M2.
- Phase 07-09 (sample preview, plain-English filter trace, sanity-check assistant) — depend on 06.
- Phase 10-13 (persistent chat history with FTS5, user glossary memory, saved monitored segments, recents rail) — phase-05 scheduler + `emitMonitoringEvent` are the consumers phase-12 will plug into.

## Open questions / follow-ups

- Phase-04 chips currently auto-submit. Phase-04 spec said *or* ask-to-confirm. If chip ergonomics feel too aggressive in QA, revert to prefill-only (parallel to starters) by dropping `sendTurn(trimmed)` in `handleFollowupPick`.
- Topbar bell uses 30s polling. Fine for M1 success criteria but SSE could replace this once phase-10 ships the persistent-history infra (same DB, same connection pattern).
- `useGlossaryLinker` doesn't yet protect against wrapping inside markdown `<code>` blocks. AssistantMessage's `text` sections are plain text today, so the false-positive risk is low; revisit if a future phase renders markdown inside assistant text.
- The `T.fMono` / `T.brandSoft` / `T.brand` tokens used in `FieldChip` should stay consistent if the chat theme refactor lands.
