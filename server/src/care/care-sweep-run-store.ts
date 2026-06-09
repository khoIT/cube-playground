/**
 * Sweep-run snapshot store — persists each VIP-care sweep as a run with
 * per-playbook counts and per-uid cohort membership, so the console can show a
 * run timeline, trend cohort sizes, and diff two runs (entered/left set-diff).
 *
 * Mirrors the sibling care stores (getDb() internally; ISO TEXT timestamps).
 * Recording is best-effort at the call site — a failure here must never fail
 * the sweep itself. Retention prune keeps membership short (it's the bulky
 * table) and run/count rows longer.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/sqlite.js';
import type { PlaybookSweepSummary } from './care-case-sweep.js';

export type SweepRunSource = 'manual' | 'cron';
export type SweepRunStatus = 'ok' | 'partial' | 'error';

export interface SweepRunInput {
  game: string;
  workspaceId: string;
  source: SweepRunSource;
  startedAt: string; // ISO
  finishedAt: string; // ISO
  openedTotal: number;
  lapsedTotal: number;
  profilesRefreshed: number;
}

export interface SweepRun extends SweepRunInput {
  runId: string;
  status: SweepRunStatus;
}

interface RunRow {
  run_id: string;
  game: string;
  workspace_id: string;
  source: SweepRunSource;
  status: SweepRunStatus;
  started_at: string;
  finished_at: string;
  opened_total: number;
  lapsed_total: number;
  profiles_refreshed: number;
}

function toRun(r: RunRow): SweepRun {
  return {
    runId: r.run_id,
    game: r.game,
    workspaceId: r.workspace_id,
    source: r.source,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    openedTotal: r.opened_total,
    lapsedTotal: r.lapsed_total,
    profilesRefreshed: r.profiles_refreshed,
  };
}

/** A summary's status contribution: any query-failed playbook → the run is 'partial'. */
export function deriveRunStatus(summaries: PlaybookSweepSummary[]): SweepRunStatus {
  return summaries.some((s) => s.skipped === 'query-failed') ? 'partial' : 'ok';
}

/**
 * Persist one sweep run + its per-playbook results + per-uid membership in a
 * single transaction. Returns the generated run_id. The whole sweep
 * (run row, every playbook result, all membership) commits atomically or not
 * at all, so a partial record can't leave dangling rows.
 */
