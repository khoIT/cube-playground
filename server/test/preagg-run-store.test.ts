/**
 * Tests for preagg-run-store: upsert idempotency, list, getSweepWithItems, prune.
 * Uses an in-memory SQLite database seeded with all migrations (same pattern
 * as anomaly-state-store.test.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { setDb, closeDb } from '../src/db/sqlite.js';
import {
  upsertSweep,
  listSweeps,
  getLatestSweep,
  getSweepWithItems,
  latestSealedByGameCube,
  builtLinesBySweep,
  pruneOlderThan,
} from '../src/db/preagg-run-store.js';
import type { PreaggSweepInput, PreaggSweepItemInput } from '../src/types/preagg-run.js';

const MIGRATIONS_DIR = join(
  dirname(import.meta.url.replace('file://', '')),
  '..',
  'src',
  'db',
  'migrations',
);

function buildTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f: string) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSweepInput(startedAt = '2026-06-10T07:00:00.000Z'): PreaggSweepInput {
  return {
    startedAt,
    endedAt: '2026-06-10T07:06:00.000Z',
    durationMs: 360_000,
    source: 'scheduled',
    gamesCount: 2,
    rollupsTotal: 10,
    sealedCount: 8,
    staleCount: 1,
    failedCount: 1,
    unbuiltCount: 0,
    collectorStatus: 'online',
  };
}

function makeItemInput(sweepId: number, cube = 'active_daily'): PreaggSweepItemInput {
  return {
    sweepId,
    game: 'cfm_vn',
    cube,
    rollup: 'dau_batch',
    outcome: 'sealed',
    serveable: true,
    lastSealedAt: null,
    errorSig: null,
    errorMessage: null,
    observedAt: '2026-06-10T07:06:00.000Z',
    buildMs: null,
    partitionsBuilt: null,
    rollupsBuilt: null,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let db: Database.Database;

beforeEach(() => {
  db = buildTestDb();
  setDb(db);
});

afterEach(() => {
  closeDb();
});

// ---------------------------------------------------------------------------
// upsertSweep
// ---------------------------------------------------------------------------

describe('upsertSweep', () => {
  it('inserts a new sweep and returns it with an id', () => {
    const sweep = upsertSweep(db, makeSweepInput(), []);
    expect(sweep.id).toBeGreaterThan(0);
    expect(sweep.startedAt).toBe('2026-06-10T07:00:00.000Z');
    expect(sweep.sealedCount).toBe(8);
  });

  it('is idempotent on started_at — second call updates counts, not inserts', () => {
    upsertSweep(db, makeSweepInput(), []);
    const updated = upsertSweep(db, { ...makeSweepInput(), sealedCount: 99 }, []);
    expect(updated.sealedCount).toBe(99);

    // Only one row should exist
    const rows = (db.prepare('SELECT COUNT(*) as n FROM preagg_sweep').get() as { n: number }).n;
    expect(rows).toBe(1);
  });

  it('replaces items atomically on re-upsert (no duplicates)', () => {
    const sweep = upsertSweep(db, makeSweepInput(), [makeItemInput(0)]);
    // Re-upsert with 2 items
    upsertSweep(db, makeSweepInput(), [makeItemInput(0), makeItemInput(0, 'mf_users')]);

    const result = getSweepWithItems(db, sweep.id);
    expect(result?.items).toHaveLength(2);
  });

  it('inserts items with correct sweep_id FK', () => {
    const sweep = upsertSweep(db, makeSweepInput(), [makeItemInput(0)]);
    const result = getSweepWithItems(db, sweep.id);

    expect(result?.items[0].sweepId).toBe(sweep.id);
    expect(result?.items[0].cube).toBe('active_daily');
  });
});

// ---------------------------------------------------------------------------
// listSweeps
// ---------------------------------------------------------------------------

describe('latestSealedByGameCube', () => {
  it('returns the newest seal per (game, cube) across sweeps, ignoring null seals', () => {
    const s1 = upsertSweep(db, makeSweepInput('2026-06-10T05:00:00.000Z'), [
      { ...makeItemInput(0), lastSealedAt: '2026-06-10T04:55:00.000Z' },
      { ...makeItemInput(0, 'mf_users'), lastSealedAt: null }, // never sealed → excluded
    ]);
    void s1;
    upsertSweep(db, makeSweepInput('2026-06-10T07:00:00.000Z'), [
      { ...makeItemInput(0), lastSealedAt: '2026-06-10T06:58:00.000Z' }, // newer seal wins
      { ...makeItemInput(0, 'mf_users'), game: 'jus_vn', lastSealedAt: '2026-06-10T06:30:00.000Z' },
    ]);

    const seals = latestSealedByGameCube(db);
    const byKey = new Map(seals.map((s) => [`${s.game}|${s.cube}`, s.lastSealedAt]));
    expect(byKey.get('cfm_vn|active_daily')).toBe('2026-06-10T06:58:00.000Z');
    expect(byKey.get('jus_vn|mf_users')).toBe('2026-06-10T06:30:00.000Z');
    expect(byKey.has('cfm_vn|mf_users')).toBe(false);
  });
});

describe('listSweeps', () => {
  it('returns sweeps newest first', () => {
    upsertSweep(db, makeSweepInput('2026-06-10T05:00:00.000Z'), []);
    upsertSweep(db, makeSweepInput('2026-06-10T06:00:00.000Z'), []);
    upsertSweep(db, makeSweepInput('2026-06-10T07:00:00.000Z'), []);

    const list = listSweeps(db);
    expect(list[0].startedAt).toBe('2026-06-10T07:00:00.000Z');
    expect(list[2].startedAt).toBe('2026-06-10T05:00:00.000Z');
  });

  it('respects the limit parameter', () => {
    upsertSweep(db, makeSweepInput('2026-06-10T05:00:00.000Z'), []);
    upsertSweep(db, makeSweepInput('2026-06-10T06:00:00.000Z'), []);
    upsertSweep(db, makeSweepInput('2026-06-10T07:00:00.000Z'), []);

    expect(listSweeps(db, 2)).toHaveLength(2);
  });

  it('returns empty array when no sweeps exist', () => {
    expect(listSweeps(db)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// builtLinesBySweep — built-work summary for collapsed history rows
// ---------------------------------------------------------------------------

describe('builtLinesBySweep', () => {
  it('returns only items with partitions built, slowest first, keyed by sweep', () => {
    const s1 = upsertSweep(db, makeSweepInput('2026-06-10T05:00:00.000Z'), [
      { ...makeItemInput(0, 'recharge'), game: 'muaw', partitionsBuilt: 1, buildMs: 9_000,
        rollupsBuilt: [{ rollup: 'revenue_daily_by_channel_batch', partitions: 1, buildMs: 9_000 }] },
      { ...makeItemInput(0, 'active_daily'), game: 'cfm_vn', partitionsBuilt: 4, buildMs: 30_000,
        rollupsBuilt: [{ rollup: 'dau_batch', partitions: 4, buildMs: 30_000 }] },
      // sealed but nothing rebuilt — must not appear in the summary
      { ...makeItemInput(0, 'payment'), game: 'jus_vn', partitionsBuilt: 0 },
      makeItemInput(0, 'social'),
    ]);
    const s2 = upsertSweep(db, makeSweepInput('2026-06-10T06:00:00.000Z'), [
      makeItemInput(0, 'active_daily'),
    ]);

    const map = builtLinesBySweep(db, [s1.id, s2.id]);

    const lines = map.get(s1.id);
    expect(lines).toHaveLength(2);
    // slowest (cfm_vn, 30s) first
    expect(lines![0]).toEqual({
      game: 'cfm_vn', cube: 'active_daily', rollups: ['dau_batch'], partitions: 4,
    });
    expect(lines![1]).toEqual({
      game: 'muaw', cube: 'recharge', rollups: ['revenue_daily_by_channel_batch'], partitions: 1,
    });

    // sweep with no built work has no entry at all
    expect(map.has(s2.id)).toBe(false);
  });

  it('returns an empty map for an empty id list', () => {
    expect(builtLinesBySweep(db, []).size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getLatestSweep — backs the collector's snapshot dedup
// ---------------------------------------------------------------------------

describe('getLatestSweep', () => {
  it('returns null when no sweeps exist', () => {
    expect(getLatestSweep(db)).toBeNull();
  });

  it('returns the most recent sweep by started_at', () => {
    upsertSweep(db, makeSweepInput('2026-06-10T05:00:00.000Z'), []);
    upsertSweep(db, makeSweepInput('2026-06-10T07:00:00.000Z'), []);
    upsertSweep(db, makeSweepInput('2026-06-10T06:00:00.000Z'), []);

    expect(getLatestSweep(db)?.startedAt).toBe('2026-06-10T07:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// getSweepWithItems
// ---------------------------------------------------------------------------

describe('getSweepWithItems', () => {
  it('returns null for a non-existent id', () => {
    expect(getSweepWithItems(db, 9999)).toBeNull();
  });

  it('returns sweep with items ordered stale first', () => {
    const sweep = upsertSweep(db, makeSweepInput(), [
      { ...makeItemInput(0, 'cube_a'), outcome: 'sealed' },
      { ...makeItemInput(0, 'cube_b'), outcome: 'stale_serving', serveable: true, errorSig: 'etimedout', errorMessage: 'timeout' },
    ]);

    const result = getSweepWithItems(db, sweep.id)!;
    expect(result.items[0].outcome).toBe('stale_serving');
    expect(result.items[1].outcome).toBe('sealed');
  });
});

// ---------------------------------------------------------------------------
// pruneOlderThan
// ---------------------------------------------------------------------------

describe('pruneOlderThan', () => {
  it('removes sweeps older than cutoff', () => {
    upsertSweep(db, makeSweepInput('2026-05-01T00:00:00.000Z'), []);
    upsertSweep(db, makeSweepInput('2026-06-10T07:00:00.000Z'), []);

    const deleted = pruneOlderThan(db, '2026-06-01T00:00:00.000Z');
    expect(deleted).toBe(1);
    expect(listSweeps(db)).toHaveLength(1);
    expect(listSweeps(db)[0].startedAt).toBe('2026-06-10T07:00:00.000Z');
  });

  it('cascades to items (FK ON DELETE CASCADE)', () => {
    const sweep = upsertSweep(
      db,
      makeSweepInput('2026-05-01T00:00:00.000Z'),
      [makeItemInput(0)],
    );
    pruneOlderThan(db, '2026-06-01T00:00:00.000Z');

    // Verify items also deleted
    const itemCount = (
      db
        .prepare('SELECT COUNT(*) as n FROM preagg_sweep_item WHERE sweep_id = ?')
        .get(sweep.id) as { n: number }
    ).n;
    expect(itemCount).toBe(0);
  });

  it('returns 0 when nothing is old enough to prune', () => {
    upsertSweep(db, makeSweepInput('2026-06-10T07:00:00.000Z'), []);
    expect(pruneOlderThan(db, '2026-01-01T00:00:00.000Z')).toBe(0);
  });
});
