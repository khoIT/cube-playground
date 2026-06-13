/**
 * Persisted history of segment card-runner passes (segment_card_run table).
 *
 * The live per-card view (card-progress.ts) is in-memory and only keeps the
 * LATEST pass per segment, and the card cache's error breadcrumbs outlive the
 * pass that wrote them — so once a pass ends, "which run was this error from
 * and how old is it" was unanswerable. This store freezes a compact summary of
 * each pass (tally + failing cards with their messages) so the refresh monitor
 * can show the recent few runs with real ages.
 *
 * Retention is count-based and inlined in recordCardRun (unlike the time-based
 * refresh-log pruner): one pass = one insert + one bounded delete per segment,
 * so a standalone sweep job would be overkill.
 */

import { getDb } from '../db/sqlite.js';

/** Runs retained per segment. The user's floor was "most recent 3"; 5 covers a
 *  working day at the common 1h cadence without meaningfully growing the DB. */
export const KEEP_RUNS_PER_SEGMENT = 5;

export type CardRunSource = 'cron' | 'manual';

export interface FailingCard {
  cardId: string;
  error: string | null;
}

export interface SegmentCardRun {
  id: number;
  segmentId: string;
  startedAt: string;
  finishedAt: string | null;
  source: CardRunSource;
  total: number;
  ok: number;
  failed: number;
  failingCards: FailingCard[];
  /** Pass-level throw message; per-card tallies may be partial when set. */
  runError: string | null;
}

export interface RecordCardRunInput {
  segmentId: string;
  startedAt: string;
  finishedAt: string | null;
  source: CardRunSource;
  total: number;
  ok: number;
  failed: number;
  failingCards: FailingCard[];
  runError?: string | null;
}

/** Insert one pass record and prune this segment's history to the newest
 *  KEEP_RUNS_PER_SEGMENT rows. Best-effort by contract: callers run this in
 *  the refresh path and must never let history-keeping fail the refresh. */
export function recordCardRun(input: RecordCardRunInput): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO segment_card_run
         (segment_id, started_at, finished_at, source, total, ok, failed, failing_cards_json, run_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.segmentId,
      input.startedAt,
      input.finishedAt,
      input.source,
      input.total,
      input.ok,
      input.failed,
      input.failingCards.length > 0 ? JSON.stringify(input.failingCards) : null,
      input.runError ?? null,
    );
    db.prepare(
      `DELETE FROM segment_card_run
        WHERE segment_id = ?
          AND id NOT IN (
            SELECT id FROM segment_card_run
             WHERE segment_id = ?
             ORDER BY started_at DESC, id DESC
             LIMIT ?
          )`,
    ).run(input.segmentId, input.segmentId, KEEP_RUNS_PER_SEGMENT);
  });
  tx();
}

interface RawRunRow {
  id: number;
  segment_id: string;
  started_at: string;
  finished_at: string | null;
  source: string;
  total: number;
  ok: number;
  failed: number;
  failing_cards_json: string | null;
  run_error: string | null;
}

/** Newest-first run history for one segment. */
export function listCardRuns(segmentId: string, limit = KEEP_RUNS_PER_SEGMENT): SegmentCardRun[] {
  const rows = getDb()
    .prepare(
      `SELECT id, segment_id, started_at, finished_at, source, total, ok, failed,
              failing_cards_json, run_error
         FROM segment_card_run
        WHERE segment_id = ?
        ORDER BY started_at DESC, id DESC
        LIMIT ?`,
    )
    .all(segmentId, limit) as RawRunRow[];

  return rows.map((r) => ({
    id: r.id,
    segmentId: r.segment_id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    source: r.source === 'manual' ? 'manual' : 'cron',
    total: r.total,
    ok: r.ok,
    failed: r.failed,
    failingCards: parseFailingCards(r.failing_cards_json),
    runError: r.run_error,
  }));
}

function parseFailingCards(json: string | null): FailingCard[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as FailingCard[]) : [];
  } catch {
    return []; // corrupt history row — never fail a read over it
  }
}
