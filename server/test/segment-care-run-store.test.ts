/**
 * Care precompute run history (segment_care_run): record, newest-first listing,
 * optional per-segment scoping, and keep-last-N retention.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setDb, closeDb } from '../src/db/sqlite.js';
import {
  recordCareRun,
  listCareRuns,
  KEEP_RUNS_PER_SEGMENT,
} from '../src/db/segment-care-run-store.js';

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

function run(segmentId: string, startedAt: string, overrides: Partial<Parameters<typeof recordCareRun>[0]> = {}) {
  recordCareRun({
    segmentId,
    gameId: 'cfm_vn',
    source: 'cron',
    startedAt,
    finishedAt: startedAt,
    status: 'ok',
    tickets: 10,
    contacted: 3,
    elapsedMs: 1234,
    ...overrides,
  });
}

describe('segment-care-run-store', () => {
  beforeEach(() => setDb(makeMemDb()));
  afterEach(() => closeDb());

  it('records a pass and reads it back', () => {
    run('seg-a', '2026-06-14T03:00:00.000Z', { source: 'manual', tickets: 42, contacted: 9 });
    const runs = listCareRuns({ segmentId: 'seg-a' });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      segmentId: 'seg-a',
      gameId: 'cfm_vn',
      source: 'manual',
      status: 'ok',
      tickets: 42,
      contacted: 9,
      runError: null,
    });
  });

  it('records an error pass with its message', () => {
    run('seg-a', '2026-06-14T03:00:00.000Z', { status: 'error', runError: 'Trino timeout', tickets: null, contacted: null });
    const [r] = listCareRuns({ segmentId: 'seg-a' });
    expect(r.status).toBe('error');
    expect(r.runError).toBe('Trino timeout');
  });

  it('lists newest-first and prunes to the retention cap per segment', () => {
    for (let i = 0; i < KEEP_RUNS_PER_SEGMENT + 3; i++) {
      run('seg-a', `2026-06-14T0${i}:00:00.000Z`);
    }
    run('seg-b', '2026-06-14T00:30:00.000Z');

    const runs = listCareRuns({ segmentId: 'seg-a', limit: 100 });
    expect(runs).toHaveLength(KEEP_RUNS_PER_SEGMENT);
    expect(runs[0].startedAt > runs[runs.length - 1].startedAt).toBe(true);
    // seg-b is untouched by seg-a's pruning.
    expect(listCareRuns({ segmentId: 'seg-b' })).toHaveLength(1);
  });

  it('lists across all segments when unscoped', () => {
    run('seg-a', '2026-06-14T01:00:00.000Z');
    run('seg-b', '2026-06-14T02:00:00.000Z');
    const all = listCareRuns({});
    expect(all.map((r) => r.segmentId)).toEqual(['seg-b', 'seg-a']); // newest first
  });
});
