/**
 * Persisted history of Care-tab precompute passes (segment_care_run table).
 *
 * One row per precompute attempt (nightly cron OR manual "run now"). Powers the
 * Admin-hub status board so an operator can see recent passes, their status,
 * counters, and the last error without tailing logs. Mirrors segment_card_run:
 * count-based retention inlined in recordCareRun (one insert + one bounded
 * delete per segment), best-effort by contract — never fails the precompute.
 */

import { getDb } from './sqlite.js';
import type { CareStage } from '../services/cs-care-builder.js';

/** Runs retained per segment — a working week at nightly cadence. */
export const KEEP_RUNS_PER_SEGMENT = 7;

export type CareRunSource = 'cron' | 'manual';
export type CareRunStatus = 'ok' | 'error';

export interface SegmentCareRun {
  id: number;
  segmentId: string;
  gameId: string;
  source: CareRunSource;
  startedAt: string;
  finishedAt: string | null;
  status: CareRunStatus;
  tickets: number | null;
  contacted: number | null;
  elapsedMs: number | null;
  runError: string | null;
  /** Per-Trino-read telemetry for this pass (which query was slow / timed out). */
  stages: CareStage[];
}

export interface RecordCareRunInput {
  segmentId: string;
  gameId: string;
  source: CareRunSource;
  startedAt: string;
  finishedAt: string | null;
  status: CareRunStatus;
  tickets?: number | null;
  contacted?: number | null;
  elapsedMs?: number | null;
  runError?: string | null;
  stages?: CareStage[];
}

/** Insert one pass record and prune this segment's history to the newest
 *  KEEP_RUNS_PER_SEGMENT rows. */
export function recordCareRun(input: RecordCareRunInput): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO segment_care_run
         (segment_id, game_id, source, started_at, finished_at, status, tickets, contacted, elapsed_ms, run_error, stages_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      input.segmentId,
      input.gameId,
      input.source,
      input.startedAt,
      input.finishedAt,
      input.status,
      input.tickets ?? null,
      input.contacted ?? null,
      input.elapsedMs ?? null,
      input.runError ?? null,
      input.stages && input.stages.length > 0 ? JSON.stringify(input.stages) : null,
    );
    db.prepare(
      `DELETE FROM segment_care_run
        WHERE segment_id = ?
          AND id NOT IN (
            SELECT id FROM segment_care_run
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
  game_id: string;
  source: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  tickets: number | null;
  contacted: number | null;
  elapsed_ms: number | null;
  run_error: string | null;
  stages_json: string | null;
}

/** Parse the stored stages array; a corrupt/legacy-null column yields []. */
function parseStages(raw: string | null): CareStage[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CareStage[]) : [];
  } catch {
    return [];
  }
}

function toRun(r: RawRunRow): SegmentCareRun {
  return {
    id: r.id,
    segmentId: r.segment_id,
    gameId: r.game_id,
    source: r.source === 'manual' ? 'manual' : 'cron',
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status === 'error' ? 'error' : 'ok',
    tickets: r.tickets,
    contacted: r.contacted,
    elapsedMs: r.elapsed_ms,
    runError: r.run_error,
    stages: parseStages(r.stages_json),
  };
}

/** Newest-first run history. Optionally scoped to one segment. */
export function listCareRuns(opts: { segmentId?: string; limit?: number } = {}): SegmentCareRun[] {
  const limit = Math.min(opts.limit ?? 50, 200);
  const db = getDb();
  const rows = opts.segmentId
    ? (db
        .prepare(
          `SELECT * FROM segment_care_run WHERE segment_id = ?
            ORDER BY started_at DESC, id DESC LIMIT ?`,
        )
        .all(opts.segmentId, limit) as RawRunRow[])
    : (db
        .prepare(`SELECT * FROM segment_care_run ORDER BY started_at DESC, id DESC LIMIT ?`)
        .all(limit) as RawRunRow[]);
  return rows.map(toRun);
}

/** Test hook — clears all care run rows. */
export function __clearCareRuns(): void {
  getDb().prepare('DELETE FROM segment_care_run').run();
}
