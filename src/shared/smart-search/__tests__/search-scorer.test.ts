import { describe, expect, it } from 'vitest';

import type { BusinessMetric } from '../../../pages/Catalog/metrics-tab/business-metric-types';
import type { Concept } from '../../../pages/Catalog/data-model-tab/concept-types';
import { scoreAll } from '../search-scorer';

const ARPDAU: BusinessMetric = {
  id: 'arpdau',
  label: 'ARPDAU',
  description: 'Average revenue per daily active user',
  synonyms: ['arpu_daily', 'avg_rev_per_dau'],
  tier: 1,
  domain: 'revenue',
  owner: 'data@vng',
  trust: 'certified',
  formula: { type: 'ratio', numerator: 'recharge.revenue_vnd', denominator: 'mf_users.dau' },
};

const DAU: BusinessMetric = {
  id: 'dau',
  label: 'DAU',
  description: 'Daily active users',
  tier: 1,
  domain: 'engagement',
  owner: 'data@vng',
  trust: 'certified',
  formula: { type: 'measure', ref: 'mf_users.dau' },
};

const REV: Concept = {
  type: 'measure',
  fqn: 'recharge.revenue_vnd',
  cube: 'recharge',
  name: 'revenue_vnd',
  description: 'In-game revenue in VND',
};

const COUNTRY: Concept = {
  type: 'dimension',
  fqn: 'mf_users.country',
  cube: 'mf_users',
  name: 'country',
};

describe('scoreAll', () => {
  it('returns empty for empty query', () => {
    expect(
      scoreAll('', { metrics: [ARPDAU, DAU], concepts: [REV, COUNTRY] }),
    ).toEqual([]);
  });

  it('finds metric by synonym', () => {
    const r = scoreAll('arpu_daily', {
      metrics: [ARPDAU, DAU],
      concepts: [REV, COUNTRY],
    });
    expect(r[0].kind).toBe('metric');
    expect(r[0].id).toBe('arpdau');
  });

  it('ranks exact label hit above substring', () => {
    const r = scoreAll('dau', { metrics: [ARPDAU, DAU], concepts: [REV, COUNTRY] });
    expect(r[0].label).toBe('DAU');
    expect(r[0].score).toBeGreaterThan(r[1].score);
  });

  it('finds concept by FQN substring', () => {
    const r = scoreAll('revenue_vnd', {
      metrics: [ARPDAU, DAU],
      concepts: [REV, COUNTRY],
    });
    const fqnHit = r.find((x) => x.id === 'measure:recharge.revenue_vnd');
    expect(fqnHit).toBeTruthy();
  });

  it('finds concept by description', () => {
    const r = scoreAll('in-game', {
      metrics: [],
      concepts: [REV, COUNTRY],
    });
    expect(r[0].id).toBe('measure:recharge.revenue_vnd');
  });

  it('routes to correct detail URLs', () => {
    const r = scoreAll('country', { metrics: [], concepts: [COUNTRY] });
    expect(r[0].routeTo).toBe('/catalog/concept/dimension/mf_users.country');
    const m = scoreAll('arpdau', { metrics: [ARPDAU], concepts: [] });
    expect(m[0].routeTo).toBe('/catalog/metric/arpdau');
  });
});
