/**
 * segment-overlap-counts — set-op SQL shape (literal escaping, latest-partition
 * resolution, region set operators) and result mapping (onlys + Jaccard).
 * Trino mocked.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const runQueryMock = vi.fn();
vi.mock('../src/services/trino-rest-client.js', () => ({
  runQuery: (...args: unknown[]) => runQueryMock(...args),
}));

import {
  buildOverlapCountsSql,
  buildRegionUidsSql,
  computeSegmentOverlap,
  fetchRegionUids,
} from '../src/lakehouse/segment-overlap-counts.js';
import type { Connector } from '../src/services/trino-profiler-config.js';

const connector: Connector = {
  id: 'test', label: 'test', workspaceId: 'local', sourceType: 'trino',
  host: 'unused', port: 8080, user: 'test', password: '', catalog: 'game_integration', ssl: false,
};

beforeEach(() => {
  runQueryMock.mockReset();
  runQueryMock.mockResolvedValue({ columns: [], rows: [] });
});

describe('buildOverlapCountsSql', () => {
  it('escapes literals, resolves latest partition, intersects the two sets', () => {
    const sql = buildOverlapCountsSql({ gameId: 'cfm_vn', aSegId: "a'; DROP", bSegId: 'b-1' });
    expect(sql).toContain("game_id = 'cfm_vn'");
    expect(sql).toContain("segment_id IN ('a''; DROP', 'b-1')"); // quote doubled
    expect(sql).toContain('segment_membership_daily');
    // latest snapshot_date then latest snapshot_ts within it
    expect(sql).toContain('max(snapshot_date)');
    expect(sql).toContain('max(snapshot_ts)');
    // overlap via semi-join of the two member sets
    expect(sql).toContain('uid IN (SELECT uid FROM b_members)');
  });
});

describe('buildRegionUidsSql', () => {
  it('uses EXCEPT for aOnly/bOnly and INTERSECT for both', () => {
    const base = { gameId: 'cfm_vn', aSegId: 'a', bSegId: 'b' } as const;
    expect(buildRegionUidsSql({ ...base, region: 'aOnly' })).toContain(
      'SELECT uid FROM a_members EXCEPT SELECT uid FROM b_members',
    );
    expect(buildRegionUidsSql({ ...base, region: 'bOnly' })).toContain(
      'SELECT uid FROM b_members EXCEPT SELECT uid FROM a_members',
    );
    expect(buildRegionUidsSql({ ...base, region: 'both' })).toContain(
      'SELECT uid FROM a_members INTERSECT SELECT uid FROM b_members',
    );
  });
});

describe('computeSegmentOverlap', () => {
  it('derives onlys + Jaccard and reads snapshot stamps', async () => {
    // a_size=100, b_size=60, both=20, a_date, b_date, a_ts, b_ts
    runQueryMock.mockResolvedValue({
      columns: [],
      rows: [[100, 60, 20, '2026-06-20', '2026-06-21', '2026-06-20 02:00:00', null]],
    });
    const out = await computeSegmentOverlap(connector, 'cfm_vn', {
      gameId: 'cfm_vn', aSegId: 'a', bSegId: 'b',
    });
    expect(out.aSize).toBe(100);
    expect(out.bSize).toBe(60);
    expect(out.both).toBe(20);
    expect(out.aOnly).toBe(80);
    expect(out.bOnly).toBe(40);
    // |A∩B| / |A∪B| = 20 / (100 + 60 - 20) = 20/140
    expect(out.jaccard).toBeCloseTo(20 / 140, 6);
    expect(out.aSnapshotDate).toBe('2026-06-20');
    expect(out.aSnapshotTs).toBe('2026-06-20 02:00:00');
    expect(out.bSnapshotTs).toBeNull();
  });

  it('returns zeros and zero Jaccard for empty cohorts', async () => {
    runQueryMock.mockResolvedValue({ columns: [], rows: [[0, 0, 0, null, null, null, null]] });
    const out = await computeSegmentOverlap(connector, 'cfm_vn', {
      gameId: 'cfm_vn', aSegId: 'a', bSegId: 'b',
    });
    expect(out.jaccard).toBe(0);
    expect(out.aOnly).toBe(0);
  });
});

describe('fetchRegionUids', () => {
  it('returns the deduped non-empty uid column', async () => {
    runQueryMock.mockResolvedValue({ columns: [], rows: [['u1'], ['u2'], ['']] });
    const uids = await fetchRegionUids(connector, 'cfm_vn', {
      gameId: 'cfm_vn', aSegId: 'a', bSegId: 'b', region: 'aOnly',
    });
    expect(uids).toEqual(['u1', 'u2']);
  });
});
