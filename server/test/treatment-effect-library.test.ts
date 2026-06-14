/**
 * Tests for treatment-effect-library.ts — seed read, best-confidence selection,
 * getPrior null on miss, recordResult stub throws.
 *
 * Uses an in-memory SQLite DB; applies only the 053 migration so the test is
 * isolated from schema changes in other migrations.
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, closeDb } from '../src/db/sqlite.js';
import {
  getPrior,
  listPriors,
  recordResult,
} from '../src/advisor/treatment-effect-library.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database;

beforeAll(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const sql = readFileSync(
    join(__dirname, '..', 'src', 'db', 'migrations', '053-treatment-effect-library.sql'),
    'utf8',
  );
  db.exec(sql);
  setDb(db);
});

afterAll(() => {
  closeDb();
});

describe('getPrior', () => {
  it('returns the win-back seed for cfm_vn churn-risk', () => {
    const prior = getPrior('cfm_vn', 'churn-risk', 'win-back');
    expect(prior).not.toBeNull();
    expect(prior!.value).toBeCloseTo(0.06, 5);
    expect(prior!.confidence).toBe('assumption');
    expect(prior!.source).toMatch(/win-back/);
  });

  it('seed is labeled assumption — not measured or benchmark', () => {
    const prior = getPrior('cfm_vn', 'churn-risk', 'win-back');
    expect(prior!.confidence).toBe('assumption');
  });

  it('returns null for unknown (game, shape, lever) triple', () => {
    const prior = getPrior('unknown_game', 'unknown_shape', 'unknown_lever');
    expect(prior).toBeNull();
  });

  it('returns null for partially-matched key', () => {
    // game matches but shape+lever do not
    expect(getPrior('cfm_vn', 'churn-risk', 'nonexistent-lever')).toBeNull();
  });

  it('returns measured confidence after an upsert overwrites an assumption row', () => {
    // The UNIQUE index on (game_id, segment_shape, lever_family) enforces one row
    // per key — the production write path is UPSERT (INSERT OR REPLACE / ON CONFLICT
    // DO UPDATE). This test verifies that after a measured result overwrites an
    // assumption seed, getPrior() returns the measured value.
    const testKey = { game: 'cfm_vn', shape: 'upsert-test-shape', lever: 'upsert-test-lever' };

    // Step 1: insert an assumption seed (simulates day-0 seed)
    db.prepare(
      `INSERT OR IGNORE INTO treatment_effect_library
         (game_id, segment_shape, lever_family, effect_value, confidence, source)
       VALUES (?, ?, ?, ?, 'assumption', 'initial seed')`,
    ).run(testKey.game, testKey.shape, testKey.lever, 0.04);

    const seedPrior = getPrior(testKey.game, testKey.shape, testKey.lever);
    expect(seedPrior!.confidence).toBe('assumption');
    expect(seedPrior!.value).toBeCloseTo(0.04, 5);

    // Step 2: upsert a measured result (simulates the outcome flywheel write-back)
    db.prepare(
      `INSERT INTO treatment_effect_library
         (game_id, segment_shape, lever_family, effect_value, confidence, source, experiment_id)
       VALUES (?, ?, ?, ?, 'measured', 'experiment exp-test-001', 'exp-test-001')
       ON CONFLICT (game_id, segment_shape, lever_family) DO UPDATE SET
         effect_value  = excluded.effect_value,
         confidence    = 'measured',
         source        = excluded.source,
         experiment_id = excluded.experiment_id,
         recorded_at   = datetime('now')`,
    ).run(testKey.game, testKey.shape, testKey.lever, 0.09);

    // Step 3: getPrior should now return the measured value
    const updatedPrior = getPrior(testKey.game, testKey.shape, testKey.lever);
    expect(updatedPrior).not.toBeNull();
    expect(updatedPrior!.confidence).toBe('measured');
    expect(updatedPrior!.value).toBeCloseTo(0.09, 5);
  });

  it('returns the spend-drop-recovery seed for cfm_vn', () => {
    const prior = getPrior('cfm_vn', 'spend-drop', 'spend-drop-recovery');
    expect(prior).not.toBeNull();
    expect(prior!.value).toBeCloseTo(0.08, 5);
  });

  it('jus_vn win-back is labeled benchmark', () => {
    const prior = getPrior('jus_vn', 'churn-risk', 'win-back');
    expect(prior).not.toBeNull();
    expect(prior!.confidence).toBe('benchmark');
  });
});

describe('listPriors', () => {
  it('returns all cfm_vn seeds', () => {
    const rows = listPriors('cfm_vn');
    expect(rows.length).toBeGreaterThanOrEqual(8); // 8 cfm_vn seeds + any test-inserted
    expect(rows.every((r) => r.game_id === 'cfm_vn')).toBe(true);
  });

  it('returns jus_vn seeds', () => {
    const rows = listPriors('jus_vn');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.game_id === 'jus_vn')).toBe(true);
  });

  it('returns empty array for unknown game', () => {
    expect(listPriors('no_such_game')).toEqual([]);
  });
});

describe('recordResult (stub)', () => {
  it('throws a clear not-yet-implemented message', () => {
    expect(() =>
      recordResult({
        gameId: 'cfm_vn',
        segmentShape: 'churn-risk',
        leverFamily: 'win-back',
        observedEffect: 0.07,
        experimentId: 'exp-001',
      }),
    ).toThrow(/stub|not yet built/);
  });
});
