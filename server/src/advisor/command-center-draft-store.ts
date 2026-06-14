/**
 * STUB persistence for Advisor hand-off drafts.
 *
 * The real Experiment Command Center registry is not built yet. Until it ships,
 * scaffolded drafts live in advisor_handoff_draft (migration 054). When the
 * registry lands, this module is the single swap point: replace the SQLite
 * upsert/read with a call into the command-center registry; the ExperimentDraft
 * shape (handoff-scaffolder.ts) is already the contract.
 *
 * Idempotent: upsert is keyed by the deterministic draftId, so re-accepting the
 * same recommendation updates the existing draft rather than duplicating it.
 */

import { getDb } from '../db/sqlite.js';
import type { ExperimentDraft } from './handoff-scaffolder.js';

interface DraftRow {
  draft_id: string;
  segment_id: string;
  game_id: string;
  candidate_id: string;
  draft_json: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Persist (idempotent upsert) a scaffolded draft; returns the stored draft. */
export function saveDraft(draft: ExperimentDraft): ExperimentDraft {
  const db = getDb();
  db.prepare(
    `INSERT INTO advisor_handoff_draft
       (draft_id, segment_id, game_id, candidate_id, draft_json, status, updated_at)
     VALUES (@draft_id, @segment_id, @game_id, @candidate_id, @draft_json, 'draft', datetime('now'))
     ON CONFLICT(draft_id) DO UPDATE SET
       draft_json = excluded.draft_json,
       updated_at = datetime('now')`,
  ).run({
    draft_id: draft.draftId,
    segment_id: draft.segmentId,
    game_id: draft.gameId,
    candidate_id: draft.candidateId,
    draft_json: JSON.stringify(draft),
  });
  return draft;
}

/** Fetch a single draft by its deterministic id, or null. */
export function getDraft(draftId: string): ExperimentDraft | null {
  const db = getDb();
  const row = db
    .prepare('SELECT draft_json FROM advisor_handoff_draft WHERE draft_id = ?')
    .get(draftId) as Pick<DraftRow, 'draft_json'> | undefined;
  if (!row) return null;
  return JSON.parse(row.draft_json) as ExperimentDraft;
}

/** List all drafts scaffolded for a segment (most recent first). */
export function listDraftsForSegment(segmentId: string): ExperimentDraft[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT draft_json FROM advisor_handoff_draft
        WHERE segment_id = ? ORDER BY updated_at DESC`,
    )
    .all(segmentId) as Pick<DraftRow, 'draft_json'>[];
  return rows.map((r) => JSON.parse(r.draft_json) as ExperimentDraft);
}
