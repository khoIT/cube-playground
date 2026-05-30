/**
 * Run-history store for the drift reconciliation pass (metric_drift_run table).
 * One row per pass per game; the Drift Center "Detector runs" tab reads the last
 * N to render a schedule + trend + deltas.
 *
 * Mirrors the snapshot store: pure SQL with `db` injection (no `getDb()` here)
 * so it's trivially testable against an in-memory database.
 */
import type Database from 'better-sqlite3';

export type DriftRunSource = 'detector' | 'manual';
export type DriftRunStatus = 'ok' | 'skipped' | 'error';

export interface DriftRunInput {
  game: string;
  source: DriftRunSource;
  status: DriftRunStatus;
  startedAt: string; // ISO
  finishedAt: string; // ISO
  totalUnresolved: number;
  rootCauseCount: number;
  newCount: number;
  resolvedCount: number;
  cubeMissing: number;
  memberMissing: number;
  unparseable: number;
}

export interface DriftRun extends DriftRunInput {
  id: number;
}

interface RawRow {
  id: number;
  game: string;
  source: DriftRunSource;
  status: DriftRunStatus;
  started_at: string;
  finished_at: string;
  total_unresolved: number;
  root_cause_count: number;
  new_count: number;
  resolved_count: number;
  cube_missing: number;
  member_missing: number;
  unparseable: number;
}

function toRun(r: RawRow): DriftRun {
  return {
    id: r.id,
    game: r.game,
    source: r.source,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    totalUnresolved: r.total_unresolved,
    rootCauseCount: r.root_cause_count,
    newCount: r.new_count,
    resolvedCount: r.resolved_count,
    cubeMissing: r.cube_missing,
    memberMissing: r.member_missing,
    unparseable: r.unparseable,
  };
}

/** Append a run row; returns the inserted run (with id). */
export function recordDriftRun(db: Database.Database, input: DriftRunInput): DriftRun {
  const stmt = db.prepare(
    `INSERT INTO metric_drift_run
       (game, source, status, started_at, finished_at, total_unresolved,
        root_cause_count, new_count, resolved_count, cube_missing, member_missing, unparseable)
     VALUES
       (@game, @source, @status, @startedAt, @finishedAt, @totalUnresolved,
        @rootCauseCount, @newCount, @resolvedCount, @cubeMissing, @memberMissing, @unparseable)`,
  );
  const info = stmt.run(input);
  return { id: Number(info.lastInsertRowid), ...input };
}

/** Last N runs for a game, newest first. */
export function listDriftRuns(db: Database.Database, game: string, limit = 10): DriftRun[] {
  const rows = db
    .prepare(
      `SELECT * FROM metric_drift_run WHERE game = ? ORDER BY started_at DESC, id DESC LIMIT ?`,
    )
    .all(game, limit) as RawRow[];
  return rows.map(toRun);
}

/** Most recent run for a game, or null. */
export function latestDriftRun(db: Database.Database, game: string): DriftRun | null {
  const row = db
    .prepare(`SELECT * FROM metric_drift_run WHERE game = ? ORDER BY started_at DESC, id DESC LIMIT 1`)
    .get(game) as RawRow | undefined;
  return row ? toRun(row) : null;
}
