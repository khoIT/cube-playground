/**
 * Raw SQL CRUD helpers for the observability tables:
 * `llm_calls`, `tool_invocations`, `sdk_events`.
 *
 * Mirrors the pattern established in chat-store.ts — prepared statements,
 * synchronous better-sqlite3, no ORM. Used by LlmTraceRecorder (writes) and
 * the phase-06 debug API (reads).
 */

import type Database from 'better-sqlite3';
import type { LlmCallRow, ToolInvocationRow, SdkEventRow, PermissionDecisionRow } from '../types.js';

// ---------------------------------------------------------------------------
// Truncation util
// ---------------------------------------------------------------------------

const TRUNCATION_MARKER = ' [truncated]';

/**
 * Truncate a string to `maxBytes` UTF-16 code units and append a marker when
 * it was cut. JSON-stringifies non-string values first; null returns null.
 */
export function truncate(value: unknown, maxBytes: number): string | null {
  if (value === null || value === undefined) return null;
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  if (str.length <= maxBytes) return str;
  const cut = str.slice(0, maxBytes - TRUNCATION_MARKER.length);
  return cut + TRUNCATION_MARKER;
}

// ---------------------------------------------------------------------------
// Insert helpers
// ---------------------------------------------------------------------------

/**
 * INSERT OR IGNORE — idempotent on UNIQUE(turn_id, step_index).
 * A replay of the same step is silently ignored (not an error).
 */
