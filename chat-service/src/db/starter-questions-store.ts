/**
 * DB operations for the `starter_question_sets` table.
 *
 * One row per (workspace, game_id) — the current best pre-generated starter
 * set for the chat landing page. All reads/writes synchronous (better-sqlite3).
 *
 * Exported functions:
 *   getSet    — read the row, JSON-parsed
 *   upsertSet — write/replace the set
 *
 * (The refine-lease helpers were removed with the runtime LLM refine pass;
 * the legacy `inflight_until` column remains in the schema, always NULL.)
 */

import type Database from 'better-sqlite3';

/**
 * Server-side mirror of the FE `StarterQuestion` shape
 * (src/pages/Chat/library/starter-questions.ts). Field names MUST stay
 * identical — the FE consumes these rows verbatim so its topic filter and
 * histogram ranking work unchanged on generated sets.
 */
export interface StarterQuestion {
  id: string;
  text: string;
  /** Publishing-business topics — drive the FE filter chips. */
  topicTags: Array<'liveops' | 'user_acquisition' | 'monetization'>;
  categoryTags: Array<'explore' | 'metric_explain' | 'compare' | 'diagnose'>;
  /** Real `cube.member` names from THIS game's meta — never invented. */
  targetCatalogIds: string[];
  /**
   * basic = cross-game KPI cubes (recharge, mf_users, active_daily…);
   * advanced = game-specific event tables (etl_*, user_roles/devices/ips).
   * Stamped at freeze time by the pregenerate workflow.
   */
  depth?: 'basic' | 'advanced';
  /**
   * Serve-time enrichment ONLY (never persisted): latest date with data when
   * the question's cube lags >14 days behind today, from the seed coverage.
   * The FE renders it as a "Data through <date>" transparency badge.
   */
  dataThrough?: string;
}

/** What the stored set was produced by. 'seed' = pregenerated frozen set from the seed file. */
export type StarterSource = 'template' | 'llm' | 'seed';

/** What the generation pipeline is currently doing for this row. 'seed' rows never move. */
export type StarterStatus = 'template' | 'refining' | 'llm' | 'failed' | 'seed';

export interface StarterSetRow {
  workspace: string;
  game_id: string;
  meta_hash: string;
  source: StarterSource;
  questions: StarterQuestion[];
  status: StarterStatus;
  inflight_until: number | null;
  updated_at: number;
}

interface RawRow {
  workspace: string;
  game_id: string;
  meta_hash: string;
  source: string;
  questions_json: string;
  status: string;
  inflight_until: number | null;
  updated_at: number;
}

/** Read the set for (workspace, game). Returns null when none generated yet. */
export function getSet(
  db: Database.Database,
  workspace: string,
  gameId: string,
): StarterSetRow | null {
  const row = db
    .prepare(
      `SELECT workspace, game_id, meta_hash, source, questions_json, status,
              inflight_until, updated_at
       FROM starter_question_sets
       WHERE workspace = ? AND game_id = ?`,
    )
    .get(workspace, gameId) as RawRow | undefined;
  if (!row) return null;

  let questions: StarterQuestion[] = [];
  try {
    const parsed = JSON.parse(row.questions_json);
    if (Array.isArray(parsed)) questions = parsed as StarterQuestion[];
  } catch {
    // Corrupt JSON degrades to an empty set — callers treat it as a miss.
  }

  return {
    workspace: row.workspace,
    game_id: row.game_id,
    meta_hash: row.meta_hash,
    source: row.source as StarterSource,
    questions,
    status: row.status as StarterStatus,
    inflight_until: row.inflight_until,
    updated_at: row.updated_at,
  };
}

export interface UpsertSetParams {
  workspace: string;
  gameId: string;
  metaHash: string;
  source: StarterSource;
  questions: StarterQuestion[];
  status: StarterStatus;
}

/** Insert or replace the set for (workspace, game). */
export function upsertSet(
  db: Database.Database,
  params: UpsertSetParams,
  nowMs: number = Date.now(),
): void {
  db.prepare(
    `INSERT INTO starter_question_sets
       (workspace, game_id, meta_hash, source, questions_json, status,
        inflight_until, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT(workspace, game_id) DO UPDATE SET
       meta_hash      = excluded.meta_hash,
       source         = excluded.source,
       questions_json = excluded.questions_json,
       status         = excluded.status,
       updated_at     = excluded.updated_at`,
  ).run(
    params.workspace,
    params.gameId,
    params.metaHash,
    params.source,
    JSON.stringify(params.questions),
    params.status,
    nowMs,
    nowMs,
  );
}

