import { describe, expect, it } from 'vitest';

import type { BusinessMetric } from '../metrics-tab/business-metric-types';
import type { CatalogCube } from '../use-catalog-meta';
import {
  EXPLORE_DEFAULT_GRANULARITY,
  EXPLORE_DEFAULT_RANGE,
  buildConceptExploreUrl,
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
    trust: 'draft',
    formula,
  };
}

function cube(name: string, timeDimNames: string[]): CatalogCube {
  return {
    name,
    measures: [],
    dimensions: timeDimNames.map((n) => ({ name: `${name}.${n}`, type: 'time' })),
  };
}

const META_LOG: CatalogCube[] = [cube('mf_users', ['log_date'])];
const META_RECHARGE: CatalogCube[] = [cube('recharge', ['recharge_date'])];

describe('timeDimensionFor', () => {
  it('picks the cube real time dim from /meta', () => {
    expect(
      timeDimensionFor(make('m', { type: 'measure', ref: 'mf_users.dau' }), META_LOG),
    ).toBe('mf_users.log_date');
  });

  it('uses numerator cube for ratio formulas', () => {
    expect(
      timeDimensionFor(
        make('m', {
          type: 'ratio',
          numerator: 'recharge.revenue_vnd',
          denominator: 'mf_users.dau',
        }),
        META_RECHARGE,
      ),
    ).toBe('recharge.recharge_date');
  });

  it('returns null when no measures available', () => {
    expect(
      timeDimensionFor(make('m', { type: 'expression', expression: 'noop', inputs: [] }), META_LOG),
    ).toBeNull();
  });

  it('returns null when cubes meta omits the cube', () => {
    expect(
      timeDimensionFor(make('m', { type: 'measure', ref: 'ghost.foo' }), META_LOG),
    ).toBeNull();
  });
});

describe('buildExploreQuery', () => {
  it('builds measure + day timeDim + last-30-days range', () => {
    const q = buildExploreQuery(make('m', { type: 'measure', ref: 'mf_users.dau' }), META_LOG);
    expect(q.measures).toEqual(['mf_users.dau']);
    expect(q.timeDimensions).toEqual([
      {
        dimension: 'mf_users.log_date',
        granularity: EXPLORE_DEFAULT_GRANULARITY,
        dateRange: EXPLORE_DEFAULT_RANGE,
      },
    ]);
    expect(q.order).toEqual({ 'mf_users.log_date': 'desc' });
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
      META_RECHARGE,
    );
    expect(q.measures).toEqual(['recharge.revenue_vnd', 'mf_users.dau']);
    expect(q.timeDimensions[0].dimension).toBe('recharge.recharge_date');
  });

  it('omits timeDimensions when meta is missing the cube', () => {
    const q = buildExploreQuery(make('m', { type: 'measure', ref: 'ghost.foo' }), META_LOG);
    expect(q.timeDimensions).toEqual([]);
    expect(q.order).toEqual({});
    expect(q.measures).toEqual(['ghost.foo']);
  });

  it('omits timeDimensions when no measures', () => {
    const q = buildExploreQuery(
      make('m', { type: 'expression', expression: 'noop', inputs: [] }),
      META_LOG,
    );
    expect(q.timeDimensions).toEqual([]);
    expect(q.order).toEqual({});
  });
});

describe('buildExploreUrl', () => {
  it('encodes the query JSON + from=catalog:<id> marker', () => {
    const url = buildExploreUrl(make('dau', { type: 'measure', ref: 'mf_users.dau' }), META_LOG);
    expect(url.startsWith('/build?')).toBe(true);
    const params = new URLSearchParams(url.slice('/build?'.length));
    expect(params.get('from')).toBe('catalog:dau');
    const decoded = JSON.parse(params.get('query')!);
    expect(decoded.measures).toEqual(['mf_users.dau']);
    expect(decoded.timeDimensions[0].dimension).toBe('mf_users.log_date');
  });
});

describe('buildConceptExploreUrl', () => {
  it('produces the same shape from a concept fqn', () => {
    const url = buildConceptExploreUrl('mf_users.user_count', META_LOG);
    const params = new URLSearchParams(url.slice('/build?'.length));
    const decoded = JSON.parse(params.get('query')!);
    expect(decoded.measures).toEqual(['mf_users.user_count']);
    expect(decoded.timeDimensions[0].dimension).toBe('mf_users.log_date');
  });

  it('omits timeDim when cube has no time dim in meta', () => {
    const url = buildConceptExploreUrl('user_audience.user_count', META_LOG);
    const decoded = JSON.parse(new URLSearchParams(url.slice('/build?'.length)).get('query')!);
    expect(decoded.timeDimensions).toEqual([]);
  });
});
