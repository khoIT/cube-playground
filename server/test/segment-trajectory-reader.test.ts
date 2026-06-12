/**
 * segment-trajectory-reader — SQL shape (literal escaping, partition-pruned
 * filters, window math) and days clamping. Trino mocked.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const runQueryMock = vi.fn();
vi.mock('../src/services/trino-rest-client.js', () => ({
  runQuery: (...args: unknown[]) => runQueryMock(...args),
}));

import {
  readSizeSeries,
  readDeltaSeries,
  clampTrajectoryDays,
} from '../src/lakehouse/segment-trajectory-reader.js';
import type { Connector } from '../src/services/trino-profiler-config.js';

const connector: Connector = {
  id: 'test', label: 'test', workspaceId: 'local', sourceType: 'trino',
  host: 'unused', port: 8080, user: 'test', password: '', catalog: 'game_integration', ssl: false,
};

beforeEach(() => {
  runQueryMock.mockReset();
  runQueryMock.mockResolvedValue({ columns: [], rows: [] });
});

describe('clampTrajectoryDays', () => {
  it('defaults to 90, clamps to [7, 180], tolerates garbage', () => {
    expect(clampTrajectoryDays(undefined)).toBe(90);
    expect(clampTrajectoryDays('abc')).toBe(90);
    expect(clampTrajectoryDays('1')).toBe(7);
    expect(clampTrajectoryDays('30')).toBe(30);
    expect(clampTrajectoryDays('9999')).toBe(180);
    expect(clampTrajectoryDays(14.9)).toBe(14);
  });
});

describe('readSizeSeries', () => {
  it('filters by escaped game/segment literals and prunes by date window', async () => {
    runQueryMock.mockResolvedValue({ columns: [], rows: [['2026-06-10', 100]] });
    const out = await readSizeSeries('cfm_vn', "seg'; DROP", 30, { connector });
    const sql = runQueryMock.mock.calls[0][2] as string;
    expect(sql).toContain("game_id = 'cfm_vn'");
    expect(sql).toContain("segment_id = 'seg''; DROP'"); // quote doubled
    expect(sql).toContain("date_add('day', -30, current_date)");
    expect(sql).toContain('segment_membership_daily');
    expect(out).toEqual([{ date: '2026-06-10', members: 100 }]);
  });
});

describe('readDeltaSeries', () => {
  it('aggregates entered/exited per day from the delta table', async () => {
    runQueryMock.mockResolvedValue({ columns: [], rows: [['2026-06-12', 5, 2]] });
    const out = await readDeltaSeries('jus_vn', 'seg-1', 90, { connector });
    const sql = runQueryMock.mock.calls[0][2] as string;
    expect(sql).toContain('segment_membership_delta');
    expect(sql).toContain("change = 'entered'");
    expect(sql).toContain("change = 'exited'");
    expect(out).toEqual([{ date: '2026-06-12', entered: 5, exited: 2 }]);
  });
});