export function insertLlmCall(db: Database.Database, row: LlmCallRow): void {
  db.prepare(
    `INSERT OR IGNORE INTO llm_calls
       (id, turn_id, step_index, model, input_tokens, output_tokens,
        cache_creation_tokens, cache_read_tokens, cost_usd, latency_ms,
        started_at, ended_at, content_json, stop_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.turn_id,
    row.step_index,
    row.model ?? null,
    row.input_tokens ?? null,
    row.output_tokens ?? null,
    row.cache_creation_tokens ?? null,
    row.cache_read_tokens ?? null,
    row.cost_usd ?? null,
    row.latency_ms ?? null,
    row.started_at ?? null,
    row.ended_at ?? null,
    row.content_json ?? null,
    row.stop_reason ?? null,
  );
}

/**
 * INSERT OR IGNORE — idempotent on UNIQUE(turn_id, tool_use_id).
 */
export function insertToolInvocation(
  db: Database.Database,
  row: ToolInvocationRow,
): void {
  db.prepare(
    `INSERT OR IGNORE INTO tool_invocations
       (id, turn_id, tool_use_id, name, args_json, result_summary,
        ok, latency_ms, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.turn_id,
    row.tool_use_id,
    row.name,
    row.args_json ?? null,
    row.result_summary ?? null,
    row.ok,
    row.latency_ms ?? null,
    row.started_at ?? null,
    row.ended_at ?? null,
  );
}

/**
 * Plain INSERT — sdk_events is append-only (AUTOINCREMENT id, no idempotency).
 * Duplicate SDK messages (e.g. from retries) are recorded as signal, not noise.
 */
export function insertSdkEvent(db: Database.Database, row: Omit<SdkEventRow, 'id'>): void {
  db.prepare(
    `INSERT INTO sdk_events (turn_id, seq, type, payload_json, at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    row.turn_id,
    row.seq,
    row.type,
    row.payload_json ?? null,
    row.at,
  );
}

// ---------------------------------------------------------------------------
// Phase-02: permission_decisions + chat_turns.stop_reason
// ---------------------------------------------------------------------------

/**
 * INSERT OR IGNORE — idempotent on PRIMARY KEY `id`.
 * Caller provides the UUID to allow replay-safe buffered recorder.
 * Reason is truncated to 4 KB to mirror result_summary cap.
 */
export function insertPermissionDecision(
  db: Database.Database,
  row: PermissionDecisionRow,
): void {
  const CAP_4K = 4 * 1024;
  db.prepare(
    `INSERT OR IGNORE INTO permission_decisions (id, turn_id, tool_name, decision, reason, at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.turn_id,
    row.tool_name,
    row.decision,
    row.reason ? row.reason.slice(0, CAP_4K) : null,
    row.at,
  );
}

/**
 * Returns all permission_decisions rows for a turn, ordered by `at` ascending.
 */
export function listPermissionDecisionsByTurn(
  db: Database.Database,
  turnId: string,
): PermissionDecisionRow[] {
  return db
    .prepare('SELECT * FROM permission_decisions WHERE turn_id = ? ORDER BY at ASC')
    .all(turnId) as PermissionDecisionRow[];
}

/**
 * UPDATE chat_turns.stop_reason for an existing assistant turn row.
 * No-op if the turn doesn't exist or stop_reason is null.
 */
export function updateTurnStopReason(
  db: Database.Database,
  turnId: string,
  stopReason: string | null,
): void {
  if (stopReason === null) return;
  db.prepare('UPDATE chat_turns SET stop_reason = ? WHERE id = ?').run(stopReason, turnId);
}

// ---------------------------------------------------------------------------
// Read helpers (used by phase-06 debug API)
// ---------------------------------------------------------------------------

export function listLlmCallsByTurn(
  db: Database.Database,
  turnId: string,
): LlmCallRow[] {
  return db
    .prepare(
      'SELECT * FROM llm_calls WHERE turn_id = ? ORDER BY step_index ASC',
    )
    .all(turnId) as LlmCallRow[];
}

export function listToolInvocationsByTurn(
  db: Database.Database,
  turnId: string,
): ToolInvocationRow[] {
  return db
    .prepare(
      'SELECT * FROM tool_invocations WHERE turn_id = ? ORDER BY started_at ASC',
    )
    .all(turnId) as ToolInvocationRow[];
}

export interface SdkEventPage {
  rows: SdkEventRow[];
  nextCursor: number | null;
}

/**
 * Paginated read of sdk_events for a turn. `cursor` is the exclusive lower
 * bound on the autoincrement `id` (not seq). Returns `nextCursor = null` when
 * there are no more rows.
 */
export function listSdkEventsByTurn(
  db: Database.Database,
  turnId: string,
  opts: { cursor?: number; limit?: number } = {},
): SdkEventPage {
  const limit = opts.limit ?? 100;
  const cursor = opts.cursor ?? 0;
  const rows = db
    .prepare(
      `SELECT * FROM sdk_events
       WHERE turn_id = ? AND id > ?
       ORDER BY seq ASC
       LIMIT ?`,
    )
    .all(turnId, cursor, limit + 1) as SdkEventRow[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor = hasMore ? page[page.length - 1].id : null;
  return { rows: page, nextCursor };
}

// ---------------------------------------------------------------------------
// Phase-06 debug API helpers
// ---------------------------------------------------------------------------

export interface ObservabilityCountsByTurn {
  llm: number;
  tool: number;
  sdk: number;
}

/**
 * Returns row counts across all three observability tables for a given turn.
 * Returns zeroes when tables are empty (legacy install — no rows).
 */
export function countObservabilityRowsByTurn(
  db: Database.Database,
  turnId: string,
): ObservabilityCountsByTurn {
  const llm = (db.prepare('SELECT COUNT(*) AS n FROM llm_calls WHERE turn_id = ?').get(turnId) as { n: number }).n;
  const tool = (db.prepare('SELECT COUNT(*) AS n FROM tool_invocations WHERE turn_id = ?').get(turnId) as { n: number }).n;
  const sdk = (db.prepare('SELECT COUNT(*) AS n FROM sdk_events WHERE turn_id = ?').get(turnId) as { n: number }).n;
  return { llm, tool, sdk };
}

/**
 * Lists chat sessions for a given owner (and optional game/query filter).
 * Unlike `listSessions` in chat-store.ts, this does NOT exclude archived or
 * soft-deleted sessions so the debug UI can inspect all historical sessions
 * including those pending hard-purge.
 */
export function listSessionsForDebug(
  db: Database.Database,
  params: { ownerId: string; gameId?: string; q?: string; limit?: number },
): import('../types.js').ChatSessionRow[] {
  const limit = params.limit ?? 50;
  const q = params.q?.trim();

  const conditions: string[] = ['owner_id = ?'];
  const bindings: unknown[] = [params.ownerId];

  if (params.gameId) {
    conditions.push('game_id = ?');
    bindings.push(params.gameId);
  }

  if (q) {
    const safe = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    conditions.push(`title LIKE ? ESCAPE '\\'`);
    bindings.push(`%${safe}%`);
  }

  bindings.push(limit);

  // deleted_at IS intentionally NOT filtered here — debug UI shows all sessions.
  return db
    .prepare(
      `SELECT * FROM chat_sessions
       WHERE ${conditions.join(' AND ')}
       ORDER BY last_turn_at DESC, created_at DESC
       LIMIT ?`,
    )
    .all(...bindings) as import('../types.js').ChatSessionRow[];
}
