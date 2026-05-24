import { describe, expect, it } from 'vitest';

import type { BusinessMetric } from '../../metrics-tab/business-metric-types';
import type { Concept } from '../concept-types';
import {
  buildUsageMap,
  emptyConceptFilters,
  useFilteredConcepts,
} from '../use-filtered-concepts';
import { renderHook } from '@testing-library/react';

function concept(overrides: Partial<Concept>): Concept {
  return {
    type: 'measure',
    cubeKind: 'cube',
    fqn: 'cube.thing',
    cube: 'cube',
    name: 'thing',
    ...overrides,
  };
}

function bm(id: string, refs: string[]): BusinessMetric {
  return {
    id,
    label: id,
    description: '',
    tier: 1,
    domain: 'engagement',
    owner: 'data@vng',
    trust: 'draft',
    formula:
      refs.length === 2
        ? { type: 'ratio', numerator: refs[0], denominator: refs[1] }
        : { type: 'measure', ref: refs[0] },
  };
}

describe('buildUsageMap', () => {
  it('counts FQN occurrences across all formulas', () => {
    const m = buildUsageMap([
      bm('arpdau', ['recharge.revenue_vnd', 'mf_users.dau']),
      bm('dau', ['mf_users.dau']),
    ]);
    expect(m.get('mf_users.dau')).toBe(2);
    expect(m.get('recharge.revenue_vnd')).toBe(1);
    expect(m.get('not.in.registry')).toBeUndefined();
  });
});

describe('useFilteredConcepts', () => {
  const concepts: Concept[] = [
    concept({ type: 'measure', fqn: 'mf_users.dau', cube: 'mf_users', name: 'dau' }),
    concept({
      type: 'measure',
      fqn: 'recharge.revenue_vnd',
      cube: 'recharge',
      name: 'revenue_vnd',
      meta: { cdpProjection: true },
    }),
    concept({
      type: 'dimension',
      fqn: 'mf_users.country',
      cube: 'mf_users',
      name: 'country',
    }),
    concept({
      type: 'segment',
      fqn: 'mf_users.high_value',
      cube: 'mf_users',
      name: 'high_value',
    }),
  ];

  const metrics = [bm('dau', ['mf_users.dau'])];

  it('returns everything by default', () => {
    const { result } = renderHook(() =>
      useFilteredConcepts(concepts, emptyConceptFilters(), '', metrics),
    );
    expect(result.current.visible).toHaveLength(4);
    expect(result.current.totalCount).toBe(4);
  });

  it('filters by type', () => {
    const filters = { ...emptyConceptFilters(), types: new Set(['dimension'] as const) };
    const { result } = renderHook(() =>
      useFilteredConcepts(concepts, filters, '', metrics),
    );
    expect(result.current.visible.map((c) => c.fqn)).toEqual(['mf_users.country']);
  });

  it('filters by cube', () => {
    const filters = { ...emptyConceptFilters(), cubes: new Set(['recharge']) };
    const { result } = renderHook(() =>
      useFilteredConcepts(concepts, filters, '', metrics),
    );
    expect(result.current.visible.map((c) => c.fqn)).toEqual([
      'recharge.revenue_vnd',
    ]);
  });

  it('view filter narrows to view-kind concepts only, dropping cubes', () => {
    const withView = concepts.concat(
      concept({
        type: 'measure',
        cubeKind: 'view',
        fqn: 'arppu_daily.arppu',
        cube: 'arppu_daily',
        name: 'arppu',
      }),
    );
    const filters = { ...emptyConceptFilters(), views: new Set(['arppu_daily']) };
    const { result } = renderHook(() =>
      useFilteredConcepts(withView, filters, '', metrics),
    );
    expect(result.current.visible.map((c) => c.fqn)).toEqual([
      'arppu_daily.arppu',
    ]);
  });

  it('cubes + views filter unions across kinds', () => {
    const withView = concepts.concat(
      concept({
        type: 'measure',
        cubeKind: 'view',
        fqn: 'arppu_daily.arppu',
        cube: 'arppu_daily',
        name: 'arppu',
      }),
    );
    const filters = {
      ...emptyConceptFilters(),
      cubes: new Set(['recharge']),
      views: new Set(['arppu_daily']),
    };
    const { result } = renderHook(() =>
      useFilteredConcepts(withView, filters, '', metrics),
    );
    expect(result.current.visible.map((c) => c.fqn).sort()).toEqual([
      'arppu_daily.arppu',
      'recharge.revenue_vnd',
    ]);
  });

  it('cdpProjectedOnly narrows to projection concepts', () => {
    const filters = { ...emptyConceptFilters(), cdpProjectedOnly: true };
    const { result } = renderHook(() =>
      useFilteredConcepts(concepts, filters, '', metrics),
    );
    expect(result.current.visible.map((c) => c.fqn)).toEqual([
      'recharge.revenue_vnd',
    ]);
  });

  it('unreferencedOnly hides concepts used by any business metric', () => {
    const filters = { ...emptyConceptFilters(), unreferencedOnly: true };
    const { result } = renderHook(() =>
      useFilteredConcepts(concepts, filters, '', metrics),
    );
    expect(result.current.visible.map((c) => c.fqn)).not.toContain('mf_users.dau');
    expect(result.current.visible.map((c) => c.fqn)).toContain('recharge.revenue_vnd');
  });

  it('query matches FQN, name, and description', () => {
    const c = concepts.concat(
      concept({
        type: 'measure',
        fqn: 'orders.gmv',
        cube: 'orders',
        name: 'gmv',
        description: 'gross merchandise value',
      }),
    );
    const { result } = renderHook(() =>
      useFilteredConcepts(c, emptyConceptFilters(), 'gross', metrics),
    );
    expect(result.current.visible.map((x) => x.fqn)).toEqual(['orders.gmv']);
  });
});
