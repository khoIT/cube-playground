# Cascading Decisions Applied — Q1 Chat-Assistant Plan

Date: 2026-05-24
Plan: `plans/260524-0059-chat-assistant-q1-roadmap/`
Scope: surgical edits applying decisions C1–C5. No new phases. No renumbering.

## Decisions locked

| # | Decision |
|---|---|
| C1 | Single migrate driver `chat-service/src/db/migrate.ts` invoking each phase's `migrateXxx(db)` in fixed order. Idempotent. |
| C2 | Shared service token `MAIN_SERVER_SERVICE_TOKEN` for chat-service → main-server auth via bearer header. |
| C3 | Reactive 404-catch on refresh tick: mark `last_status='segment_deleted'`, one final notification, ticks skip via index filter. No webhook. |
| C4 | `node-cron` (LOCKED) — added to chat-service deps. |
| C5 | Cold-start threshold = config constant `STARTER_RANK_MIN_SESSIONS = 3` in `chat-service/src/config.ts`. |

## Per-phase changes

### plan.md
- Appended rows C1–C5 to "Resolved decisions" table (after Q10).
- Same `#, Question, Decision, Affected phase(s)` column format preserved.

### phase-01-discovery-starter-library.md (C5)
- Added sub-bullet under persona-histogram step: cold-start threshold sourced from `chat-service/src/config.ts` constant `STARTER_RANK_MIN_SESSIONS = 3`. Single source; no env var, no DB row.

### phase-05-monitoring-infra.md (C1, C2, C4)
- **Key Insights:** added 3 bullets (migration driver C1, service-token auth C2, node-cron lock C4).
- **Create:** added `chat-service/src/db/migrate.ts` (single driver).
- **Modify:** added `server/src/middleware/` for service-token validator middleware (reused by phase-12).
- **Implementation Steps:** added step 10 (implement migrate driver) and step 11 (add `MAIN_SERVER_SERVICE_TOKEN` to both `.env.example` files + middleware that validates header + reads `X-Owner-Id`).

### phase-12-saved-monitored-segments.md (C2, C3)
- **Key Insights:** added 2 bullets (bearer-token auth C2, 404-catch ref-drift policy C3).
- **Architecture > Services + routes:** added refresher-on-404 behavior (mark `last_status='segment_deleted'`, audit `monitor_orphaned`, notification `kind='segment_deleted'`, preserve row); `listDueMonitored()` filter `WHERE last_status IS NULL OR last_status NOT IN ('segment_deleted')`.
- **Data flow:** replaced HTTP refresh lines — now includes Authorization header, 200/404 branches.
- **Risks:** replaced cross-DB drift row with reactive 404-handling row.
- **Implementation Steps:** added step 9 — refresher on 404 sets status + emits deletion notification once.

## Verification
All edits applied via Edit tool against verified `old_string` matches from the live files. No surrounding context altered beyond the listed bullets/rows/steps.

## Unresolved questions
None.
