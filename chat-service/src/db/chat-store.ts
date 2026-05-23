/**
 * CRUD facade over the chat SQLite database.
 * All methods are synchronous (better-sqlite3 is sync by design).
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { ChatSessionRow, ChatTurnRow, QueryArtifact } from '../types.js';

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function createSession(
  db: Database.Database,
  params: { ownerId: string; gameId: string; title?: string },
): ChatSessionRow {
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO chat_sessions (id, owner_id, game_id, title, created_at, status)
     VALUES (?, ?, ?, ?, ?, 'active')`,
  ).run(id, params.ownerId, params.gameId, params.title ?? null, now);
  return getSession(db, id)!;
}

export function getSession(
  db: Database.Database,
  id: string,
): ChatSessionRow | null {
  return (
    (db
      .prepare('SELECT * FROM chat_sessions WHERE id = ?')
      .get(id) as ChatSessionRow | undefined) ?? null
  );
}

export function listSessions(
  db: Database.Database,
  params: { ownerId: string; gameId: string; limit?: number },
): ChatSessionRow[] {
  const limit = params.limit ?? 20;
  return db
    .prepare(
      `SELECT * FROM chat_sessions
       WHERE owner_id = ? AND game_id = ? AND status != 'archived'
       ORDER BY last_turn_at DESC, created_at DESC
       LIMIT ?`,
    )
    .all(params.ownerId, params.gameId, limit) as ChatSessionRow[];
}

export function archiveSession(db: Database.Database, id: string): void {
  db.prepare(`UPDATE chat_sessions SET status = 'archived' WHERE id = ?`).run(id);
}

export function updateSessionTitle(
  db: Database.Database,
  id: string,
  title: string,
): void {
  db.prepare('UPDATE chat_sessions SET title = ? WHERE id = ?').run(title, id);
}

export function incrementTurnCount(
  db: Database.Database,
  id: string,
  inputTokens: number,
  outputTokens: number,
): void {
  db.prepare(
    `UPDATE chat_sessions
     SET turn_count = turn_count + 1,
         last_turn_at = ?,
         total_input_tokens = total_input_tokens + ?,
         total_output_tokens = total_output_tokens + ?
     WHERE id = ?`,
  ).run(Date.now(), inputTokens, outputTokens, id);
}

// ---------------------------------------------------------------------------
// Turns
// ---------------------------------------------------------------------------

export interface AppendTurnParams {
  sessionId: string;
  turnIndex: number;
  role: 'user' | 'assistant';
  userText?: string;
  assistantText?: string;
  reasoningJson?: string;
  toolCallsJson?: string;
  artifacts?: QueryArtifact[];
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  skill?: string;
  startedAt: number;
  endedAt?: number;
}

export function appendTurn(
  db: Database.Database,
  params: AppendTurnParams,
): ChatTurnRow {
  const id = uuidv4();
  const artifactsJson = params.artifacts ? JSON.stringify(params.artifacts) : null;

  db.prepare(
    `INSERT INTO chat_turns
       (id, session_id, turn_index, role, user_text, assistant_text,
        reasoning_json, tool_calls_json, artifacts_json,
        input_tokens, output_tokens, cost_usd, skill, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    params.sessionId,
    params.turnIndex,
    params.role,
    params.userText ?? null,
    params.assistantText ?? null,
    params.reasoningJson ?? null,
    params.toolCallsJson ?? null,
    artifactsJson,
    params.inputTokens ?? null,
    params.outputTokens ?? null,
    params.costUsd ?? null,
    params.skill ?? null,
    params.startedAt,
    params.endedAt ?? null,
  );

  return listTurns(db, params.sessionId).find((t) => t.id === id)!;
}

export function listTurns(
  db: Database.Database,
  sessionId: string,
): ChatTurnRow[] {
  return db
    .prepare(
      'SELECT * FROM chat_turns WHERE session_id = ? ORDER BY turn_index ASC',
    )
    .all(sessionId) as ChatTurnRow[];
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

export function insertAudit(
  db: Database.Database,
  params: {
    sessionId?: string;
    turnId?: string;
    kind: 'llm_call' | 'tool_call' | 'error';
    detail: unknown;
  },
): void {
  db.prepare(
    `INSERT INTO chat_audit (session_id, turn_id, kind, detail_json, at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    params.sessionId ?? null,
    params.turnId ?? null,
    params.kind,
    JSON.stringify(params.detail),
    Date.now(),
  );
}
