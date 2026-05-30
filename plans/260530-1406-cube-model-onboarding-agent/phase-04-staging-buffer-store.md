---
phase: 4
title: "Staging buffer store"
status: complete
priority: P1
effort: "5h"
dependencies: [3]
---

# Phase 4: Staging buffer store

## Overview
The approval gate. Generated draft models land in a new SQLite store with a status
lifecycle (`pending → accepted/rejected → written`). Nothing reaches cube-dev disk until a
reviewer approves. Mirrors the anomaly-state upsert + business-metric-audit patterns.

## Requirements
- Functional: persist a draft model (game, cube name, draft YAML/JSON, inference confidences, source); list drafts by game/status; transition status; append an audit row per transition; record who approved.
- Non-functional: append-only audit; ISO8601 timestamps; test-friendly `ts` injection.

## Architecture
<!-- Updated: Validation Session 1 — migration 022 confirmed (021-metric-drift-snapshot.sql shipped); generator≠approver -->
- **Migration `022-onboarding-draft-models.sql`** (drift-center's `021-metric-drift-snapshot.sql` is committed → 022 confirmed, no renumber needed). Store records both `created_by` and `approved_by`; the **generator ≠ approver** rule is enforced in the route (Phase 05), not the store — but the columns must support it (nullable `approved_by`, set on approval).
  - Table `onboarding_draft_models(id, game, cube_name, draft_json, profile_json, confidence_json, status, source, created_by, approved_by, created_at, updated_at)` — `UNIQUE(game, cube_name)` for idempotent re-generation; `status` CHECK enum `pending|accepted|rejected|written`; index `(game, status)`.
  - Reuse `016`/`020` audit-table style for a companion `onboarding_draft_audit` (append-only) OR fold transitions into the existing `business-metric-audit` style table — decide in step 1.
- New `server/src/services/onboarding-draft-store.ts`:
  - `upsertDraft(input, ts?)` — `INSERT ... ON CONFLICT(game,cube_name) DO UPDATE` (mirror `anomaly-state-store.ts:143-155`), preserving status if already accepted.
  - `listDrafts({game?, status?})`, `setDraftStatus(id, status, approvedBy, ts?)`, `getDraft(id)`.
- `getDb()` lazy access pattern (`server/src/db/sqlite.ts`); foreign keys already enabled at connection.

## Related Code Files
- Create: `server/src/db/migrations/022-onboarding-draft-models.sql`, `server/src/services/onboarding-draft-store.ts`.
- Read for context: `server/src/services/anomaly-state-store.ts:143-155` (upsert+status), `server/src/db/business-metric-audit-store.ts:72-102` (append-only audit), `server/src/db/sqlite.ts:52-68` (migration runner), `server/src/db/migrations/009-anomalies.sql` + `016-business-metric-audit.sql` (schema style).

## Implementation Steps
1. Decide audit table vs inline; write migration `022-…`.
2. Define `DraftModelRow` TS interface (snake→camel mapping).
3. Implement `upsertDraft` with status-preservation on conflict.
4. Implement `listDrafts`, `getDraft`, `setDraftStatus` (records `approved_by`).
5. Append audit row on every status transition.
6. ISO8601 timestamps + optional `ts` param for tests.

## Success Criteria
- [x] Migration applies cleanly on a fresh DB; `user_version` advances correctly.
- [x] Re-generating the same (game, cube) upserts without clobbering an `accepted` status.
- [x] Every status transition leaves an audit row.
- [x] No migration-number collision with drift-center (verify `git status` at landing).

## Risk Assessment
- **Migration collision with drift-center's 021** → claim 022; verify before deploy; renumber is trivial (rename file) since runner is filename-ordered.
- **Stale drafts vs evolving warehouse** → `updated_at` + re-profile on demand; freshness column deferred.
