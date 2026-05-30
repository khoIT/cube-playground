/**
 * Store tests for metric_drift_run. Real :memory: DB seeded with all migrations
 * (never top-level env mutation — see lessons-learned).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  recordDriftRun,
  listDriftRuns,
  latestDriftRun,
  type DriftRunInput,
} from '../src/db/metric-drift-run-store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function buildDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

let db: Database.Database;
beforeEach(() => { db = buildDb(); });
afterEach(() => db.close());

const RUN = (startedAt: string, over: Partial<DriftRunInput> = {}): DriftRunInput => ({
  game: 'ballistar',
  source: 'detector',
  status: 'ok',
  startedAt,
  finishedAt: startedAt,
  totalUnresolved: 0,
  rootCauseCount: 0,
  newCount: 0,
  resolvedCount: 0,
  cubeMissing: 0,
  memberMissing: 0,
  unparseable: 0,
  ...over,
});

describe('metric-drift-run-store', () => {
  it('records a run and reads it back with the inserted id + fields', () => {
    const run = recordDriftRun(db, RUN('2026-05-30T03:00:00.000Z', {
      totalUnresolved: 21, rootCauseCount: 18, newCount: 2, resolvedCount: 1,
      cubeMissing: 4, memberMissing: 16, unparseable: 1,
    }));
    expect(run.id).toBeGreaterThan(0);
    const latest = latestDriftRun(db, 'ballistar');
    expect(latest).toMatchObject({
      totalUnresolved: 21, rootCauseCount: 18, newCount: 2, resolvedCount: 1,
      cubeMissing: 4, memberMissing: 16, unparseable: 1, status: 'ok', source: 'detector',
    });
  });

  it('lists newest-first and honours the limit', () => {
    recordDriftRun(db, RUN('2026-05-30T03:00:00.000Z', { totalUnresolved: 18 }));
    recordDriftRun(db, RUN('2026-05-30T09:00:00.000Z', { totalUnresolved: 19 }));
    recordDriftRun(db, RUN('2026-05-30T15:00:00.000Z', { totalUnresolved: 21 }));

    const all = listDriftRuns(db, 'ballistar', 10);
    expect(all.map((r) => r.totalUnresolved)).toEqual([21, 19, 18]); // newest first
    expect(listDriftRuns(db, 'ballistar', 2).map((r) => r.totalUnresolved)).toEqual([21, 19]);
    expect(latestDriftRun(db, 'ballistar')?.totalUnresolved).toBe(21);
  });

  it('scopes by game and returns null when a game has no runs', () => {
    recordDriftRun(db, RUN('2026-05-30T03:00:00.000Z', { game: 'ballistar' }));
    expect(listDriftRuns(db, 'cfm', 10)).toHaveLength(0);
    expect(latestDriftRun(db, 'cfm')).toBeNull();
  });

  it('persists skipped/error/manual variants', () => {
    recordDriftRun(db, RUN('2026-05-30T03:00:00.000Z', { status: 'skipped' }));
    recordDriftRun(db, RUN('2026-05-30T04:00:00.000Z', { status: 'error' }));
    recordDriftRun(db, RUN('2026-05-30T05:00:00.000Z', { source: 'manual' }));
    const runs = listDriftRuns(db, 'ballistar', 10);
    expect(runs.map((r) => r.status)).toEqual(['ok', 'error', 'skipped']); // newest (manual=ok) first
    expect(runs[0].source).toBe('manual');
  });
});
