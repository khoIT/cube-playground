import { describe, expect, it } from 'vitest';

import type { BusinessMetric } from '../metrics-tab/business-metric-types';
import { buildLineage, extractFormulaRefs } from './lineage-graph-builder';

function make(
  id: string,
  formula: BusinessMetric['formula'],
): BusinessMetric {
  return {
    id,
    label: id.toUpperCase(),
    description: '',
    tier: 1,
    domain: 'engagement',
    owner: 'data@vng',
    trust: 'beta',
    formula,
  };
}

describe('extractFormulaRefs', () => {
  it('returns single ref for measure', () => {
    expect(
      extractFormulaRefs(make('m', { type: 'measure', ref: 'cube.x' })),
    ).toEqual(['cube.x']);
  });

  it('returns numerator + denominator for ratio', () => {
    expect(
      extractFormulaRefs(
        make('m', {
          type: 'ratio',
          numerator: 'a.x',
          denominator: 'b.y',
        }),
      ),
    ).toEqual(['a.x', 'b.y']);
  });

  it('returns inputs for expression', () => {
    expect(
      extractFormulaRefs(
        make('m', {
          type: 'expression',
          expression: 'a + b',
          inputs: ['cube.a', 'cube.b'],
        }),
      ),
    ).toEqual(['cube.a', 'cube.b']);
  });
});

describe('buildLineage', () => {
  it('parses upstream FQNs into cube + member', () => {
    const metric = make('arpdau', {
      type: 'ratio',
      numerator: 'recharge.revenue_vnd',
      denominator: 'mf_users.dau',
    });
    const { upstream } = buildLineage(metric, [metric]);
    expect(upstream).toHaveLength(2);
    expect(upstream[0]).toEqual({
      fqn: 'recharge.revenue_vnd',
      cube: 'recharge',
      member: 'revenue_vnd',
    });
    expect(upstream[1]).toEqual({
      fqn: 'mf_users.dau',
      cube: 'mf_users',
      member: 'dau',
    });
  });

  it('finds downstream metrics sharing an upstream ref', () => {
    const dau = make('dau', { type: 'measure', ref: 'mf_users.dau' });
    const arpdau = make('arpdau', {
      type: 'ratio',
      numerator: 'recharge.revenue_vnd',
      denominator: 'mf_users.dau',
    });
    const other = make('other', { type: 'measure', ref: 'unrelated.x' });

    const { downstream } = buildLineage(dau, [dau, arpdau, other]);
    expect(downstream).toHaveLength(1);
    expect(downstream[0].metric.id).toBe('arpdau');
    expect(downstream[0].via).toBe('mf_users.dau');
  });

  it('excludes the metric itself from downstream', () => {
    const dau = make('dau', { type: 'measure', ref: 'mf_users.dau' });
    const { downstream } = buildLineage(dau, [dau]);
    expect(downstream).toHaveLength(0);
  });

  it('dedupes upstream refs', () => {
    const self = make('weird', {
      type: 'ratio',
      numerator: 'a.x',
      denominator: 'a.x',
    });
    const { upstream } = buildLineage(self, [self]);
    expect(upstream).toHaveLength(1);
  });
});
