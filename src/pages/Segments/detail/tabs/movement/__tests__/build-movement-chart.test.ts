import { describe, it, expect } from 'vitest';
import {
  buildKpiTrendChart,
  buildMembershipChart,
  buildDistributionChart,
  prettifyKey,
  shortMetricLabel,
} from '../build-movement-chart';

describe('prettifyKey', () => {
  it('humanises snake/camel keys', () => {
    expect(prettifyKey('ltv_total_vnd')).toBe('Ltv total vnd');
    expect(prettifyKey('lifecycleStage')).toBe('Lifecycle Stage');
  });
});

describe('shortMetricLabel', () => {
  it('drops the cube prefix so chip text matches the legend leaf', () => {
    expect(shortMetricLabel('mf_users.paying_users_30d')).toBe('Paying users 30d');
    expect(shortMetricLabel('mf_users.ltv_total_vnd')).toBe('Ltv total vnd');
  });
  it('passes through unprefixed ids', () => {
    expect(shortMetricLabel('size')).toBe('Size');
    expect(shortMetricLabel('member_count')).toBe('Member count');
  });
});

describe('buildKpiTrendChart label', () => {
  it('stores the short (prefix-stripped) metric label as the series value', () => {
    const a = buildKpiTrendChart('s1', 'KPI', [
      { metricId: 'mf_users.paying_users_30d', points: [{ ts: 't1', value: 10 }], carryForward: [] },
      { metricId: 'mf_users.user_count', points: [{ ts: 't1', value: 99 }], carryForward: [] },
    ]);
    expect(a.spec.data.map((r) => r.metric)).toEqual(['Paying users 30d', 'User count']);
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
