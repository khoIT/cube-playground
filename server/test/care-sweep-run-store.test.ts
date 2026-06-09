/**
 * Sweep-run snapshot store: record run + per-playbook results + per-uid
 * membership atomically; status derivation; list/get scoping; retention prune
 * (membership short horizon, runs long horizon w/ FK cascade).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb, setDb, closeDb } from '../src/db/sqlite.js';
import {
  recordSweep,
  listSweepRuns,
  getSweepRun,
  deriveRunStatus,
  pruneMembershipBefore,
  pruneRunsBefore,
  trendByPlaybook,
  diffCounts,
  diffMembers,
} from '../src/care/care-sweep-run-store.js';
import type { PlaybookSweepSummary } from '../src/care/care-case-sweep.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

const RUN = (startedAt: string, source: 'manual' | 'cron' = 'manual') => ({
  game: 'cfm_vn',
  workspaceId: 'local',
  source,
  startedAt,
  finishedAt: startedAt,
  openedTotal: 3,
  lapsedTotal: 1,
  profilesRefreshed: 2,
});

const SUMMARIES: PlaybookSweepSummary[] = [
  { playbookId: '01', cohortSize: 2, opened: 2, lapsed: 0, alreadyOpen: 0, uids: ['a', 'b'] },
  { playbookId: '02', cohortSize: 1, opened: 1, lapsed: 1, alreadyOpen: 0, uids: ['a'] },
  { playbookId: '11', cohortSize: 0, opened: 0, lapsed: 0, alreadyOpen: 0, skipped: 'query-failed' },
];

describe('deriveRunStatus', () => {
  it('partial when any playbook query-failed, else ok', () => {
    expect(deriveRunStatus(SUMMARIES)).toBe('partial');
    expect(deriveRunStatus(SUMMARIES.slice(0, 2))).toBe('ok');
  });
});

describe('recordSweep / list / get', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => closeDb());

  it('persists run, per-playbook results, and membership for non-skipped only', () => {
    const runId = recordSweep(RUN('2026-06-09T00:00:00Z'), SUMMARIES);

    const run = getSweepRun(runId)!;
    expect(run.status).toBe('partial'); // 11 query-failed
    expect(run.openedTotal).toBe(3);

    const results = getDb()
      .prepare('SELECT * FROM care_sweep_playbook_results WHERE run_id = ? ORDER BY playbook_id')
      .all(runId) as Array<{ playbook_id: string; skipped: string | null }>;
    expect(results.map((r) => r.playbook_id)).toEqual(['01', '02', '11']); // all incl skipped
    expect(results.find((r) => r.playbook_id === '11')!.skipped).toBe('query-failed');

    const members = getDb()
      .prepare('SELECT playbook_id, uid FROM care_sweep_membership WHERE run_id = ? ORDER BY playbook_id, uid')
      .all(runId) as Array<{ playbook_id: string; uid: string }>;
    // 01 → a,b ; 02 → a ; 11 → none (skipped). Total 3.
    expect(members).toEqual([
      { playbook_id: '01', uid: 'a' },
      { playbook_id: '01', uid: 'b' },
      { playbook_id: '02', uid: 'a' },
    ]);
  });

  it('lists newest-first, scoped by game + workspace', () => {
    recordSweep(RUN('2026-06-07T00:00:00Z'), SUMMARIES.slice(0, 1));
    recordSweep(RUN('2026-06-09T00:00:00Z'), SUMMARIES.slice(0, 1));
    recordSweep({ ...RUN('2026-06-08T00:00:00Z'), game: 'jus_vn' }, SUMMARIES.slice(0, 1));

    const runs = listSweepRuns('cfm_vn', 'local');
    expect(runs).toHaveLength(2);
    expect(runs[0].startedAt > runs[1].startedAt).toBe(true); // newest first
    expect(listSweepRuns('cfm_vn', 'other')).toHaveLength(0); // workspace-scoped
  });
});

describe('trend / diff reads', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => closeDb());

  const pb = (id: string, uids: string[]): PlaybookSweepSummary => ({
    playbookId: id, cohortSize: uids.length, opened: uids.length, lapsed: 0, alreadyOpen: 0, uids,
  });

  it('trend orders points oldest→newest per playbook', () => {
    recordSweep(RUN('2026-06-07T00:00:00Z'), [pb('01', ['a'])]);
    recordSweep(RUN('2026-06-09T00:00:00Z'), [pb('01', ['a', 'b'])]);

    const trends = trendByPlaybook('cfm_vn', 'local');
    const t01 = trends.find((t) => t.playbookId === '01')!;
    expect(t01.points.map((p) => p.cohortSize)).toEqual([1, 2]); // time-ordered
    expect(t01.points[0].startedAt < t01.points[1].startedAt).toBe(true);
  });

  it('diff computes entered=B\\A and left=A\\B per playbook', () => {
    const runA = recordSweep(RUN('2026-06-08T00:00:00Z'), [pb('01', ['a', 'b'])]);
    const runB = recordSweep(RUN('2026-06-09T00:00:00Z'), [pb('01', ['b', 'c'])]);

    const diff = diffCounts(runA, runB);
    expect(diff.membershipAvailable).toBe(true);
    const d01 = diff.playbooks.find((p) => p.playbookId === '01')!;
    expect(d01.enteredCount).toBe(1); // c entered
    expect(d01.leftCount).toBe(1); // a left

    const entered = diffMembers(runA, runB, '01', 'entered', 1, 50);
    expect(entered.uids).toEqual(['c']);
    const left = diffMembers(runA, runB, '01', 'left', 1, 50);
    expect(left.uids).toEqual(['a']);
  });

  it('degrades to counts-only when a run\'s membership was pruned', () => {
    const runA = recordSweep(RUN('2026-06-08T00:00:00Z'), [pb('01', ['a', 'b'])]);
    const runB = recordSweep(RUN('2026-06-09T00:00:00Z'), [pb('01', ['b', 'c'])]);
    // Simulate prune: drop runA's membership but keep its count row (cohort 2 > 0).
    getDb().prepare('DELETE FROM care_sweep_membership WHERE run_id = ?').run(runA);

    const diff = diffCounts(runA, runB);
    expect(diff.membershipAvailable).toBe(false); // runA membership gone
    const d01 = diff.playbooks.find((p) => p.playbookId === '01')!;
    expect(d01.cohortA).toBe(2); // counts still available from playbook_results
    expect(d01.enteredCount).toBe(0); // can't set-diff
    expect(diffMembers(runA, runB, '01', 'entered', 1, 50).membershipAvailable).toBe(false);
  });
});

describe('retention prune', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => closeDb());

  it('prunes membership before cutoff, keeps the run + counts', () => {
    const oldRun = recordSweep(RUN('2026-01-01T00:00:00Z'), SUMMARIES.slice(0, 1)); // a,b
    recordSweep(RUN('2026-06-09T00:00:00Z'), SUMMARIES.slice(0, 1));

    const removed = pruneMembershipBefore('2026-02-01T00:00:00Z');
    expect(removed).toBe(2); // old run's a,b
    expect(getSweepRun(oldRun)).not.toBeNull(); // run row survives
    const remaining = getDb().prepare('SELECT COUNT(*) n FROM care_sweep_membership').get() as { n: number };
    expect(remaining.n).toBe(2); // only the recent run's membership
  });

  it('prunes old runs and cascades their results + membership', () => {
    recordSweep(RUN('2026-01-01T00:00:00Z'), SUMMARIES);
    const removed = pruneRunsBefore('2026-02-01T00:00:00Z');
    expect(removed).toBe(1);
    const m = getDb().prepare('SELECT COUNT(*) n FROM care_sweep_membership').get() as { n: number };
    const r = getDb().prepare('SELECT COUNT(*) n FROM care_sweep_playbook_results').get() as { n: number };
    expect(m.n).toBe(0); // CASCADE
    expect(r.n).toBe(0); // CASCADE
  });
});
