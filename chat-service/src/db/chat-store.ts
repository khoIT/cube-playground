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
import type { SegmentProposal } from '../tools/propose-segment.js';

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function createSession(
  db: Database.Database,
  params: { ownerId: string; gameId: string; workspace?: string; title?: string; ownerLabel?: string | null },
): ChatSessionRow {
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO chat_sessions (id, owner_id, game_id, workspace, title, created_at, status, owner_label)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
  ).run(
    id,
    params.ownerId,
    params.gameId,
    params.workspace ?? 'local',
    params.title ?? null,
    now,
    params.ownerLabel ?? null,
  );
  return getSession(db, id)!;
}

/**
 * Set a session's sharing state. 'shared' stamps shared_at = now; 'private'
 * clears it. Caller (route layer) must enforce owner-only access first.
 */
export function setSessionVisibility(
  db: Database.Database,
  id: string,
  visibility: 'private' | 'shared',
): void {
  const sharedAt = visibility === 'shared' ? Date.now() : null;
  db.prepare('UPDATE chat_sessions SET visibility = ?, shared_at = ? WHERE id = ?').run(
    visibility,
    sharedAt,
    id,
  );
}

/**
 * List sessions shared with the team for a game+workspace, across all owners.
 * Read-only surface: any authenticated member may see these. Hides archived,
 * compacted, and soft-deleted rows. Optional title LIKE filter.
 */
