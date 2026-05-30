/**
 * Metric drift snapshot store.
 *
 * Persists each game's unresolved registry refs, keyed by
 * (workspace_id, game, source). This keying makes drift workspace-independent:
 * the detector writes (workspace_id='local', source='detector'); the live page
 * writes (active workspace id, source='live'). Switching workspace shows that
 * workspace's own snapshot and never touches another's.
 *
 * `upsertDriftRows` uses replace-per-(workspace, game, source) semantics —
 * delete the existing scope's rows then insert the current set, atomically. A
 * ref that resolved this run therefore disappears. The DELETE is scoped to the
 * single (workspace_id, game, source) tuple so it never wipes another scope.
 *
 * Mirrors the audit store: pure SQL with `db` injection (no `getDb()` here).
 */

import type Database from 'better-sqlite3';
import type { UnresolvedRef } from '../services/metric-ref-validator.js';

export type DriftSource = 'detector' | 'live';

export interface DriftRowInput {
  metricId: string;
  ref: string;
  reason: UnresolvedRef['reason'];
}

export interface DriftRow {
  id: number;
  workspaceId: string;
  game: string;
  metricId: string;
  ref: string;
  reason: UnresolvedRef['reason'];
  source: DriftSource;
  updatedAt: string;
}

interface RawRow {
  id: number;
  workspace_id: string;
  game: string;
  metric_id: string;
  ref: string;
  reason: UnresolvedRef['reason'];
  source: DriftSource;
  updated_at: string;
}

function rowFromRaw(r: RawRow): DriftRow {
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    game: r.game,
    metricId: r.metric_id,
    ref: r.ref,
    reason: r.reason,
    source: r.source,
    updatedAt: r.updated_at,
  };
}

export interface UpsertDriftInput {
  workspaceId: string;
  game: string;
  source: DriftSource;
  rows: DriftRowInput[];
  /** Defaults to now(); injectable for tests. */
  updatedAt?: string;
}

/**
 * Replace-per-(workspace, game, source): delete that scope's existing rows then
 * insert the current set in one transaction. Call with `rows: []` to clear a
 * now-resolved game's rows for the scope.
 */
export function upsertDriftRows(db: Database.Database, input: UpsertDriftInput): void {
  const updatedAt = input.updatedAt ?? new Date().toISOString();
  const del = db.prepare(
    `DELETE FROM metric_drift_snapshot
      WHERE workspace_id = ? AND game = ? AND source = ?`,
  );
  const ins = db.prepare(
    `INSERT OR REPLACE INTO metric_drift_snapshot
       (workspace_id, game, metric_id, ref, reason, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((rows: DriftRowInput[]) => {
    del.run(input.workspaceId, input.game, input.source);
    for (const r of rows) {
      ins.run(input.workspaceId, input.game, r.metricId, r.ref, r.reason, input.source, updatedAt);
    }
  });
  tx(input.rows);
}

export interface ListDriftOpts {
  workspaceId?: string;
  game?: string;
  source?: DriftSource;
}

/** List rows, optionally filtered by any subset of the scope key. */
export function listDriftRows(db: Database.Database, opts: ListDriftOpts = {}): DriftRow[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (opts.workspaceId !== undefined) {
    clauses.push('workspace_id = ?');
    params.push(opts.workspaceId);
  }
  if (opts.game !== undefined) {
    clauses.push('game = ?');
    params.push(opts.game);
  }
  if (opts.source !== undefined) {
    clauses.push('source = ?');
    params.push(opts.source);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT id, workspace_id, game, metric_id, ref, reason, source, updated_at
       FROM metric_drift_snapshot
       ${where}
      ORDER BY metric_id ASC, ref ASC`,
  ).all(...params) as RawRow[];
  return rows.map(rowFromRaw);
}
