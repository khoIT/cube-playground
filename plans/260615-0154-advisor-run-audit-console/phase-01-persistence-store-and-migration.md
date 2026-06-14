# Phase 01 — Persistence store + migration 055 + RunRecorder interface

## Overview
- **Priority:** P0. **Status:** ✅ Done. **Depends on:** —
- Add durable SQLite storage for advisor agent runs and a `RunRecorder` seam the runtime calls (no-op in tests). Mirrors `command-center-draft-store.ts` + `src/db/sqlite.ts` migration pattern.

## Architecture
Four tables in `segments.db` (migration `055-advisor-agent-run-audit.sql`):

- **`advisor_agent_run`** (one row per session): `session_id` PK, `game_id`, `segment_id`, `scope_kind`, `goal`, `mode` (first), `owner`, `model`, `turn_count`, `total_cost_usd`, `final_stop_reason`, `had_error` (0/1), `created_at`, `last_active_at` (epoch ms ints).
- **`advisor_agent_turn`**: `id` PK autoinc, `session_id` (idx, FK), `turn_index`, `mode`, `message` (operator prompt), `narration` (assistant text), `tool_call_count`, `stop_reason`, `abort_cause`, `cost_usd` (turn delta), `started_at`, `ended_at`, `duration_ms`.
- **`advisor_tool_call`**: `id` PK, `session_id` (idx), `turn_id` (idx, FK), `call_id`, `tool` (idx), `seq`, `input_json`, `output_digest`, `state` (`ok`|`failed`|`denied`), `error_message`, `started_at`, `ended_at`, `duration_ms`.
- **`advisor_event_log`** (append-only SSE replay): `id` PK, `session_id` (idx), `turn_index`, `event_index`, `event_type`, `event_json`, `ts`.

Indices: `session_id` on turn/tool_call/event; `created_at` on run (for prune + list ordering); `tool` on tool_call (for slow-tool grouping).

## Related code files
**Create:**
- `server/src/db/migrations/055-advisor-agent-run-audit.sql` — the four tables + indices.
- `server/src/advisor/agent/advisor-run-store.ts` — typed read/write API over the tables. **Lives in agent dir → must pass no-PII surface guard** (no PII column tokens). Exports:
  - `recordRun(run)` (idempotent upsert by session_id, bumps turn_count/cost/last_active_at).
  - `recordTurn(turn) → turnId`, `recordToolCalls(turnId, calls[])`, `recordEvents(events[])`.
  - `listRuns(filter) → RunSummary[]` (filter: game, goal, owner, stopReason, q, limit).
  - `getRunDetail(sessionId) → { run, turns: TurnWithToolCalls[] }`.
  - `listEvents(sessionId, { turnIndex?, cursor, limit }) → { events, nextCursor }`.
  - `pruneOlderThan(cutoffMs)` (cascade delete run + turns + tool_calls + events).
- `server/src/advisor/agent/run-recorder.ts` — `RunRecorder` interface + `sqliteRunRecorder` (delegates to store) + `noopRunRecorder` (tests). A turn-scoped buffer collects events/tool-calls during a turn, flushed atomically at turn end (single better-sqlite3 transaction).

**Modify:** none in this phase (wiring is Phase 02).

## Implementation steps
1. Write migration 055 (epoch-ms INTEGER timestamps; `FOREIGN KEY ... ON DELETE CASCADE`; `foreign_keys=ON` already pragma'd).
2. Write `advisor-run-store.ts` using `getDb()` + prepared statements; wrap multi-table turn flush in `db.transaction(...)`.
3. Write `run-recorder.ts` (interface + sqlite + noop impls).
4. Add `pruneOlderThan` + call it once on first store use (lazy, guarded) using `ADVISOR_AUDIT_RETENTION_DAYS` (default 30).

## Todo
- [ ] migration 055 (4 tables + indices + cascade)
- [ ] `advisor-run-store.ts` (write + read + prune APIs)
- [ ] `run-recorder.ts` (interface + sqlite + noop)
- [ ] retention prune wired to store init
- [ ] unit tests: persist run/turn/tool_call/event → read back; prune drops old + cascades; PII-free input/output stored

## Success criteria
- Round-trip: write a run with 2 turns, 5 tool calls (one `failed` with error + duration), 12 events → `getRunDetail` + `listEvents` return them intact.
- `pruneOlderThan` deletes a run older than cutoff and all its child rows; keeps newer.
- `advisor-run-store.ts` passes `advisor-agent-no-pii-surface.test.ts`.

## Risks
| Risk | Mitigation |
|---|---|
| Migration applied by file COUNT (`user_version`) — a checkout missing 055 mis-counts | Standard pattern already used through 054; 055 sorts last, picked up as pending. Test on `:memory:` via `setDb`. |
| Storing tool inputs could leak PII | Inputs are agent-issued query specs on the allowlist; store **post-redaction** outputs; no-PII test guards the file. |
| Write volume per turn | Batch tool-calls + events in one transaction at turn end, not per-event. |

## Security
- No member PII persisted — allowlist only (user_id + numeric + reachability), post-redaction outputs.
- Store module carries no PII column tokens (enforced by existing static guard).
