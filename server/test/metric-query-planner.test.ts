import { describe, expect, it } from 'vitest';

import {
  planMetricQueries,
  type CubeMeta,
} from '../src/services/metric-query-planner.js';
import type { BusinessMetric } from '../src/types/business-metric.js';

const META: CubeMeta = {
  cubes: [
    {
      name: 'recharge',
      measures: [{ name: 'recharge.paying_users' }, { name: 'recharge.revenue_vnd' }],
      dimensions: [{ name: 'recharge.day', type: 'time' }],
    },
    {
      name: 'mf_users',
      measures: [{ name: 'mf_users.dau' }],
      dimensions: [{ name: 'mf_users.day', type: 'time' }],
    },
    {
      name: 'no_time',
      measures: [{ name: 'no_time.count' }],
      dimensions: [{ name: 'no_time.label', type: 'string' }],
    },
  ],
};

function metric(partial: Partial<BusinessMetric>): BusinessMetric {
  return {
    id: 'x',
    label: 'X',
    description: 'd',
    tier: 1,
    domain: 'revenue',
    owner: 'o',
    trust: 'certified',
    formula: { type: 'measure', ref: 'recharge.paying_users' },
    ...partial,
  } as BusinessMetric;
}

describe('planMetricQueries', () => {
  it('plans a single measure with its cube time dim', () => {
    const r = planMetricQueries(metric({}), META);
    expect('skip' in r).toBe(false);
    if ('skip' in r) return;
    expect(r.numerator.measures).toEqual(['recharge.paying_users']);
    expect(r.numerator.timeDimensions[0].dimension).toBe('recharge.day');
    expect(r.numerator.timeDimensions[0].granularity).toBe('day');
    expect(r.denominator).toBeUndefined();
  });

  it('plans a ratio with both num + den queries', () => {
    const r = planMetricQueries(
      metric({
        formula: {
          type: 'ratio',
          numerator: 'recharge.revenue_vnd',
          denominator: 'mf_users.dau',
        },
      }),
      META,
    );
    expect('skip' in r).toBe(false);
    if ('skip' in r) return;
    expect(r.numerator.measures).toEqual(['recharge.revenue_vnd']);
    expect(r.denominator?.measures).toEqual(['mf_users.dau']);
    expect(r.numerator.timeDimensions[0].dimension).toBe('recharge.day');
    expect(r.denominator?.timeDimensions[0].dimension).toBe('mf_users.day');
  });

  it('skips expression formulas', () => {
    const r = planMetricQueries(
      metric({
        formula: { type: 'expression', expression: 'a + b' },
      }),
      META,
    );
    expect('skip' in r).toBe(true);
  });

  it('skips when cube has no time dimension', () => {
    const r = planMetricQueries(
      metric({ formula: { type: 'measure', ref: 'no_time.count' } }),
      META,
    );
    expect('skip' in r).toBe(true);
    if (!('skip' in r)) return;
    expect(r.skip).toMatch(/time dimension/);
  });

  it('uses a 14-day dateRange ending today', () => {
    const r = planMetricQueries(metric({}), META);
    if ('skip' in r) throw new Error('expected plan');
    const [start, end] = r.numerator.timeDimensions[0].dateRange;
    expect(start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const ms = Date.parse(end) - Date.parse(start);
    expect(ms / (1000 * 60 * 60 * 24)).toBeCloseTo(14, 0);
  });
});
