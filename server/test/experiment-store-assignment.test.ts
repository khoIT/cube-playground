/**
 * Experiment registry + assignment freeze — CRUD round-trips, deterministic
 * frozen arms, cohort cap truncation, idempotent re-assign, and the
 * cohort-empty guard. Runs on an in-memory DB with a seeded source segment.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, closeDb, getDb } from '../src/db/sqlite.js';
import {
  createExperiment,
  getExperiment,
  listExperiments,
  patchExperiment,
  armUids,
  armCounts,
  clearExperiments,
} from '../src/experiments/experiment-store.js';
import {
  assignExperiment,
  CohortEmptyError,
  ExperimentNotFoundError,
} from '../src/experiments/assignment-service.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

function seedSegment(id: string, gameId: string, uids: string[]): void {
  getDb()
    .prepare(
      `INSERT INTO segments (id, name, type, owner, game_id, uid_count, uid_list_json)
       VALUES (?, ?, 'predicate', 'tester@corp.com', ?, ?, ?)`,
    )
    .run(id, `seg ${id}`, gameId, uids.length, JSON.stringify(uids));
}

const ASOF = '2026-06-15T00:00:00.000Z';

describe('experiment-store + assignment', () => {
  beforeEach(() => {
    setDb(makeMemDb());
    seedSegment('seg-1', 'cfm_vn', Array.from({ length: 500 }, (_, i) => `u${i}`));
  });
  afterEach(() => closeDb());

  it('creates a draft and round-trips it', () => {
    const exp = createExperiment({
      gameId: 'cfm_vn',
      name: 'Win-back lapsed payers',
      segmentId: 'seg-1',
      splitPct: 50,
      windowDays: 14,
    });
    expect(exp.status).toBe('draft');
    expect(getExperiment(exp.id)?.name).toBe('Win-back lapsed payers');
    expect(listExperiments('cfm_vn')).toHaveLength(1);
    expect(listExperiments('jus_vn')).toHaveLength(0);
  });

  it('patches draft params', () => {
    const exp = createExperiment({ gameId: 'cfm_vn', name: 'X test', segmentId: 'seg-1' });
    const patched = patchExperiment(exp.id, { splitPct: 30, windowDays: 21 });
    expect(patched?.splitPct).toBe(30);
    expect(patched?.windowDays).toBe(21);
  });

  it('freezes a deterministic split and stamps running', () => {
    const exp = createExperiment({ gameId: 'cfm_vn', name: 'Freeze test', segmentId: 'seg-1', splitPct: 50 });
    const r = assignExperiment(exp.id, ASOF);
    expect(r.total).toBe(500);
    expect(r.treatment + r.control).toBe(500);
    expect(r.capped).toBe(false);
    expect(getExperiment(exp.id)?.status).toBe('running');
    expect(getExperiment(exp.id)?.assignedAt).toBe(ASOF);

    // Arms persisted + readable; counts match.
    const counts = armCounts(exp.id);
    expect(counts.treatment + counts.control).toBe(500);
    expect(armUids(exp.id, 'treatment').length).toBe(counts.treatment);
  });

  it('caps the cohort at cohort_cap', () => {
    seedSegment('seg-big', 'cfm_vn', Array.from({ length: 5000 }, (_, i) => `b${i}`));
    const exp = createExperiment({
      gameId: 'cfm_vn',
      name: 'Capped',
      segmentId: 'seg-big',
      cohortCap: 1000,
    });
    const r = assignExperiment(exp.id, ASOF);
    expect(r.capped).toBe(true);
    expect(r.total).toBe(1000);
  });

  it('is idempotent: re-assigning a running experiment returns existing counts', () => {
    const exp = createExperiment({ gameId: 'cfm_vn', name: 'Idem', segmentId: 'seg-1' });
    const first = assignExperiment(exp.id, ASOF);
    const second = assignExperiment(exp.id, '2026-07-01T00:00:00.000Z');
    expect(second.treatment).toBe(first.treatment);
    expect(second.control).toBe(first.control);
    // assigned_at not overwritten on the no-op re-assign.
    expect(getExperiment(exp.id)?.assignedAt).toBe(ASOF);
  });

  it('rejects assigning when the source segment has no members', () => {
    seedSegment('seg-empty', 'cfm_vn', []);
    const exp = createExperiment({ gameId: 'cfm_vn', name: 'Empty', segmentId: 'seg-empty' });
    expect(() => assignExperiment(exp.id, ASOF)).toThrow(CohortEmptyError);
  });

  it('throws for an unknown experiment', () => {
    expect(() => assignExperiment('nope', ASOF)).toThrow(ExperimentNotFoundError);
  });

  it('clearExperiments wipes both tables', () => {
    const exp = createExperiment({ gameId: 'cfm_vn', name: 'C', segmentId: 'seg-1' });
    assignExperiment(exp.id, ASOF);
    clearExperiments();
    expect(listExperiments('cfm_vn')).toHaveLength(0);
    expect(armUids(exp.id, 'treatment')).toHaveLength(0);
  });
});