export function listSharedSessions(
  db: Database.Database,
  params: { gameId: string; workspace?: string; limit?: number; q?: string },
): ChatSessionRow[] {
  const limit = params.limit ?? 50;
  const workspace = params.workspace ?? 'local';
  const q = params.q?.trim();
  if (q) {
    const safe = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const pattern = `%${safe}%`;
    return db
      .prepare(
        `SELECT * FROM chat_sessions
         WHERE visibility = 'shared' AND game_id = ? AND workspace = ? AND status = 'active'
           AND deleted_at IS NULL
           AND title LIKE ? ESCAPE '\\'
         ORDER BY COALESCE(last_turn_at, created_at) DESC, created_at DESC
         LIMIT ?`,
      )
      .all(params.gameId, workspace, pattern, limit) as ChatSessionRow[];
  }
  return db
    .prepare(
      `SELECT * FROM chat_sessions
       WHERE visibility = 'shared' AND game_id = ? AND workspace = ? AND status = 'active'
         AND deleted_at IS NULL
       ORDER BY COALESCE(last_turn_at, created_at) DESC, created_at DESC
       LIMIT ?`,
    )
    .all(params.gameId, workspace, limit) as ChatSessionRow[];
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

// NOTE on ordering: last_turn_at is NULL until the first turn COMPLETES
// (incrementTurnCount). SQLite sorts NULL as the smallest value, so a plain
// `ORDER BY last_turn_at DESC` buried just-created sessions at the bottom —
// past LIMIT they were invisible in the sidebar until the (possibly minutes-
// long) first turn finished. COALESCE to created_at keeps them on top.
export function listSessions(
  db: Database.Database,
  params: { ownerId: string; gameId: string; workspace?: string; limit?: number; q?: string },
): ChatSessionRow[] {
  const limit = params.limit ?? 20;
  const workspace = params.workspace ?? 'local';
  const q = params.q?.trim();
  if (q) {
    // Title-only LIKE search. Escape % _ in the user input to keep them literal.
    const safe = q.replace(/[\\%_]/g, (c) => `\\${c}`);
    const pattern = `%${safe}%`;
    return db
      .prepare(
        `SELECT * FROM chat_sessions
         WHERE owner_id = ? AND game_id = ? AND workspace = ? AND status != 'archived'
           AND deleted_at IS NULL
           AND title LIKE ? ESCAPE '\\'
         ORDER BY COALESCE(last_turn_at, created_at) DESC, created_at DESC
         LIMIT ?`,
      )
      .all(params.ownerId, params.gameId, workspace, pattern, limit) as ChatSessionRow[];
  }
  return db
    .prepare(
      `SELECT * FROM chat_sessions
       WHERE owner_id = ? AND game_id = ? AND workspace = ? AND status != 'archived'
         AND deleted_at IS NULL
       ORDER BY COALESCE(last_turn_at, created_at) DESC, created_at DESC
       LIMIT ?`,
    )
    .all(params.ownerId, params.gameId, workspace, limit) as ChatSessionRow[];
}

/**
 * Soft-deletes a session by setting deleted_at = now.
 * Does NOT cascade (no DELETE fired — FK cascade is skipped).
 * Does NOT write a tombstone — tombstones are only written at final hard-purge.
 */
export function softDeleteSession(db: Database.Database, id: string): void {
  db.prepare('UPDATE chat_sessions SET deleted_at = ? WHERE id = ?').run(Date.now(), id);
}

/**
 * Restores a soft-deleted session by clearing deleted_at.
 */
export function restoreSession(db: Database.Database, id: string): void {
  db.prepare('UPDATE chat_sessions SET deleted_at = NULL WHERE id = ?').run(id);
}

/**
 * Hard-deletes sessions whose deleted_at is before `cutoffMs` (LIMIT 200 per call).
 * Writes a tombstone per purged session so deletions propagate via snapshot.
 * Returns count of purged sessions.
 */
export function purgeSoftDeleted(db: Database.Database, cutoffMs: number): number {
  const rows = db
    .prepare(
      'SELECT id FROM chat_sessions WHERE deleted_at IS NOT NULL AND deleted_at < ? LIMIT 200',
    )
    .all(cutoffMs) as Array<{ id: string }>;

  if (rows.length === 0) return 0;

  const hardDelete = db.prepare('DELETE FROM chat_sessions WHERE id = ?');
  const insertTombstone = db.prepare(
    'INSERT OR REPLACE INTO chat_tombstones (session_id, deleted_at) VALUES (?, ?)',
  );
  const now = Date.now();

  const tx = db.transaction(() => {
    for (const row of rows) {
      hardDelete.run(row.id);
      insertTombstone.run(row.id, now);
    }
  });
  tx();

  return rows.length;
}

/**
 * Hard-deletes a session and its turns, then records a tombstone.
 * Kept for the retention sweep's final hard-purge path and backward compat.
 * Idempotent: tombstone is INSERT OR REPLACE.
 * @deprecated Prefer softDeleteSession for user-facing deletes.
 */
export function deleteSession(db: Database.Database, id: string): void {
  const tx = db.transaction((sessionId: string) => {
    db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(sessionId);
    db.prepare(
      'INSERT OR REPLACE INTO chat_tombstones (session_id, deleted_at) VALUES (?, ?)',
    ).run(sessionId, Date.now());
  });
  tx(id);
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
  params: { ownerId: string; gameId: string; workspace?: string; title?: string; parentSessionId: string },
): ChatSessionRow {
  const id = uuidv4();
  const now = Date.now();
  db.prepare(
    `INSERT INTO chat_sessions
       (id, owner_id, game_id, workspace, title, created_at, status, parent_session_id)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
  ).run(id, params.ownerId, params.gameId, params.workspace ?? 'local', params.title ?? null, now, params.parentSessionId);
  return getSession(db, id)!;
}

/**
 * Phase-01: persist the Anthropic SDK conversation id captured during the
 * first turn. Subsequent turns read it via getSession() and pass it back as
 * `resumeId` so the model sees its full prior thread.
 */
export function setSdkConversationId(
  db: Database.Database,
  sessionId: string,
  sdkConversationId: string,
): void {
  db.prepare(
    'UPDATE chat_sessions SET sdk_conversation_id = ? WHERE id = ?',
  ).run(sdkConversationId, sessionId);
}

/**
 * Phase-01: drop the persisted SDK conversation id. Called by
 * compact-service before marking the old session compacted (the new session
 * starts fresh) and by the stale-id retry path when the SDK rejects a
 * resume.
 */
export function clearSdkConversationId(
  db: Database.Database,
  sessionId: string,
): void {
  db.prepare(
    'UPDATE chat_sessions SET sdk_conversation_id = NULL WHERE id = ?',
  ).run(sessionId);
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
  /**
   * Optional caller-supplied row id. When provided, used as `chat_turns.id`
   * verbatim instead of generating a fresh uuid. Lets the SSE turnId double
   * as the chat_turns row id so observability tables (which FK to chat_turns)
   * can persist rows keyed by the same id the runner emits.
   */
  id?: string;
  sessionId: string;
  turnIndex: number;
  role: 'user' | 'assistant' | 'system_preamble';
  userText?: string;
  assistantText?: string;
  reasoningJson?: string;
  toolCallsJson?: string;
  artifacts?: QueryArtifact[];
  charts?: ChartArtifact[];
  /** Segment proposals emitted by propose_segment in this turn; persisted so the
   *  card re-renders on session reload (predicate_tree is self-contained). */
  proposals?: SegmentProposal[];
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  /** Phase-03: Anthropic cache write tokens from SDK result usage block. */
  cacheCreationTokens?: number | null;
  /** Phase-03: Anthropic cache read tokens from SDK result usage block. */
  cacheReadTokens?: number | null;
  /** Phase-06: 1 when this turn was served from the response cache; 0 otherwise. */
  cacheHit?: number;
  /** Phase-06: turn id of the original cached turn this was replayed from. */
  originalTurnId?: string | null;
  /**
   * Freshness flag for cache-hit turns:
   *   'refreshed' — at least one cached chart had its data re-executed live on replay.
   *   'stale'     — served from cache as-is (refresh skipped, failed, or n/a).
   * Null/undefined on non-cache-hit turns.
   */
  cacheFreshness?: 'refreshed' | 'stale' | null;
  /**
   * Turn-level stop_reason (e.g. 'end_turn', 'max_tokens').
   * Cache-hit turns must pass 'end_turn' explicitly because the observability
   * stack is skipped on that path — without it stop_reason stays NULL and the
   * leaderboard counts the turn as a legacy null (skews successRate denominator).
   */
  stopReason?: string | null;
  skill?: string;
  /** System prompt text persisted on the assistant turn row (phase 01 column). */
  systemPromptText?: string;
  /** Model string used for this turn, e.g. config.chatModel (phase 01 column). */
  model?: string;
  /** Auth lane that served the turn ('primary'|'stg'|'backup'|'subscription'). */
  llmAuthLabel?: string | null;
  /**
   * Serialized {slot, prompt, options} of the disambig_options SSE frame this
   * turn emitted (offer_choices / disambiguate_query). Lets a reloaded session
   * re-render the clickable choice chips. Undefined when no choices were offered.
   */
  disambigJson?: string;
  startedAt: number;
  endedAt?: number;
}

export function appendTurn(
  db: Database.Database,
  params: AppendTurnParams,
): ChatTurnRow {
  const id = params.id ?? uuidv4();
  const artifactsJson = params.artifacts ? JSON.stringify(params.artifacts) : null;
  const chartsJson = params.charts ? JSON.stringify(params.charts) : null;
  const proposalsJson = params.proposals?.length ? JSON.stringify(params.proposals) : null;

  db.prepare(
    `INSERT INTO chat_turns
       (id, session_id, turn_index, role, user_text, assistant_text,
        reasoning_json, tool_calls_json, artifacts_json, charts_json, proposals_json,
        input_tokens, output_tokens, cost_usd,
        cache_creation_tokens, cache_read_tokens,
        cache_hit, original_turn_id, cache_freshness,
        skill, system_prompt_text, model,
        stop_reason, llm_auth_label, disambig_json,
        started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    proposalsJson,
    params.inputTokens ?? null,
    params.outputTokens ?? null,
    params.costUsd ?? null,
    params.cacheCreationTokens ?? null,
    params.cacheReadTokens ?? null,
    params.cacheHit ?? 0,
    params.originalTurnId ?? null,
    params.cacheFreshness ?? null,
    params.skill ?? null,
    params.systemPromptText ?? null,
    params.model ?? null,
    params.stopReason ?? null,
    params.llmAuthLabel ?? null,
    params.disambigJson ?? null,
    params.startedAt,
    params.endedAt ?? null,
  );

  return listTurns(db, params.sessionId).find((t) => t.id === id)!;
}

/**
 * Return a single turn by its id, or null if not found.
 * Used by the cache write gate to read the persisted stop_reason after flush.
 */
export function getTurnById(db: Database.Database, id: string): ChatTurnRow | null {
  return (
    (db.prepare('SELECT * FROM chat_turns WHERE id = ?').get(id) as ChatTurnRow | undefined) ?? null
  );
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
  // Errored assistant turns (stop_reason='error') and boot-sweep restart
  // markers (stop_reason='service_restart') stay out of agent context so a
  // retry doesn't see "previous attempt failed" and apologise instead of
  // answering. The FE-facing listTurns() above keeps them so the user still
  // sees the failure in chat history.
  const rows = db
    .prepare(
      `SELECT * FROM chat_turns
       WHERE session_id = ?
         AND (stop_reason IS NULL OR stop_reason NOT IN ('error', 'service_restart'))
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

/**
 * Bulk variant of `queryStats` for the admin telemetry bridge — one StatsResult
 * per owner (= Keycloak sub). Reuses the single-owner query per sub so the
 * aggregation logic stays in one place; admin user lists are bounded so the
 * per-sub loop is cheap. Subs are de-duplicated; an owner with no turns in the
 * window still gets a zeroed entry so the caller sees a complete map.
 */
export function queryStatsBulk(
  db: Database.Database,
  params: { ownerIds: string[]; fromMs: number; toMs: number },
): Record<string, StatsResult> {
  const out: Record<string, StatsResult> = {};
  for (const ownerId of new Set(params.ownerIds)) {
    out[ownerId] = queryStats(db, { ownerId, fromMs: params.fromMs, toMs: params.toMs });
  }
  return out;
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
