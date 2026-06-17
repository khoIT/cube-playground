import { describe, it, expect, afterEach } from 'vitest';
import { resolveGlossaryHref } from '../resolve-glossary-link';
import {
  registerKnownMetricSlugs,
  __resetKnownMetrics,
} from '../known-metrics-registry';

describe('resolveGlossaryHref', () => {
  it('routes business_metrics/<slug> terms to /catalog/metric/<slug>', () => {
    expect(resolveGlossaryHref({ id: 'dau', primaryCatalogId: 'business_metrics/dau' })).toBe(
      '/catalog/metric/dau',
    );
    expect(
      resolveGlossaryHref({ id: 'd1_retention', primaryCatalogId: 'business_metrics/d1_retention' }),
    ).toBe('/catalog/metric/d1_retention');
  });

  it('encodes slug parts that include URL-sensitive characters', () => {
    expect(
      resolveGlossaryHref({ id: 't', primaryCatalogId: 'business_metrics/has space' }),
    ).toBe('/catalog/metric/has%20space');
  });

  it('anchors a term with no binding to its own row on the index', () => {
    expect(resolveGlossaryHref({ id: 'cohort', primaryCatalogId: null })).toBe(
      '/catalog/glossary#cohort',
    );
  });

  it('anchors non-business_metrics catalog ids (no filter/measure) to the term row', () => {
    expect(
      resolveGlossaryHref({ id: 'whatever', primaryCatalogId: 'players.daily_active_users' }),
    ).toBe('/catalog/glossary#whatever');
  });

  it('treats an empty slug after the prefix as unresolvable and anchors the row', () => {
    expect(
      resolveGlossaryHref({ id: 'broken', primaryCatalogId: 'business_metrics/' }),
    ).toBe('/catalog/glossary#broken');
  });

  it('encodes the anchor id', () => {
    expect(resolveGlossaryHref({ id: 'a b', primaryCatalogId: null })).toBe(
      '/catalog/glossary#a%20b',
    );
  });

  it('anchors a filter-only concept term to its definition row (no measure → no Build)', () => {
    // whale/dolphin/minnow carry only a filter predicate, no measure — a term
    // is a definition first, so it lands on its glossary row, not the builder.
    expect(
      resolveGlossaryHref({
        id: 'whale',
        primaryCatalogId: null,
        defaultFilter: { member: 'mf_users.payer_tier', op: '=', value: 'whale' },
      }),
    ).toBe('/catalog/glossary#whale');
  });

  it('uses the measure ref as the Build measure when present', () => {
    const href = resolveGlossaryHref({
      id: 'arpu',
      primaryCatalogId: null,
      defaultMeasureRef: 'mf_users.arpu_vnd',
    });
    expect(href.startsWith('/build?')).toBe(true);
    const query = JSON.parse(new URLSearchParams(href.split('?')[1]).get('query')!);
    expect(query.measures).toEqual(['mf_users.arpu_vnd']);
    expect(query.dimensions).toEqual([]);
    expect(new URLSearchParams(href.split('?')[1]).get('from')).toBe('glossary:arpu');
  });

  it('prefers a business metric binding over a filter when both exist', () => {
    expect(
      resolveGlossaryHref({
        id: 'dau',
        primaryCatalogId: 'business_metrics/dau',
        defaultFilter: { member: 'mf_users.payer_tier', op: '=', value: 'whale' },
      }),
    ).toBe('/catalog/metric/dau');
  });

  it('combines measure + filter into one Build query', () => {
    const href = resolveGlossaryHref({
      id: 'whale_arpu',
      primaryCatalogId: null,
      defaultMeasureRef: 'mf_users.arpu_vnd',
      defaultFilter: { member: 'mf_users.payer_tier', op: 'IN', value: ['whale', 'dolphin'] },
    });
    const query = JSON.parse(new URLSearchParams(href.split('?')[1]).get('query')!);
    expect(query.measures).toEqual(['mf_users.arpu_vnd']);
    expect(query.dimensions).toEqual([]);
    expect(query.filters[0]).toEqual({
      member: 'mf_users.payer_tier',
      operator: 'equals',
      values: ['whale', 'dolphin'],
    });
  });

  it('maps glossary filter ops to Cube operators and stringifies values', () => {
    const cases: Array<[string, string]> = [
      ['=', 'equals'],
      ['!=', 'notEquals'],
      ['>', 'gt'],
      ['>=', 'gte'],
      ['<', 'lt'],
      ['<=', 'lte'],
      ['IN', 'equals'],
      ['NOT IN', 'notEquals'],
    ];
    for (const [op, operator] of cases) {
      const href = resolveGlossaryHref({
        id: 'm',
        primaryCatalogId: null,
        defaultMeasureRef: 'recharge.total_vnd',
        defaultFilter: { member: 'recharge.total_vnd', op: op as never, value: 1000000 },
      });
      const query = JSON.parse(new URLSearchParams(href.split('?')[1]).get('query')!);
      expect(query.filters[0]).toEqual({
        member: 'recharge.total_vnd',
        operator,
        values: ['1000000'],
      });
    }
  });
});

describe('resolveGlossaryHref — known-metric guard', () => {
  afterEach(() => __resetKnownMetrics());

  it('still routes to the metric when the registry is loaded AND the slug exists', () => {
    registerKnownMetricSlugs(['dau', 'churn_rate']);
    expect(
      resolveGlossaryHref({ id: 'churn_rate', primaryCatalogId: 'business_metrics/churn_rate' }),
    ).toBe('/catalog/metric/churn_rate');
  });

  it('falls through to the glossary row when the registry is loaded but the slug is absent', () => {
    // The bug: a glossary term points at a metric that does not exist. Once the
    // registry is known, the dead link degrades to the term's definition row.
    registerKnownMetricSlugs(['dau', 'mau']);
    expect(
      resolveGlossaryHref({ id: 'churn_rate', primaryCatalogId: 'business_metrics/churn_rate' }),
    ).toBe('/catalog/glossary#churn_rate');
  });

  it('falls through to the measure deep-link when the metric is absent but a measure ref exists', () => {
    registerKnownMetricSlugs(['dau']);
    const href = resolveGlossaryHref({
      id: 'churn_rate',
      primaryCatalogId: 'business_metrics/churn_rate',
      defaultMeasureRef: 'retention.churned_d30',
    });
    expect(href.startsWith('/build?')).toBe(true);
  });

  it('fails open (routes to metric) while the registry is still empty', () => {
    expect(
      resolveGlossaryHref({ id: 'churn_rate', primaryCatalogId: 'business_metrics/churn_rate' }),
    ).toBe('/catalog/metric/churn_rate');
  });
});
