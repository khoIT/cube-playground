/**
 * listSnapshotRuns — grouping of the per-instance snapshot heartbeat log into
 * one row per run: sentinel handling (__started__/__delta__ and future
 * double-underscore sentinels), outcome counts, error capping, run ordering.
 * Trino-side latest-partition read is NOT covered here (network).
 */

import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'snapshot-runs-test-'));
process.env.DB_PATH = join(tmp, 'snapshot-runs.db');

import { getDb, closeDb } from '../src/db/sqlite.js';
import { listSnapshotRuns } from '../src/services/segment-snapshot-runs.js';

function insertLog(
  snapshotDate: string,
  segmentId: string,
  status: string,
  opts: { gameId?: string | null; rowCount?: number | null; detail?: string | null; ts?: string } = {},
): void {
  getDb()
    .prepare(
      `INSERT INTO segment_snapshot_log (snapshot_date, segment_id, game_id, row_count, status, detail, ts)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      snapshotDate,
      segmentId,
      opts.gameId ?? null,
      opts.rowCount ?? null,
      status,
      opts.detail ?? null,
      opts.ts ?? '2026-06-10 17:00:00',
    );
}

beforeEach(() => {
  getDb().prepare('DELETE FROM segment_snapshot_log').run();
});

afterAll(() => closeDb());

describe('listSnapshotRuns', () => {
  it('groups one run per snapshot date with outcome counts', () => {
    insertLog('2026-06-10', '__started__', 'started', { ts: '2026-06-10 17:00:01' });
    insertLog('2026-06-10', 'seg-a', 'written', { gameId: 'cfm_vn', rowCount: 100 });
    insertLog('2026-06-10', 'seg-b', 'written', { gameId: 'jus_vn', rowCount: 50 });
    insertLog('2026-06-10', 'seg-c', 'skipped', { detail: 'unknown game' });
    insertLog('2026-06-10', 'seg-d', 'error', { gameId: 'cfm_vn', detail: 'boom' });
    insertLog('2026-06-10', '__delta__', 'written', { rowCount: 150 });

    const runs = listSnapshotRuns();
    expect(runs).toHaveLength(1);
    const run = runs[0];
    expect(run.snapshotDate).toBe('2026-06-10');
    expect(run.startedAt).toBe('2026-06-10 17:00:01');
    expect(run.written).toBe(2);
    expect(run.skipped).toBe(1);
    expect(run.errored).toBe(1);
    expect(run.deltaStatus).toBe('written');
    expect(run.deltaRows).toBe(150);
    expect(run.errors).toEqual([{ segmentId: 'seg-d', gameId: 'cfm_vn', detail: 'boom' }]);
  });

  it('orders runs newest-first and surfaces the definitions sentinel without counting it', () => {
    insertLog('2026-06-09', 'seg-a', 'written');
    insertLog('2026-06-10', 'seg-a', 'written');
    insertLog('2026-06-10', '__definitions__', 'written', { rowCount: 12 });

    const runs = listSnapshotRuns();
    expect(runs.map((r) => r.snapshotDate)).toEqual(['2026-06-10', '2026-06-09']);
    expect(runs[0].written).toBe(1);
    // Definitions outcome is run-level state, not a segment count — a failed
    // definitions write must be visible in the admin payload.
    expect(runs[0].definitionsStatus).toBe('written');
    expect(runs[0].definitionsRows).toBe(12);
    expect(runs[1].definitionsStatus).toBeNull();
  });

  it('caps captured errors per run', () => {
    for (let i = 0; i < 15; i++) {
      insertLog('2026-06-10', `seg-${i}`, 'error', { detail: `err ${i}` });
    }
    const runs = listSnapshotRuns();
    expect(runs[0].errored).toBe(15);
    expect(runs[0].errors).toHaveLength(10);
  });

  it('respects the run limit', () => {
    for (let d = 1; d <= 9; d++) {
      insertLog(`2026-06-0${d}`, 'seg-a', 'written');
    }
    expect(listSnapshotRuns(3)).toHaveLength(3);
  });
});
