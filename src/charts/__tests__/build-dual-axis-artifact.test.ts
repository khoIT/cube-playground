/**
 * Tests for buildDualAxisArtifact — assembles the dual-axis ChartArtifact the
 * builder center feeds to AssistantChartSection. Verifies the encoding the
 * renderer reads (value = left/bars, series = right/line) and graceful nulls.
 */
import { describe, it, expect } from 'vitest';
import type { Query } from '@cubejs-client/core';
import { buildDualAxisArtifact } from '../build-dual-axis-artifact';

const primaryQuery: Query = {
  measures: ['active_daily.paying_dau'],
  timeDimensions: [{ dimension: 'active_daily.log_date', granularity: 'day', dateRange: ['2026-06-01', '2026-06-02'] }],
};
const overlayQuery: Query = {
  measures: ['user_recharge_daily.revenue_vnd_total'],
  timeDimensions: [{ dimension: 'user_recharge_daily.log_date', granularity: 'day', dateRange: ['2026-06-01', '2026-06-02'] }],
};
const primaryRows = [
  { 'active_daily.log_date.day': '2026-06-01', 'active_daily.paying_dau': 40000 },
  { 'active_daily.log_date.day': '2026-06-02', 'active_daily.paying_dau': 41000 },
];
const overlayRows = [
  { 'user_recharge_daily.log_date.day': '2026-06-01', 'user_recharge_daily.revenue_vnd_total': 8000000 },
  { 'user_recharge_daily.log_date.day': '2026-06-02', 'user_recharge_daily.revenue_vnd_total': 8200000 },
];

describe('buildDualAxisArtifact', () => {
  it('builds a dual-axis artifact with value=primary (bars) / series=overlay (line)', () => {
    const art = buildDualAxisArtifact({ primaryQuery, primaryRows, overlayQuery, overlayRows, title: 'DAU vs Revenue' });
    expect(art).not.toBeNull();
    expect(art!.spec.type).toBe('dual-axis');
    expect(art!.spec.encoding).toEqual({
      category: '__date',
      value: 'active_daily.paying_dau',
      series: 'user_recharge_daily.revenue_vnd_total',
    });
    expect(art!.spec.data).toHaveLength(2);
    expect(art!.columns?.map((c) => c.key)).toEqual([
      '__date',
      'active_daily.paying_dau',
      'user_recharge_daily.revenue_vnd_total',
    ]);
  });

  it('uses the meta label resolver when provided', () => {
    const art = buildDualAxisArtifact({
      primaryQuery, primaryRows, overlayQuery, overlayRows,
      labelFor: (m) => (m === 'active_daily.paying_dau' ? 'Paying DAU' : undefined),
    });
    expect(art!.columns?.find((c) => c.key === 'active_daily.paying_dau')?.label).toBe('Paying DAU');
    // Falls back to humanised leaf when the resolver returns undefined.
    expect(art!.columns?.find((c) => c.key === 'user_recharge_daily.revenue_vnd_total')?.label).toBe('Revenue vnd total');
  });

  it('returns null when a measure is missing (degrade to single chart)', () => {
    expect(
      buildDualAxisArtifact({ primaryQuery: { measures: [] }, primaryRows, overlayQuery, overlayRows }),
    ).toBeNull();
  });

  it('returns null when no dates overlap or rows are empty', () => {
    expect(buildDualAxisArtifact({ primaryQuery, primaryRows: [], overlayQuery, overlayRows: [] })).toBeNull();
  });
});
