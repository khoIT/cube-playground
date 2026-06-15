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
 *
 * `opts.resync` re-freezes an already-running experiment against the segment's
 * CURRENT membership: it re-reads the cohort, re-splits, and stamps a fresh
 * `assignedAt` (so the outcome window restarts). The deterministic split keys on
 * the experiment id, so a uid present in both the old and new membership keeps
 * its arm; only added/removed uids change. This is an explicit, destructive user
 * action — the prior arms and outcome window are discarded.
 */
export function assignExperiment(
  experimentId: string,
  assignedAt: string,
  opts: { resync?: boolean } = {},
): AssignmentResult {
  const exp = getExperiment(experimentId);
  if (!exp) throw new ExperimentNotFoundError(experimentId);

  // Already frozen (running OR completed/archived — `assignedAt` is the truth, not
  // status) → idempotent: return the existing arm counts, don't re-split. `capped`
  // is recomputed from the source size vs the cap (not hardcoded), so a re-freeze
  // reports the same truncation state as the original assignment. Only an explicit
  // resync skips this short-circuit to re-split current membership.
  if (!opts.resync && exp.assignedAt) {
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
