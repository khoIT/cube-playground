import { describe, expect, it } from 'vitest';

import type { BusinessMetric } from '../metrics-tab/business-metric-types';
import {
  EXPLORE_DEFAULT_GRANULARITY,
  EXPLORE_DEFAULT_RANGE,
  buildExploreQuery,
  buildExploreUrl,
  timeDimensionFor,
} from './explore-query-builder';

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

describe('timeDimensionFor', () => {
  it('derives <cube>.event_date from first measure', () => {
    expect(timeDimensionFor(make('m', { type: 'measure', ref: 'mf_users.dau' }))).toBe(
      'mf_users.event_date',
    );
  });

  it('uses numerator cube for ratio formulas', () => {
    expect(
      timeDimensionFor(
        make('m', {
          type: 'ratio',
          numerator: 'recharge.revenue_vnd',
          denominator: 'mf_users.dau',
        }),
      ),
    ).toBe('recharge.event_date');
  });

  it('returns null when no measures available', () => {
    expect(timeDimensionFor(make('m', { type: 'expression', expression: 'noop', inputs: [] }))).toBeNull();
  });
});

describe('buildExploreQuery', () => {
  it('builds measure + day timeDim + last-30-days range for a measure metric', () => {
    const q = buildExploreQuery(make('m', { type: 'measure', ref: 'mf_users.dau' }));
    expect(q.measures).toEqual(['mf_users.dau']);
    expect(q.timeDimensions).toEqual([
      {
        dimension: 'mf_users.event_date',
        granularity: EXPLORE_DEFAULT_GRANULARITY,
        dateRange: EXPLORE_DEFAULT_RANGE,
      },
    ]);
    expect(q.order).toEqual({ 'mf_users.event_date': 'desc' });
    expect(q.dimensions).toEqual([]);
    expect(q.filters).toEqual([]);
    expect(q.limit).toBe(1000);
  });

  it('includes numerator + denominator for ratio metrics', () => {
    const q = buildExploreQuery(
      make('arpdau', {
        type: 'ratio',
        numerator: 'recharge.revenue_vnd',
        denominator: 'mf_users.dau',
      }),
    );
    expect(q.measures).toEqual(['recharge.revenue_vnd', 'mf_users.dau']);
    expect(q.timeDimensions[0].dimension).toBe('recharge.event_date');
  });

  it('includes all inputs for expression metrics', () => {
    const q = buildExploreQuery(
      make('roas', {
        type: 'expression',
        expression: 'a / b',
        inputs: ['recharge.revenue_vnd', 'mkt.cost_usd'],
      }),
    );
    expect(q.measures).toEqual(['recharge.revenue_vnd', 'mkt.cost_usd']);
  });

  it('omits timeDimensions when no measures', () => {
    const q = buildExploreQuery(make('m', { type: 'expression', expression: 'noop', inputs: [] }));
    expect(q.timeDimensions).toEqual([]);
    expect(q.order).toEqual({});
  });
});

describe('buildExploreUrl', () => {
  it('encodes the query JSON + from=catalog:<id> marker', () => {
    const url = buildExploreUrl(make('dau', { type: 'measure', ref: 'mf_users.dau' }));
    expect(url.startsWith('/build?')).toBe(true);
    const params = new URLSearchParams(url.slice('/build?'.length));
    expect(params.get('from')).toBe('catalog:dau');
    const decoded = JSON.parse(params.get('query')!);
    expect(decoded.measures).toEqual(['mf_users.dau']);
    expect(decoded.timeDimensions[0].dimension).toBe('mf_users.event_date');
  });
});
