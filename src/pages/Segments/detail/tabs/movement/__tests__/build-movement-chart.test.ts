import { describe, it, expect } from 'vitest';
import {
  buildKpiTrendChart,
  buildMembershipChart,
  buildDistributionChart,
  prettifyKey,
} from '../build-movement-chart';
import { isGranularitySelectable } from '../../../../../../api/segment-movement-client';

describe('prettifyKey', () => {
  it('humanises snake/camel keys', () => {
    expect(prettifyKey('ltv_total_vnd')).toBe('Ltv total vnd');
    expect(prettifyKey('lifecycleStage')).toBe('Lifecycle Stage');
  });
});

describe('buildKpiTrendChart', () => {
  it('single metric → line, omits null values', () => {
    const a = buildKpiTrendChart('s1', 'KPI', [
      { metricId: 'arpu', points: [{ ts: '2026-06-01 00:00:00', value: 10 }, { ts: '2026-06-02 00:00:00', value: null }], carryForward: [] },
    ]);
    expect(a.spec.type).toBe('line');
    expect(a.spec.data).toHaveLength(1);
    expect(a.spec.encoding).toEqual({ category: 'ts', value: 'value' });
  });

  it('multiple metrics → multi-line long form with series col', () => {
    const a = buildKpiTrendChart('s1', 'KPI', [
      { metricId: 'arpu', points: [{ ts: 't1', value: 10 }], carryForward: [] },
      { metricId: 'dau', points: [{ ts: 't1', value: 99 }], carryForward: [] },
    ]);
    expect(a.spec.type).toBe('multi-line');
    expect(a.spec.encoding.series).toBe('metric');
    expect(a.spec.data).toHaveLength(2);
  });
});

describe('buildMembershipChart', () => {
  it('emits one row per present measure as series', () => {
    const a = buildMembershipChart('s1', 'M', [
      { ts: 't1', memberCount: 100, entered: 5, exited: 2 },
    ]);
    expect(a.spec.type).toBe('multi-line');
    expect(a.spec.data.map((r) => r.series).sort()).toEqual(['Entered', 'Exited', 'Members']);
  });
});

describe('buildDistributionChart', () => {
  it('pivots wide rows to long bucket/count for stacked bar', () => {
    const a = buildDistributionChart('s1', 'D', [
      { ts: 't1', new: 3, churned: 1 } as never,
    ]);
    expect(a.spec.type).toBe('stacked-bar');
    expect(a.spec.encoding).toEqual({ category: 'ts', value: 'count', series: 'bucket' });
    expect(a.spec.data).toHaveLength(2);
  });
});

describe('isGranularitySelectable', () => {
  it('allows coarser-or-equal than captured, blocks finer', () => {
    // captured daily → only daily selectable
    expect(isGranularitySelectable('daily', 'daily')).toBe(true);
    expect(isGranularitySelectable('1h', 'daily')).toBe(false);
    // captured 1h → 1h and coarser allowed, 15m blocked
    expect(isGranularitySelectable('1h', '1h')).toBe(true);
    expect(isGranularitySelectable('daily', '1h')).toBe(true);
    expect(isGranularitySelectable('15m', '1h')).toBe(false);
  });
});
