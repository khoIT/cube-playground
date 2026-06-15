/**
 * CRUD over the `experiments` registry + the frozen `experiment_assignment` arms.
 *
 * The registry mirrors the `care_cases` store shape (TEXT id, status lifecycle,
 * prepared statements over `getDb()`). The assignment table is write-once per
 * experiment: `freezeAssignment` replaces any prior arms in a single transaction
 * (idempotent re-assign), and arms are never mutated afterward.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';
import type {
  Experiment,
  ExperimentArm,
  ExperimentDraftInput,
  ExperimentStatus,
  PrimaryMetric,
} from './experiment-types.js';

interface ExperimentRow {
  id: string;
  game_id: string;
  workspace: string;
  name: string;
  hypothesis: string;
  segment_id: string;
  status: string;
  split_pct: number;
  primary_metric: string;
  window_days: number;
  cohort_cap: number;
  assigned_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToExperiment(r: ExperimentRow): Experiment {
  return {
    id: r.id,
    gameId: r.game_id,
    workspace: r.workspace,
    name: r.name,
    hypothesis: r.hypothesis,
    segmentId: r.segment_id,
    status: r.status as ExperimentStatus,
    splitPct: r.split_pct,
    primaryMetric: r.primary_metric as PrimaryMetric,
    windowDays: r.window_days,
    cohortCap: r.cohort_cap,
    assignedAt: r.assigned_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Create a draft experiment; returns the persisted row. */
export function createExperiment(input: ExperimentDraftInput): Experiment {
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO experiments
         (id, game_id, workspace, name, hypothesis, segment_id, status,
          split_pct, primary_metric, window_days, cohort_cap)
       VALUES (@id, @game_id, @workspace, @name, @hypothesis, @segment_id, 'draft',
          @split_pct, @primary_metric, @window_days, @cohort_cap)`,
    )
    .run({
      id,
      game_id: input.gameId,
      workspace: input.workspace ?? 'local',
      name: input.name,
      hypothesis: input.hypothesis ?? '',
      segment_id: input.segmentId,
      split_pct: input.splitPct ?? 50,
      primary_metric: input.primaryMetric ?? 'gross_payment_rate',
      window_days: input.windowDays ?? 14,
      cohort_cap: input.cohortCap ?? 20000,
    });
  return getExperiment(id)!;
}

export function getExperiment(id: string): Experiment | null {
  const row = getDb().prepare('SELECT * FROM experiments WHERE id = ?').get(id) as
    | ExperimentRow
    | undefined;
  return row ? rowToExperiment(row) : null;
}

export function listExperiments(gameId: string): Experiment[] {
  const rows = getDb()
    .prepare('SELECT * FROM experiments WHERE game_id = ? ORDER BY created_at DESC')
    .all(gameId) as ExperimentRow[];
  return rows.map(rowToExperiment);
}

/** Patch mutable draft params / status. Touches updated_at. */
export function patchExperiment(
  id: string,
  patch: Partial<Pick<Experiment, 'name' | 'hypothesis' | 'splitPct' | 'primaryMetric' | 'windowDays' | 'cohortCap' | 'status'>>,
): Experiment | null {
  const cur = getExperiment(id);
  if (!cur) return null;
  getDb()
    .prepare(
      `UPDATE experiments SET
         name = @name, hypothesis = @hypothesis, split_pct = @split_pct,
         primary_metric = @primary_metric, window_days = @window_days,
         cohort_cap = @cohort_cap, status = @status, updated_at = datetime('now')
       WHERE id = @id`,
    )
    .run({
      id,
      name: patch.name ?? cur.name,
      hypothesis: patch.hypothesis ?? cur.hypothesis,
      split_pct: patch.splitPct ?? cur.splitPct,
      primary_metric: patch.primaryMetric ?? cur.primaryMetric,
      window_days: patch.windowDays ?? cur.windowDays,
      cohort_cap: patch.cohortCap ?? cur.cohortCap,
      status: patch.status ?? cur.status,
    });
  return getExperiment(id);
}

/**
 * Replace the frozen arms for an experiment and stamp it running. Single
 * transaction so a re-assign never leaves a half-written arm set. Returns the
 * arm counts.
 */
export function freezeAssignment(
  experimentId: string,
  rows: { uid: string; arm: ExperimentArm }[],
  assignedAt: string,
): { treatment: number; control: number } {
  const db = getDb();
  const tx = db.transaction((arms: { uid: string; arm: ExperimentArm }[]) => {
    db.prepare('DELETE FROM experiment_assignment WHERE experiment_id = ?').run(experimentId);
    const ins = db.prepare(
      'INSERT INTO experiment_assignment (experiment_id, uid, arm) VALUES (?, ?, ?)',
    );
    for (const a of arms) ins.run(experimentId, a.uid, a.arm);
    db.prepare(
      `UPDATE experiments SET status = 'running', assigned_at = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(assignedAt, experimentId);
  });
  tx(rows);
  return {
    treatment: rows.filter((r) => r.arm === 'treatment').length,
    control: rows.filter((r) => r.arm === 'control').length,
  };
}

/** Read back the frozen uids for one arm. */
export function armUids(experimentId: string, arm: ExperimentArm): string[] {
  return (
    getDb()
      .prepare('SELECT uid FROM experiment_assignment WHERE experiment_id = ? AND arm = ?')
      .all(experimentId, arm) as { uid: string }[]
  ).map((r) => r.uid);
}

/** Per-arm assigned counts (cheap; no uid materialization). */
export function armCounts(experimentId: string): { treatment: number; control: number } {
  const rows = getDb()
    .prepare(
      `SELECT arm, COUNT(*) AS n FROM experiment_assignment
        WHERE experiment_id = ? GROUP BY arm`,
    )
    .all(experimentId) as { arm: ExperimentArm; n: number }[];
  return {
    treatment: rows.find((r) => r.arm === 'treatment')?.n ?? 0,
    control: rows.find((r) => r.arm === 'control')?.n ?? 0,
  };
}

/** Test hook — wipe both tables. */
export function clearExperiments(): void {
  getDb().prepare('DELETE FROM experiment_assignment').run();
  getDb().prepare('DELETE FROM experiments').run();
}
