/**
 * Opportunity feedback store — the human half of the Treatment-Effect Library.
 *
 * Append-only. A manager dismisses an opportunity ("structural, can't fix") or
 * pins it ("do this next"), with a reason. Future diagnoses read this to
 * suppress dismissed factors and boost pinned ones. Keyed by (segment, factor,
 * lever) shape — never by individual member. PII-free.
 */

import { getDb } from '../db/sqlite.js';

export type FeedbackAction = 'dismiss' | 'pin';

export interface AdvisorFeedback {
  segmentId: string;
  gameId: string;
  /** Goal-tree factor key the feedback targets (e.g. "lifespan"). */
  factor: string;
  /** Lever family, when the feedback is about a specific recommendation. */
  leverFamily?: string;
  action: FeedbackAction;
  /** 'structural' | 'known' | 'not-now' | free text — why. */
  reason: string;
  createdBy?: string;
}

export interface AdvisorFeedbackRow extends AdvisorFeedback {
  id: string;
  createdAt: string;
}

/** Append one feedback record. */
export function recordFeedback(fb: AdvisorFeedback): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO advisor_feedback
       (segment_id, game_id, factor, lever_family, action, reason, created_by)
     VALUES (@segment_id, @game_id, @factor, @lever_family, @action, @reason, @created_by)`,
  ).run({
    segment_id: fb.segmentId,
    game_id: fb.gameId,
    factor: fb.factor,
    lever_family: fb.leverFamily ?? null,
    action: fb.action,
    reason: fb.reason,
    created_by: fb.createdBy ?? null,
  });
}

/** Read all feedback for a segment (most recent first). */
export function listFeedbackForSegment(segmentId: string): AdvisorFeedbackRow[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT id, segment_id, game_id, factor, lever_family, action, reason, created_by, created_at
         FROM advisor_feedback WHERE segment_id = ? ORDER BY created_at DESC`,
    )
    .all(segmentId) as Array<{
    id: string;
    segment_id: string;
    game_id: string;
    factor: string;
    lever_family: string | null;
    action: FeedbackAction;
    reason: string;
    created_by: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    segmentId: r.segment_id,
    gameId: r.game_id,
    factor: r.factor,
    leverFamily: r.lever_family ?? undefined,
    action: r.action,
    reason: r.reason,
    createdBy: r.created_by ?? undefined,
    createdAt: r.created_at,
  }));
}
