/**
 * FE validate-metric-refs — confirms it produces the same "missing" set as
 * the server validator would for the same fixture. Keep this test in sync
 * with `server/test/metric-ref-validator*.test.ts` (it intentionally uses the
 * same shape).
 */

import { describe, it, expect } from 'vitest';
import { findMissingRefs, snapshotFromCubes } from '../validate-metric-refs';
import type { BusinessMetric } from '../../pages/Catalog/metrics-tab/business-metric-types';
import type { CatalogCube } from '../../pages/Catalog/use-catalog-meta';

const CUBES: CatalogCube[] = [
  {
    name: 'mf_users',
    measures: [{ name: 'mf_users.user_count' }, { name: 'mf_users.dau' }],
    dimensions: [{ name: 'mf_users.country' }],
  },
];

const SNAPSHOT = snapshotFromCubes(CUBES);

function measure(id: string, ref: string): BusinessMetric {
  return {
    id,
    label: id,
    description: '',
    tier: 1,
    domain: 'engagement',
    owner: 'data@vng',
    trust: 'certified',
    formula: { type: 'measure', ref },
  };
}

describe('findMissingRefs', () => {
  it('returns empty when every ref resolves', () => {
    const m = measure('dau', 'mf_users.dau');
    expect(findMissingRefs(m, SNAPSHOT)).toEqual([]);
  });

  it('flags refs whose member is missing on a known cube', () => {
    const m = measure('npu', 'mf_users.new_users');
    expect(findMissingRefs(m, SNAPSHOT)).toEqual(['mf_users.new_users']);
  });

  it('flags refs on an unknown cube', () => {
    const m = measure('foo', 'nope.bar');
    expect(findMissingRefs(m, SNAPSHOT)).toEqual(['nope.bar']);
  });

  it('flags malformed refs (no cube prefix)', () => {
    const m = measure('bad', 'no_dot');
    expect(findMissingRefs(m, SNAPSHOT)).toEqual(['no_dot']);
  });

  it('handles ratio formulas — checks both numerator and denominator', () => {
    const m: BusinessMetric = {
      id: 'paid_rate',
      label: 'Paid Rate',
      description: '',
      tier: 2,
      domain: 'revenue',
      owner: 'data@vng',
      trust: 'certified',
      formula: { type: 'ratio', numerator: 'mf_users.paid_users', denominator: 'mf_users.user_count' },
    };
    expect(findMissingRefs(m, SNAPSHOT)).toEqual(['mf_users.paid_users']);
  });

  it('handles expression formulas with inputs[]', () => {
    const m: BusinessMetric = {
      id: 'expr',
      label: 'Expr',
      description: '',
      tier: 3,
      domain: 'engagement',
      owner: 'data@vng',
      trust: 'draft',
      formula: { type: 'expression', expression: 'a + b', inputs: ['mf_users.dau', 'gone.x'] },
    };
    expect(findMissingRefs(m, SNAPSHOT)).toEqual(['gone.x']);
  });
});
