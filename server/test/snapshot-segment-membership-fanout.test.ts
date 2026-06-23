/**
 * Bounded fan-out behaviour of the membership snapshot run:
 *   1. a segment whose writer THROWS must not abort its neighbours — the
 *      regression that starved tail segments under the old sequential loop,
 *      where one mid-list exception killed every remaining segment;
 *   2. the run processes the most STALE segments first (never-snapshotted, then
 *      oldest), so a time-boxed run can't starve the same tail every night.
 *
 * Trino + Cube are fully mocked — no network. The job only does cheap SQLite
 * work plus the mocked writers.
 */

import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'snapshot-fanout-test-'));
process.env.DB_PATH = join(tmp, 'fanout.db');

// Mocks are hoisted above the imports below by vitest.
vi.mock('../src/lakehouse/lakehouse-trino-connector.js', () => ({
  lakehouseSchemaForGame: () => 'khoitn/local',
  lakehouseConnectorFromEnv: () => ({ host: 'mock' }),
  ensureLakehouseTables: vi.fn().mockResolvedValue(undefined),
}));

const writeSegmentSnapshot = vi.fn();
vi.mock('../src/lakehouse/segment-snapshot-writer.js', () => ({
  writeSegmentSnapshot: (...args: unknown[]) => writeSegmentSnapshot(...args),
}));
vi.mock('../src/lakehouse/segment-delta-writer.js', () => ({
  writeSegmentMembershipDeltaForSegment: vi.fn().mockResolvedValue({ status: 'written', rowCount: 1 }),
}));
vi.mock('../src/lakehouse/segment-definition-writer.js', () => ({
  writeSegmentDefinitions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/lakehouse/segment-member-state-writer.js', () => ({
  writeMemberStateSnapshot: vi.fn().mockResolvedValue({ status: 'written', rowCount: 1 }),
}));
vi.mock('../src/lakehouse/segment-kpi-writer.js', () => ({
  writeSegmentKpiSnapshot: vi.fn().mockResolvedValue({ status: 'written', rowCount: 1 }),
}));

import { getDb, closeDb } from '../src/db/sqlite.js';
import { runSegmentMembershipSnapshot } from '../src/jobs/snapshot-segment-membership.js';

function seedSegment(id: string): void {
  getDb()
    .prepare(
      `INSERT INTO segments (id, name, type, owner, cube, game_id, workspace, cube_query_json, snapshot_cadence)
       VALUES (?, ?, 'predicate', 'tester', 'mf_users', 'jus_vn', 'local', '{"filters":[]}', 'daily')`,
    )
    .run(id, `seg ${id}`);
}

function insertPriorTs(segmentId: string, snapshotTs: string): void {
  getDb()
    .prepare(
      `INSERT INTO segment_snapshot_log (snapshot_date, segment_id, status, snapshot_ts)
       VALUES (?, ?, 'written', ?)`,
    )
    .run(snapshotTs.slice(0, 10), segmentId, snapshotTs);
}

beforeEach(() => {
  getDb().prepare('DELETE FROM segments').run();
  getDb().prepare('DELETE FROM segment_snapshot_log').run();
  writeSegmentSnapshot.mockReset();
  process.env.SEGMENT_SNAPSHOT_CONCURRENCY = '4';
});

afterAll(() => closeDb());

describe('runSegmentMembershipSnapshot fan-out', () => {
  it('one throwing segment does not abort the rest of the run', async () => {
    ['a', 'b', 'c', 'd'].forEach(seedSegment);
    writeSegmentSnapshot.mockImplementation((seg: { segmentId: string }) => {
      if (seg.segmentId === 'b') throw new Error('boom');
      return Promise.resolve({ status: 'written', rowCount: 10 });
    });

    const summary = await runSegmentMembershipSnapshot('2026-06-24', Date.now(), true);

    expect(summary.written).toBe(3); // a, c, d survive
    expect(summary.errored).toBe(1); // only b
    // The thrower is logged as an error rather than silently lost.
    const errRow = getDb()
      .prepare(`SELECT 1 FROM segment_snapshot_log WHERE segment_id = 'b' AND status = 'error'`)
      .get();
    expect(errRow).toBeTruthy();
  });

  it('processes the most stale segments first', async () => {
    ['fresh', 'stale', 'never'].forEach(seedSegment);
    insertPriorTs('fresh', '2026-06-23 00:00:00');
    insertPriorTs('stale', '2026-06-01 00:00:00');
    // never: no prior row → highest priority.
    process.env.SEGMENT_SNAPSHOT_CONCURRENCY = '1'; // serial → deterministic order

    const order: string[] = [];
    writeSegmentSnapshot.mockImplementation((seg: { segmentId: string }) => {
      order.push(seg.segmentId);
      return Promise.resolve({ status: 'written', rowCount: 1 });
    });

    await runSegmentMembershipSnapshot('2026-06-24', Date.now(), true);

    expect(order).toEqual(['never', 'stale', 'fresh']);
  });
});
