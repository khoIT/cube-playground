/**
 * Metric-series reader + registry — lens SQL shape (escaping, anchor math,
 * fully-qualified cross-catalog tables), entry-lens cumulative memberCount
 * merge, dead-join warning semantics, registry gating. Trino mocked.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const runQueryMock = vi.fn();
vi.mock('../src/services/trino-rest-client.js', () => ({
  runQuery: (...args: unknown[]) => runQueryMock(...args),
}));

import {
  readMetricSeries,
  clampMetricDays,
  isValidAnchor,
  type MetricSeriesRequest,
} from '../src/lakehouse/segment-metric-series-reader.js';
import {
  listEligibleMetrics,
  resolveMetricBinding,
} from '../src/lakehouse/segment-metric-registry.js';
import type { Connector } from '../src/services/trino-profiler-config.js';

const connector: Connector = {
  id: 'test', label: 'test', workspaceId: 'local', sourceType: 'trino',
  host: 'unused', port: 8080, user: 'test', password: '', catalog: 'game_integration', ssl: false,
};

const revenue = resolveMetricBinding('cfm_vn', 'revenue')!;
const active = resolveMetricBinding('cfm_vn', 'active_members')!;

function req(over: Partial<MetricSeriesRequest> = {}): MetricSeriesRequest {
  return { gameId: 'cfm_vn', segmentId: 'seg-1', binding: revenue, lens: 'current', days: 30, ...over };
}

beforeEach(() => {
  runQueryMock.mockReset();
  runQueryMock.mockResolvedValue({ columns: [], rows: [] });
});

describe('registry gating', () => {
  it('serves only probe-verified games and known metric keys', () => {
    expect(listEligibleMetrics('cfm_vn').map((b) => b.metricKey)).toEqual(['revenue', 'active_members']);
    expect(listEligibleMetrics('jus_vn')).toHaveLength(2);
    expect(listEligibleMetrics('ballistar')).toEqual([]); // not seeded yet (short history)
    expect(listEligibleMetrics('ptg')).toEqual([]); // stale marts
    expect(resolveMetricBinding('cfm_vn', 'nope')).toBeNull();
  });
});

describe('validation helpers', () => {
  it('clamps days to [1, 120] with 90 default and validates anchors', () => {
    expect(clampMetricDays(undefined)).toBe(90);
    expect(clampMetricDays('500')).toBe(120);
    expect(clampMetricDays('0')).toBe(1);
    expect(isValidAnchor('2026-06-10')).toBe(true);
    expect(isValidAnchor('06/10/2026')).toBe(false);
    expect(isValidAnchor(undefined)).toBe(false);
  });
});

describe('current lens', () => {
  it('LEFT JOINs the fact mart by uid+date with escaped literals', async () => {
    runQueryMock.mockResolvedValue({ columns: [], rows: [['2026-06-10', 3968, 1471, 12345.6]] });
    const out = await readMetricSeries(req({ segmentId: "s'1" }), { connector });
    const sql = runQueryMock.mock.calls[0][2] as string;
    expect(sql).toContain('FROM stag_iceberg.khoitn.segment_membership_daily m');
    expect(sql).toContain('LEFT JOIN game_integration.cfm_vn.std_ingame_user_recharge_daily f');
    expect(sql).toContain('f.user_id = m.uid AND f.log_date = m.snapshot_date');
    expect(sql).toContain("m.segment_id = 's''1'");
    expect(sql).toContain('coalesce(sum(f.ingame_total_recharge_value_vnd), 0)');
    expect(out.points).toEqual([{ date: '2026-06-10', memberCount: 3968, value: 12345.6 }]);
    expect(out.joinWarning).toBeNull();
  });

  it('uses count(distinct uid) for count_members metrics', async () => {
    await readMetricSeries(req({ binding: active }), { connector });
    expect(runQueryMock.mock.calls[0][2] as string).toContain('count(distinct f.user_id) AS value');
  });

  it('flags a dead join only past the min-days threshold, never sparse/short windows', async () => {
    const zeroDay = (d: string) => [d, 224, 0, 0];
    // 5 all-zero cohort days → namespace-mismatch signature.
    runQueryMock.mockResolvedValue({
      columns: [],
      rows: ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'].map(zeroDay),
    });
    const dead = await readMetricSeries(req(), { connector });
    expect(dead.joinWarning).toContain('identity-namespace mismatch');

    // Short window (2 days, all zero) → sparsity, no warning (live jus case).
    runQueryMock.mockResolvedValue({
      columns: [],
      rows: [zeroDay('2026-06-10'), zeroDay('2026-06-12')],
    });
    expect((await readMetricSeries(req(), { connector })).joinWarning).toBeNull();

    // Long window with any joined day → no warning.
    runQueryMock.mockResolvedValue({
      columns: [],
      rows: [...['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04'].map(zeroDay), ['2026-06-05', 226, 9, 99]],
    });
    expect((await readMetricSeries(req(), { connector })).joinWarning).toBeNull();
  });
});

describe('entry lens', () => {
  it('requires an anchor', async () => {
    await expect(readMetricSeries(req({ lens: 'entry' }), { connector })).rejects.toThrow(/anchor/);
  });

  it('tracks the fixed entered-cohort through the mart and accumulates memberCount', async () => {
    // 1st call: fact series; 2nd: first-entry-per-uid counts (deduped in SQL).
    runQueryMock
      .mockResolvedValueOnce({
        columns: [],
        rows: [
          ['2026-06-10', 5, 100],
          ['2026-06-11', 4, 80],
          ['2026-06-12', 6, 120],
        ],
      })
      .mockResolvedValueOnce({
        columns: [],
        rows: [
          ['2026-06-10', 10],
          ['2026-06-12', 3],
        ],
      });
    const out = await readMetricSeries(req({ lens: 'entry', anchor: '2026-06-10' }), { connector });
    const factSql = runQueryMock.mock.calls[0][2] as string;
    expect(factSql).toContain("change = 'entered'");
    expect(factSql).toContain("snapshot_date >= DATE '2026-06-10'");
    expect(factSql).toContain('JOIN cohort c ON f.user_id = c.uid');
    // Cumulative: 10 on 06-10/06-11, then 13 from 06-12 — exits never shrink it.
    expect(out.points.map((p) => p.memberCount)).toEqual([10, 10, 13]);
    expect(out.points.map((p) => p.value)).toEqual([100, 80, 120]);
  });
});

describe('stayers lens', () => {
  it('self-intersects membership at the anchor and per-day', async () => {
    runQueryMock.mockResolvedValue({ columns: [], rows: [['2026-06-12', 200, 9, 50]] });
    const out = await readMetricSeries(req({ lens: 'stayers', anchor: '2026-06-10' }), { connector });
    const sql = runQueryMock.mock.calls[0][2] as string;
    expect(sql).toContain('FROM stag_iceberg.khoitn.segment_membership_daily a');
    expect(sql).toContain('JOIN stag_iceberg.khoitn.segment_membership_daily m');
    expect(sql).toContain('m.uid = a.uid');
    expect(sql).toContain("a.snapshot_date = DATE '2026-06-10'");
    expect(out.points[0]).toEqual({ date: '2026-06-12', memberCount: 200, value: 50 });
  });
});