export function recordSweep(input: SweepRunInput, summaries: PlaybookSweepSummary[]): string {
  const db = getDb();
  const runId = randomUUID();
  const status = deriveRunStatus(summaries);

  const insertRun = db.prepare(`
    INSERT INTO care_sweep_runs
      (run_id, game, workspace_id, source, status, started_at, finished_at,
       opened_total, lapsed_total, profiles_refreshed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertResult = db.prepare(`
    INSERT INTO care_sweep_playbook_results
      (run_id, playbook_id, cohort_size, opened, lapsed, already_open, skipped)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMember = db.prepare(`
    INSERT OR IGNORE INTO care_sweep_membership (run_id, playbook_id, uid)
    VALUES (?, ?, ?)
  `);

  const txn = db.transaction(() => {
    insertRun.run(
      runId, input.game, input.workspaceId, input.source, status,
      input.startedAt, input.finishedAt,
      input.openedTotal, input.lapsedTotal, input.profilesRefreshed,
    );
    for (const s of summaries) {
      insertResult.run(
        runId, s.playbookId, s.cohortSize, s.opened, s.lapsed, s.alreadyOpen, s.skipped ?? null,
      );
      // Membership only for non-skipped playbooks that carry their matched cohort.
      for (const uid of s.uids ?? []) {
        insertMember.run(runId, s.playbookId, uid);
      }
    }
  });
  txn();
  return runId;
}

/**
 * Record a sweep that failed before producing summaries (Cube unreachable, /meta
 * failed). Just a run row with status='error' and zero counts, so unattended
 * cron failures are observable in the run timeline. No results/membership.
 */
export function recordFailedSweep(
  input: Omit<SweepRunInput, 'openedTotal' | 'lapsedTotal' | 'profilesRefreshed'>,
): string {
  const runId = randomUUID();
  getDb()
    .prepare(`
      INSERT INTO care_sweep_runs
        (run_id, game, workspace_id, source, status, started_at, finished_at,
         opened_total, lapsed_total, profiles_refreshed)
      VALUES (?, ?, ?, ?, 'error', ?, ?, 0, 0, 0)
    `)
    .run(runId, input.game, input.workspaceId, input.source, input.startedAt, input.finishedAt);
  return runId;
}

/** Most-recent runs for a game (newest first), capped. */
export function listSweepRuns(game: string, workspaceId: string, limit = 50): SweepRun[] {
  const rows = getDb()
    .prepare(`
      SELECT * FROM care_sweep_runs
       WHERE game = ? AND workspace_id = ?
       ORDER BY started_at DESC
       LIMIT ?
    `)
    .all(game, workspaceId, Math.max(1, Math.min(500, limit))) as RunRow[];
  return rows.map(toRun);
}

export function getSweepRun(runId: string): SweepRun | null {
  const r = getDb().prepare(`SELECT * FROM care_sweep_runs WHERE run_id = ?`).get(runId) as
    | RunRow
    | undefined;
  return r ? toRun(r) : null;
}

// ── Trend / diff reads (Sweeps comparison surface) ────────────────────────────

export interface TrendPoint {
  runId: string;
  startedAt: string;
  cohortSize: number;
}
export interface PlaybookTrend {
  playbookId: string;
  points: TrendPoint[];
}

/** Cohort size per playbook across runs (oldest→newest), for the trend view. */
export function trendByPlaybook(game: string, workspaceId: string, playbookId?: string): PlaybookTrend[] {
  const rows = getDb()
    .prepare(`
      SELECT pr.playbook_id, pr.run_id, r.started_at, pr.cohort_size
        FROM care_sweep_playbook_results pr
        JOIN care_sweep_runs r ON r.run_id = pr.run_id
       WHERE r.game = ? AND r.workspace_id = ?
         ${playbookId ? 'AND pr.playbook_id = ?' : ''}
       ORDER BY pr.playbook_id, r.started_at ASC
    `)
    .all(...(playbookId ? [game, workspaceId, playbookId] : [game, workspaceId])) as Array<{
      playbook_id: string;
      run_id: string;
      started_at: string;
      cohort_size: number;
    }>;

  const byPb = new Map<string, PlaybookTrend>();
  for (const r of rows) {
    let t = byPb.get(r.playbook_id);
    if (!t) {
      t = { playbookId: r.playbook_id, points: [] };
      byPb.set(r.playbook_id, t);
    }
    t.points.push({ runId: r.run_id, startedAt: r.started_at, cohortSize: r.cohort_size });
  }
  return [...byPb.values()];
}

/**
 * True when a run's membership snapshot is still present — i.e. it has membership
 * rows, OR it legitimately had no cohort (so absence isn't due to pruning).
 */
function membershipAvailable(runId: string): boolean {
  const db = getDb();
  const hasMembers = db.prepare(`SELECT 1 FROM care_sweep_membership WHERE run_id = ? LIMIT 1`).get(runId);
  if (hasMembers) return true;
  const cohort = db
    .prepare(`SELECT COALESCE(SUM(cohort_size), 0) AS n FROM care_sweep_playbook_results WHERE run_id = ?`)
    .get(runId) as { n: number };
  return cohort.n === 0; // no cohort → nothing to snapshot, not pruned
}

export interface PlaybookDiff {
  playbookId: string;
  cohortA: number;
  cohortB: number;
  cohortDelta: number;
  enteredCount: number; // in B, not in A
  leftCount: number; // in A, not in B
}
export interface SweepDiff {
  membershipAvailable: boolean;
  playbooks: PlaybookDiff[];
}

function exceptCount(fromRun: string, otherRun: string, playbookId: string): number {
  const row = getDb()
    .prepare(`
      SELECT COUNT(*) AS n FROM (
        SELECT uid FROM care_sweep_membership WHERE run_id = ? AND playbook_id = ?
        EXCEPT
        SELECT uid FROM care_sweep_membership WHERE run_id = ? AND playbook_id = ?
      )
    `)
    .get(fromRun, playbookId, otherRun, playbookId) as { n: number };
  return row.n;
}

/** Per-playbook count + entered/left deltas between two runs of the same game. */
export function diffCounts(runA: string, runB: string): SweepDiff {
  const db = getDb();
  const resultsFor = (runId: string) =>
    db
      .prepare(`SELECT playbook_id, cohort_size FROM care_sweep_playbook_results WHERE run_id = ?`)
      .all(runId) as Array<{ playbook_id: string; cohort_size: number }>;

  const a = new Map(resultsFor(runA).map((r) => [r.playbook_id, r.cohort_size]));
  const b = new Map(resultsFor(runB).map((r) => [r.playbook_id, r.cohort_size]));
  const available = membershipAvailable(runA) && membershipAvailable(runB);

  const playbookIds = [...new Set([...a.keys(), ...b.keys()])].sort();
  const playbooks: PlaybookDiff[] = playbookIds.map((p) => {
    const cohortA = a.get(p) ?? 0;
    const cohortB = b.get(p) ?? 0;
    return {
      playbookId: p,
      cohortA,
      cohortB,
      cohortDelta: cohortB - cohortA,
      enteredCount: available ? exceptCount(runB, runA, p) : 0,
      leftCount: available ? exceptCount(runA, runB, p) : 0,
    };
  });
  return { membershipAvailable: available, playbooks };
}

export interface DiffMembersPage {
  uids: string[];
  total: number;
  membershipAvailable: boolean;
}

/**
 * Paginated entered (B\A) or left (A\B) uids for one playbook — the drill-to-VIPs
 * list. `direction='entered'` ⇒ in runB not runA; `'left'` ⇒ in runA not runB.
 */
export function diffMembers(
  runA: string,
  runB: string,
  playbookId: string,
  direction: 'entered' | 'left',
  page: number,
  pageSize: number,
): DiffMembersPage {
  const available = membershipAvailable(runA) && membershipAvailable(runB);
  if (!available) return { uids: [], total: 0, membershipAvailable: false };

  const [from, other] = direction === 'entered' ? [runB, runA] : [runA, runB];
  const db = getDb();
  const except = `
    SELECT uid FROM care_sweep_membership WHERE run_id = ? AND playbook_id = ?
    EXCEPT
    SELECT uid FROM care_sweep_membership WHERE run_id = ? AND playbook_id = ?
  `;
  const total = (
    db.prepare(`SELECT COUNT(*) AS n FROM (${except})`).get(from, playbookId, other, playbookId) as { n: number }
  ).n;
  const uids = (
    db
      .prepare(`${except} ORDER BY uid LIMIT ? OFFSET ?`)
      .all(from, playbookId, other, playbookId, pageSize, (page - 1) * pageSize) as Array<{ uid: string }>
  ).map((r) => r.uid);
  return { uids, total, membershipAvailable: true };
}

// ── Retention prune ───────────────────────────────────────────────────────────

/** Delete membership rows for runs that started before the cutoff (ISO). */
export function pruneMembershipBefore(cutoffIso: string): number {
  return getDb()
    .prepare(`
      DELETE FROM care_sweep_membership
       WHERE run_id IN (SELECT run_id FROM care_sweep_runs WHERE started_at < ?)
    `)
    .run(cutoffIso).changes;
}

/** Delete runs older than the cutoff (ISO); FK CASCADE removes their results + membership. */
export function pruneRunsBefore(cutoffIso: string): number {
  return getDb()
    .prepare(`DELETE FROM care_sweep_runs WHERE started_at < ?`)
    .run(cutoffIso).changes;
}
