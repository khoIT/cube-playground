/**
 * Freeze an experiment's treatment/hold-out assignment.
 *
 * Reads the cohort uids from the source segment's materialized membership
 * (`segments.uid_list_json`, already ranked by the segment's defining measure),
 * caps it at the experiment's `cohort_cap` (a demoable POC bound — a whole-game
 * segment can be millions), applies the deterministic split, and writes the
 * frozen arms. Idempotent: re-assigning a `running` experiment is a no-op that
 * returns the existing counts (the arms are frozen).
 */

import { getDb } from '../db/sqlite.js';
import { getExperiment, freezeAssignment, armCounts } from './experiment-store.js';
import { splitCohort } from './deterministic-split.js';
import type { AssignmentResult } from './experiment-types.js';

/** Read the source segment's materialized uids (empty array if none yet). */
function cohortUids(segmentId: string): string[] {
  const row = getDb()
    .prepare('SELECT uid_list_json FROM segments WHERE id = ?')
    .get(segmentId) as { uid_list_json: string | null } | undefined;
  if (!row?.uid_list_json) return [];
  const parsed = JSON.parse(row.uid_list_json) as unknown;
  return Array.isArray(parsed) ? parsed.map(String) : [];
}

/** The source segment's last-materialized size (0 if unknown). */
function cohortSize(segmentId: string): number {
  const row = getDb()
    .prepare('SELECT uid_count FROM segments WHERE id = ?')
    .get(segmentId) as { uid_count: number } | undefined;
  return typeof row?.uid_count === 'number' ? row.uid_count : 0;
}

export class CohortEmptyError extends Error {}
export class ExperimentNotFoundError extends Error {}

/**
 * Assign (freeze) the experiment. `assignedAt` is injected (ISO) so the caller
 * controls the clock and the result is reproducible in tests.
 */
export function assignExperiment(experimentId: string, assignedAt: string): AssignmentResult {
  const exp = getExperiment(experimentId);
  if (!exp) throw new ExperimentNotFoundError(experimentId);

  // Already frozen → idempotent: return the existing arm counts, don't re-split.
  // `capped` is recomputed from the source size vs the cap (not hardcoded), so a
  // re-freeze reports the same truncation state as the original assignment.
  if (exp.status === 'running' && exp.assignedAt) {
    const counts = armCounts(experimentId);
    return {
      experimentId,
      treatment: counts.treatment,
      control: counts.control,
      total: counts.treatment + counts.control,
      capped: cohortSize(exp.segmentId) > exp.cohortCap,
      assignedAt: exp.assignedAt,
    };
  }

  const all = cohortUids(exp.segmentId);
  if (all.length === 0) throw new CohortEmptyError(exp.segmentId);

  const capped = all.length > exp.cohortCap;
  const uids = capped ? all.slice(0, exp.cohortCap) : all;
  const rows = splitCohort(experimentId, uids, exp.splitPct);
  const { treatment, control } = freezeAssignment(experimentId, rows, assignedAt);

  return { experimentId, treatment, control, total: uids.length, capped, assignedAt };
}
