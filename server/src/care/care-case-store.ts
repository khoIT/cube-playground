/**
 * CRUD over the `care_cases` ledger.
 *
 * `openCase` is idempotent against the unique partial index — re-opening while a
 * case is still open is a no-op (returns the existing row), so a re-sweep of a
 * stable cohort never duplicates. Status patches drive the lifecycle; resolving
 * a case frees the (game, playbook, uid) slot for a future occurrence.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';

export type CaseStatus = 'new' | 'in_review' | 'treated' | 'resolved' | 'dismissed';
export type CaseSource = 'membership' | 'trigger';
export type CaseOutcome = 'kpi_met' | 'kpi_missed' | 'na';

export interface CareCase {
  id: string;
  game_id: string;
  workspace: string;
  playbook_id: string;
  uid: string;
  source: CaseSource;
  opened_at: string;
  stats_snapshot_json: string | null;
  status: CaseStatus;
  condition_lapsed: number;
  assignee: string | null;
  treated_at: string | null;
  channel_used: string | null;
  action_taken: string | null;
  notes: string | null;
  kpi_target: string | null;
  kpi_eval_at: string | null;
  outcome: CaseOutcome | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OpenCaseInput {
  gameId: string;
  workspace: string;
  playbookId: string;
  uid: string;
  source: CaseSource;
  statsSnapshot?: unknown;
  kpiTarget?: string | null;
}

const OPEN_STATUSES: CaseStatus[] = ['new', 'in_review', 'treated'];

/** Find the currently-open case for a (game, playbook, uid), if any. */
export function findOpenCase(gameId: string, playbookId: string, uid: string): CareCase | undefined {
  return getDb()
    .prepare(
      `SELECT * FROM care_cases
        WHERE game_id = ? AND playbook_id = ? AND uid = ?
          AND status NOT IN ('resolved','dismissed')
        LIMIT 1`,
    )
    .get(gameId, playbookId, uid) as CareCase | undefined;
}

/**
 * Open a case idempotently. If one is already open for the (game, playbook, uid)
 * it's returned unchanged. Returns { case, created } so callers can count new opens.
 */
export function openCase(input: OpenCaseInput): { case: CareCase; created: boolean } {
  const existing = findOpenCase(input.gameId, input.playbookId, input.uid);
  if (existing) return { case: existing, created: false };

  const now = new Date().toISOString();
  const id = randomUUID();
  const snapshot = input.statsSnapshot != null ? JSON.stringify(input.statsSnapshot) : null;

  const db = getDb();
  try {
    db.prepare(
      `INSERT INTO care_cases
         (id, game_id, workspace, playbook_id, uid, source, opened_at,
          stats_snapshot_json, status, kpi_target, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)`,
    ).run(
      id, input.gameId, input.workspace, input.playbookId, input.uid, input.source,
      now, snapshot, input.kpiTarget ?? null, now, now,
    );
  } catch (err) {
    // Concurrent sweep raced us to the unique open slot — return the winner.
    const raced = findOpenCase(input.gameId, input.playbookId, input.uid);
    if (raced) return { case: raced, created: false };
    throw err;
  }
  return { case: getCase(id)!, created: true };
}

export function getCase(id: string): CareCase | undefined {
  return getDb().prepare('SELECT * FROM care_cases WHERE id = ?').get(id) as CareCase | undefined;
}

export interface ListCasesFilter {
  gameId: string;
  /** Single id or a set — a set produces `playbook_id IN (...)`. */
  playbookId?: string | string[];
  /** Single status or a set — a set produces `status IN (...)`. */
  status?: CaseStatus | CaseStatus[];
  uid?: string;
}

/** Push either an `= ?` or an `IN (?,…)` clause for a scalar-or-array filter. */
function pushInClause(
  clauses: string[],
  params: unknown[],
  column: string,
  value: string | string[] | undefined,
): void {
  if (value == null) return;
  const vals = Array.isArray(value) ? value : [value];
  if (vals.length === 0) return;
  if (vals.length === 1) {
    clauses.push(`${column} = ?`);
    params.push(vals[0]);
  } else {
    clauses.push(`${column} IN (${vals.map(() => '?').join(',')})`);
    params.push(...vals);
  }
}

export function listCases(f: ListCasesFilter): CareCase[] {
  const clauses = ['game_id = ?'];
  const params: unknown[] = [f.gameId];
  pushInClause(clauses, params, 'playbook_id', f.playbookId);
  pushInClause(clauses, params, 'status', f.status);
  if (f.uid) {
    clauses.push('uid = ?');
    params.push(f.uid);
  }
  return getDb()
    .prepare(`SELECT * FROM care_cases WHERE ${clauses.join(' AND ')} ORDER BY opened_at DESC`)
    .all(...params) as CareCase[];
}

/** All cases for one user across playbooks (Member-360 Care history). */
export function casesForUid(gameId: string, uid: string): CareCase[] {
  return listCases({ gameId, uid });
}

export interface PatchCaseInput {
  status?: CaseStatus;
  assignee?: string | null;
  channelUsed?: string | null;
  actionTaken?: string | null;
  notes?: string | null;
  outcome?: CaseOutcome | null;
  kpiEvalAt?: string | null;
  conditionLapsed?: boolean;
}

/**
 * Patch a case. Stamps treated_at when transitioning to 'treated' and closed_at
 * when transitioning to a terminal state, so callers needn't set timestamps.
 */
export function patchCase(id: string, patch: PatchCaseInput): CareCase | undefined {
  const cur = getCase(id);
  if (!cur) return undefined;

  const now = new Date().toISOString();
  const sets: string[] = ['updated_at = ?'];
  const params: unknown[] = [now];

  const push = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    params.push(val);
  };

  if (patch.status !== undefined) {
    push('status', patch.status);
    if (patch.status === 'treated' && !cur.treated_at) push('treated_at', now);
    if ((patch.status === 'resolved' || patch.status === 'dismissed') && !cur.closed_at) {
      push('closed_at', now);
    }
  }
  if (patch.assignee !== undefined) push('assignee', patch.assignee);
  if (patch.channelUsed !== undefined) push('channel_used', patch.channelUsed);
  if (patch.actionTaken !== undefined) push('action_taken', patch.actionTaken);
  if (patch.notes !== undefined) push('notes', patch.notes);
  if (patch.outcome !== undefined) push('outcome', patch.outcome);
  if (patch.kpiEvalAt !== undefined) push('kpi_eval_at', patch.kpiEvalAt);
  if (patch.conditionLapsed !== undefined) push('condition_lapsed', patch.conditionLapsed ? 1 : 0);

  getDb()
    .prepare(`UPDATE care_cases SET ${sets.join(', ')} WHERE id = ?`)
    .run(...params, id);
  return getCase(id);
}
