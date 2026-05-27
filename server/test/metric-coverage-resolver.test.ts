/**
 * Unit tests for the pure coverage helpers (no network).
 */
import { describe, expect, it } from 'vitest';

import {
  referencedMeasures,
  coverageFromSnapshot,
} from '../src/services/metric-coverage-resolver.js';
import { snapshotFromMeta, validateRefs } from '../src/services/metric-ref-validator.js';
import type { BusinessMetric } from '../src/types/business-metric.js';

function metric(id: string, ref: string): BusinessMetric {
  return {
    id,
    label: id.toUpperCase(),
    description: 'x',
    tier: 2,
    domain: 'engagement',
    owner: 'data@vng',
    trust: 'certified',
    formula: { type: 'measure', ref },
  };
}

const META = {
  cubes: [
    {
      name: 'active_daily',
      measures: [{ name: 'active_daily.dau' }, { name: 'active_daily.wau' }],
      dimensions: [{ name: 'active_daily.log_date', type: 'time' }],
    },
  ],
};

describe('referencedMeasures', () => {
  it('collects fully-qualified measure refs across metrics', () => {
    const refs = referencedMeasures([metric('dau', 'active_daily.dau')]);
    expect(refs.has('active_daily.dau')).toBe(true);
    expect(refs.size).toBe(1);
  });
});

describe('coverageFromSnapshot', () => {
  const metrics = [metric('dau', 'active_daily.dau')];
  const snapshot = snapshotFromMeta(META);
  const referenced = referencedMeasures(metrics);

  it('flags meta measures referenced by no metric as uncovered', () => {
    const cov = coverageFromSnapshot('pubg', metrics, snapshot, referenced);
    expect(cov.uncoveredMeasures).toEqual(['active_daily.wau']); // dau is covered
    expect(cov.measuresInMeta).toBe(2);
    expect(cov.cubesInMeta).toBe(1);
    expect(cov.status).toBe('ok'); // no broken refs
  });

  it('broken refs equal validateRefs output (parity, no re-derivation)', () => {
    const withBroken = [...metrics, metric('ghost', 'active_daily.nope')];
    const cov = coverageFromSnapshot('pubg', withBroken, snapshot, referencedMeasures(withBroken));
    expect(cov.brokenRefs).toEqual(validateRefs(withBroken, snapshot));
    expect(cov.status).toBe('drift');
  });

  it('snapshot.measures excludes dimensions', () => {
    expect(snapshot.measures.has('active_daily.log_date')).toBe(false);
    expect(snapshot.members.has('active_daily.log_date')).toBe(true);
  });
});
