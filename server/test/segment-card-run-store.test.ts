/**
 * Persisted card-pass history (segment_card_run): record, newest-first listing,
 * and keep-last-N pruning per segment.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { setDb, closeDb, getDb } from '../src/db/sqlite.js';
import {
  recordCardRun,
  listCardRuns,
  KEEP_RUNS_PER_SEGMENT,
} from '../src/services/segment-card-run-store.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '../src/db/migrations');

function makeMemDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

function run(segmentId: string, startedAt: string, overrides: Partial<Parameters<typeof recordCardRun>[0]> = {}) {
  recordCardRun({
    segmentId,
    startedAt,
    finishedAt: startedAt,
    source: 'cron',
    total: 33,
    ok: 33,
    failed: 0,
    failingCards: [],
    ...overrides,
  });
}

describe('segment-card-run-store', () => {
  beforeEach(() => {
    setDb(makeMemDb());
  });
  afterEach(() => {
    closeDb();
  });

  it('records a pass and reads it back with failing cards', () => {
    run('seg-a', '2026-06-13T00:00:00.000Z', {
      source: 'manual',
      ok: 26,
      failed: 7,
      failingCards: [{ cardId: 'retention-d7', error: 'timed out after 4s' }],
    });

    const runs = listCardRuns('seg-a');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      segmentId: 'seg-a',
      source: 'manual',
      total: 33,
      ok: 26,
      failed: 7,
      runError: null,
    });
    expect(runs[0].failingCards).toEqual([{ cardId: 'retention-d7', error: 'timed out after 4s' }]);
  });

  it('lists newest first and prunes to the retention cap per segment', () => {
    for (let i = 0; i < KEEP_RUNS_PER_SEGMENT + 3; i++) {
      run('seg-a', `2026-06-13T0${i}:00:00.000Z`);
    }
    // Another segment's history must be untouched by seg-a's pruning.
    run('seg-b', '2026-06-13T00:30:00.000Z');

    const runs = listCardRuns('seg-a', 100);
    expect(runs).toHaveLength(KEEP_RUNS_PER_SEGMENT);
    expect(runs[0].startedAt > runs[runs.length - 1].startedAt).toBe(true);
    // The oldest surviving run is the (total - cap)th — earlier ones pruned.
    expect(runs[runs.length - 1].startedAt).toBe('2026-06-13T03:00:00.000Z');
    expect(listCardRuns('seg-b')).toHaveLength(1);
  });

  it('records a pass-level error with partial tallies', () => {
    run('seg-a', '2026-06-13T00:00:00.000Z', {
      total: 10,
      ok: 4,
      failed: 2,
      runError: 'card-runner exploded mid-pass',
    });
    const [r] = listCardRuns('seg-a');
    expect(r.runError).toBe('card-runner exploded mid-pass');
    expect(r.ok + r.failed).toBeLessThan(r.total);
  });

  it('never throws on a corrupt failing_cards_json row', () => {
    run('seg-a', '2026-06-13T00:00:00.000Z');
    getDb()
      .prepare('UPDATE segment_card_run SET failing_cards_json = ? WHERE segment_id = ?')
      .run('{not json', 'seg-a');
    expect(listCardRuns('seg-a')[0].failingCards).toEqual([]);
  });
});
