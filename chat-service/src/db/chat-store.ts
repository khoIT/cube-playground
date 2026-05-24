/**
 * CRUD facade over the chat SQLite database.
 * All methods are synchronous (better-sqlite3 is sync by design).
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type {
  ChatSessionRow,
  ChatTurnRow,
  QueryArtifact,
  ChartArtifact,
} from '../types.js';

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
  params: { ownerId: string; gameId: string; limit?: number; q?: string },
): ChatSessionRow[] {
  const limit = params.limit ?? 20;
  const q = params.q?.trim();
  if (q) {
    // Title-only LIKE search. Escape % _ in the user input to keep them literal.
    const safe = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const pattern = `%${safe}%`;
    return db
      .prepare(
        `SELECT * FROM chat_sessions
         WHERE owner_id = ? AND game_id = ? AND status != 'archived'
           AND title LIKE ? ESCAPE '\\'
         ORDER BY last_turn_at DESC, created_at DESC
         LIMIT ?`,
      )
      .all(params.ownerId, params.gameId, pattern, limit) as ChatSessionRow[];
  }
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

/** Create a session that is a continuation of a compacted parent session. */
export function createSessionWithParent(
  db: Database.Database,
  params: { ownerId: string; gameId: string; title?: string; parentSessionId: string },
): ChatSessionRow {
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO chat_sessions
       (id, owner_id, game_id, title, created_at, status, parent_session_id)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`,
  ).run(id, params.ownerId, params.gameId, params.title ?? null, now, params.parentSessionId);
  return getSession(db, id)!;
}

/** Mark an old session as compacted and record which new session it was folded into. */
export function markSessionCompacted(
  db: Database.Database,
  oldSessionId: string,
  newSessionId: string,
): void {
  db.prepare(
    `UPDATE chat_sessions SET status = 'compacted', compacted_into = ? WHERE id = ?`,
  ).run(newSessionId, oldSessionId);
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
  role: 'user' | 'assistant' | 'system_preamble';
  userText?: string;
  assistantText?: string;
  reasoningJson?: string;
  toolCallsJson?: string;
  artifacts?: QueryArtifact[];
  charts?: ChartArtifact[];
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
  const chartsJson = params.charts ? JSON.stringify(params.charts) : null;

  db.prepare(
    `INSERT INTO chat_turns
       (id, session_id, turn_index, role, user_text, assistant_text,
        reasoning_json, tool_calls_json, artifacts_json, charts_json,
        input_tokens, output_tokens, cost_usd, skill, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    chartsJson,
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

/** Return the last N turns for a session, ordered ascending so they read naturally. */
export function listTurnsRecent(
  db: Database.Database,
  sessionId: string,
  limit: number,
): ChatTurnRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM chat_turns
       WHERE session_id = ?
       ORDER BY turn_index DESC
       LIMIT ?`,
    )
    .all(sessionId, limit) as ChatTurnRow[];
  return rows.reverse();
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface StatsResult {
  turns: number;
  input_tokens: number;
  output_tokens: number;
  by_skill: Record<string, { turns: number; input_tokens: number; output_tokens: number }>;
}

export function queryStats(
  db: Database.Database,
  params: { ownerId: string; fromMs: number; toMs: number },
): StatsResult {
  const rows = db
    .prepare(
      `SELECT ct.skill,
              COUNT(*) AS turns,
              SUM(COALESCE(ct.input_tokens, 0)) AS input_tokens,
              SUM(COALESCE(ct.output_tokens, 0)) AS output_tokens
       FROM chat_turns ct
       JOIN chat_sessions cs ON cs.id = ct.session_id
       WHERE cs.owner_id = ?
         AND ct.started_at >= ?
         AND ct.started_at <= ?
         AND ct.role = 'assistant'
       GROUP BY ct.skill`,
    )
    .all(params.ownerId, params.fromMs, params.toMs) as Array<{
      skill: string | null;
      turns: number;
      input_tokens: number;
      output_tokens: number;
    }>;

  let totalTurns = 0;
  let totalInput = 0;
  let totalOutput = 0;
  const bySkill: StatsResult['by_skill'] = {};

  for (const row of rows) {
    totalTurns += row.turns;
    totalInput += row.input_tokens;
    totalOutput += row.output_tokens;
    const key = row.skill ?? 'unknown';
    bySkill[key] = {
      turns: row.turns,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
    };
  }

  return { turns: totalTurns, input_tokens: totalInput, output_tokens: totalOutput, by_skill: bySkill };
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/**
 * Append-only audit insert. `kind` accepts the original three core events
 * plus any phase-introduced UI/event kinds (e.g. starter_clicked,
 * intent_routed, field_chip_clicked, followup_clicked). Kept as `string`
 * so phases don't have to thread through a union — query consumers filter
 * on the literal at read time.
 */
export function insertAudit(
  db: Database.Database,
  params: {
    sessionId?: string;
    turnId?: string;
    kind: string;
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

/**
 * Returns the last `limit` intent_routed events for an owner, newest first.
 * Owner attribution lives inside `detail_json.owner_id` (audit table is
 * append-only and not directly keyed by owner). For ~10s of users / dozens
 * of intent rows this filter-in-JS is fine; revisit if it ever feeds a
 * hot path.
 */
export function listRecentIntents(
  db: Database.Database,
  ownerId: string,
  limit = 20,
): Array<{ skill: string; at: number }> {
  // Pull a bounded recent window of intent_routed rows, then filter by owner.
  // `WHERE kind = ?` is index-friendly via SQLite's automatic index on small
  // tables; an explicit index isn't worth the migration churn yet.
  const rows = db
    .prepare(
      `SELECT detail_json, at FROM chat_audit
       WHERE kind = 'intent_routed'
       ORDER BY at DESC
       LIMIT ?`,
    )
    .all(Math.max(limit * 4, limit)) as Array<{ detail_json: string; at: number }>;
  const out: Array<{ skill: string; at: number }> = [];
  for (const r of rows) {
    try {
      const d = JSON.parse(r.detail_json) as { skill?: string; owner_id?: string };
      if (d.owner_id !== ownerId) continue;
      if (!d.skill) continue;
      out.push({ skill: d.skill, at: r.at });
      if (out.length >= limit) break;
    } catch {
      // ignore malformed rows
    }
  }
  return out;
}
