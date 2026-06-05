/**
 * DB operations for the `starter_question_sets` table.
 *
 * One row per (workspace, game_id) — the current best pre-generated starter
 * set for the chat landing page. All reads/writes synchronous (better-sqlite3).
 *
 * Exported functions:
 *   getSet                — read the row, JSON-parsed
 *   upsertSet             — write/replace the set (clears any refine lease)
 *   tryAcquireRefineLease — atomic time-boxed single-flight lease
 *   releaseRefineLease    — free the lease without touching the set
 */

import type Database from 'better-sqlite3';

/**
 * Server-side mirror of the FE `StarterQuestion` shape
 * (src/pages/Chat/library/starter-questions.ts). Field names MUST stay
 * identical — the FE consumes these rows verbatim so its persona filter and
 * histogram ranking work unchanged on generated sets.
 */
export interface StarterQuestion {
  id: string;
  text: string;
  personaTags: Array<'pm' | 'marketer' | 'analyst'>;
  categoryTags: Array<'explore' | 'metric_explain' | 'compare' | 'diagnose'>;
  /** Real `cube.member` names from THIS game's meta — never invented. */
  targetCatalogIds: string[];
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

/**
 * Insert or replace the set for (workspace, game). Deliberately leaves any
 * refine lease untouched on update: a concurrent template write must not
 * wipe another caller's in-flight lease (the lease holder releases it in
 * its own finally).
 */
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

/**
 * Atomically claim the refine lease for (workspace, game) until now+leaseMs.
 * Returns true when this caller won. A row must already exist (the template
 * baseline is always written before a refine starts). Expired leases are
 * reclaimable so a crashed refine never wedges generation forever.
 */
export function tryAcquireRefineLease(
  db: Database.Database,
  workspace: string,
  gameId: string,
  leaseMs: number,
  nowMs: number = Date.now(),
): boolean {
  const result = db
    .prepare(
      `UPDATE starter_question_sets
       SET inflight_until = ?
       WHERE workspace = ? AND game_id = ?
         AND (inflight_until IS NULL OR inflight_until < ?)`,
    )
    .run(nowMs + leaseMs, workspace, gameId, nowMs);
  return result.changes > 0;
}

/** Free the lease without touching the stored set (refine failed or aborted). */
export function releaseRefineLease(
  db: Database.Database,
  workspace: string,
  gameId: string,
): void {
  db.prepare(
    `UPDATE starter_question_sets
     SET inflight_until = NULL
     WHERE workspace = ? AND game_id = ?`,
  ).run(workspace, gameId);
}
