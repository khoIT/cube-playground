# Phase 01 — DB Migrations + chat_turns Columns

## Context Links
- Reports path: `/Users/lap16299/Documents/code/cube-playground/plans/reports/`
- Existing schema: `chat-service/src/db/schema.sql:1-61`
- Migration runner: `chat-service/src/db/migrate.ts:26-39` (idempotent ALTER + monitoring migrator pattern)
- Sibling phase-driven migrator: `chat-service/src/db/monitoring-migrate.ts:10-34`

## Overview
- **Priority:** P0 — blocks every other phase.
- **Status:** done
- **Brief:** Add three new tables (`llm_calls`, `tool_invocations`, `sdk_events`) and three additive columns to `chat_turns` (`system_prompt_text`, `model`, `skill` already exists per existing schema — verify). All ON DELETE CASCADE from `chat_turns`. Idempotent migrator, runs on boot.

## Key Insights
- Existing migration pattern: phase-scoped helper file (`monitoring-migrate.ts`) wired into `migrate()` in fixed order. New helper `observability-migrate.ts` follows the same shape — DO NOT inline into `schema.sql`. Reason: phase-bounded ownership, easy revert.
- `chat_turns` already has `skill TEXT` (schema.sql:36) — only `system_prompt_text` and `model` are net-new.
- Idempotent column add idiom already exists at `migrate.ts:16-24` (`addColumnIfMissing`). Reuse.
- FK cascade requires `PRAGMA foreign_keys = ON` — already set at `migrate.ts:49`.

## Requirements

### Functional
- New table `llm_calls(id, turn_id, step_index, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, cost_usd, latency_ms, started_at, ended_at, content_json, stop_reason)`.
- New table `tool_invocations(id, turn_id, tool_use_id, name, args_json, result_summary, ok, latency_ms, started_at, ended_at)`.
- New table `sdk_events(id, turn_id, seq, type, payload_json, at)` — ordered firehose.
- UNIQUE `(turn_id, step_index)` on `llm_calls` for idempotent recorder writes.
- UNIQUE `(turn_id, tool_use_id)` on `tool_invocations`.
- Index `(turn_id, seq)` on `sdk_events`.
- All three FK to `chat_turns(id)` ON DELETE CASCADE.
- ALTER `chat_turns` ADD COLUMN `system_prompt_text TEXT`, `model TEXT` — both nullable for backfill compat.

### Non-functional
- Migration runtime < 50 ms on existing dev DB (no row backfill needed).
- Idempotent: running twice = no-op, no errors.
- Schema file diff is additive; legacy reads of `chat_turns` (e.g. `chat-store.ts:197`) unaffected because `SELECT *` tolerates new nullable columns.

## Architecture

### Data flow
```
boot → openDatabase() → migrate() → schema.sql(exec) → addColumnIfMissing(chat_turns) → migrateMonitoring() → migrateObservability() ← NEW
```

### Tables
| Table | PK | FK | Notes |
|---|---|---|---|
| `llm_calls` | `id TEXT` (uuid) | `turn_id → chat_turns.id CASCADE` | UNIQUE(turn_id, step_index) |
| `tool_invocations` | `id TEXT` | `turn_id → chat_turns.id CASCADE` | UNIQUE(turn_id, tool_use_id) |
| `sdk_events` | `id INTEGER AUTOINCREMENT` | `turn_id → chat_turns.id CASCADE` | INDEX(turn_id, seq) |

## Related Code Files

### Create
- `chat-service/src/db/observability-migrate.ts` (~60 LOC)

### Modify
- `chat-service/src/db/migrate.ts` — add `migrateObservability(db)` call after `migrateMonitoring(db)` and two `addColumnIfMissing` calls for chat_turns.
- `chat-service/src/types.ts` — append `LlmCallRow`, `ToolInvocationRow`, `SdkEventRow` interfaces.

### Delete
- None.

## Implementation Steps
1. Create `observability-migrate.ts` exporting `migrateObservability(db)` with `CREATE TABLE IF NOT EXISTS` for all three tables + indexes + uniques.
2. In `migrate.ts`: after the existing `addColumnIfMissing` calls and `migrateMonitoring(db)` line, add:
   - `addColumnIfMissing(db, 'ALTER TABLE chat_turns ADD COLUMN system_prompt_text TEXT;')`
   - `addColumnIfMissing(db, 'ALTER TABLE chat_turns ADD COLUMN model TEXT;')`
   - `migrateObservability(db);`
3. Add type rows to `types.ts` (synchronous with column shapes; nullable where the DDL allows).
4. Boot chat-service locally; verify SQLite `.schema` shows new tables.
5. Re-boot to confirm idempotency (no errors).

## Todo List
- [x] Create `observability-migrate.ts`
- [x] Wire into `migrate.ts`
- [x] Add column adds for `chat_turns`
- [x] Append row types to `types.ts`
- [x] Boot + verify schema (tsc + vitest confirm migration runs clean on in-memory SQLite)
- [x] Boot twice — confirm idempotent (addColumnIfMissing pattern, CREATE TABLE IF NOT EXISTS)

## Success Criteria
- `sqlite3 runtime/chat.db .schema` shows all three new tables and the two new columns.
- Second boot prints no migration errors.
- `SELECT * FROM chat_turns LIMIT 1` from existing reader code still returns rows (no FE break).
- File LOC: `observability-migrate.ts` ≤ 80, `migrate.ts` ≤ 60 after edits.

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Forgetting `ON DELETE CASCADE` → orphan rows after session delete | M | M | Test: create turn → insert llm_call → `deleteSession` → assert llm_call row gone. |
| `foreign_keys` pragma silently off (e.g. test fixture) | L | H | Migrator does not touch the pragma — `openDatabase` sets it. Add a guard test that asserts the pragma. |
| Reusing `tool_use_id` across SDK retries collides on UNIQUE | L | M | UNIQUE on `(turn_id, tool_use_id)` — only collides within same turn, which is correct semantically. |
| Adding a column on a large existing chat.db locks the DB | L | L | dev-only DB, small (~hundreds of rows); SQLite ALTER ADD COLUMN is O(1) metadata. |

## Security Considerations
- `llm_calls.content_json` may carry user PII (the user's message echoed in the assistant context). Owner-scoping is enforced at the read API layer (phase 06), not here — but the DB itself stays in the same `runtime/chat.db` already containing the same data via `chat_turns`. No new exposure surface.
- `chat_turns.system_prompt_text` contains the composed system prompt with skill instructions. Treat as internal-only (already true for `reasoning_json`).

## Next Steps
- Phase 02 (observer contract) needs `LlmCallRow`/`ToolInvocationRow` types from `types.ts`.
- Phase 03 (recorder) consumes these tables.
- Phase 06 (debug API) reads these tables.
