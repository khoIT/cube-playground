import { describe, expect, it } from 'vitest';

import type { BusinessMetric } from '../business-metric-types';
import {
  emptyFilters,
  useFilteredMetrics,
} from '../use-filtered-metrics';

function make(
  id: string,
  patch: Partial<BusinessMetric> = {},
): BusinessMetric {
  return {
    id,
    label: id.toUpperCase(),
    description: `${id} description`,
    tier: 1,
    domain: 'engagement',
    owner: 'data@vng',
    trust: 'certified',
    formula: { type: 'measure', ref: 'mf_users.dau' },
    ...patch,
  };
}

const ALL_CUBES = new Set(['mf_users', 'recharge']);
const PTG_CUBES = new Set(['recharge']);

describe('useFilteredMetrics', () => {
  it('returns everything when no filters and query empty', () => {
    const metrics = [make('dau'), make('arpdau', { domain: 'revenue' })];
    const r = useFilteredMetrics(metrics, emptyFilters(), '', ALL_CUBES);
    expect(r.visible).toHaveLength(2);
    expect(r.availableCount).toBe(2);
  });

  it('filters by domain set', () => {
    const metrics = [
      make('dau', { domain: 'engagement' }),
      make('arpdau', { domain: 'revenue' }),
      make('mau', { domain: 'engagement' }),
    ];
    const filters = emptyFilters();
    filters.domains.add('revenue');
    const r = useFilteredMetrics(metrics, filters, '', ALL_CUBES);
    expect(r.visible.map((v) => v.metric.id)).toEqual(['arpdau']);
  });

  it('filters by trust set', () => {
    const metrics = [
      make('a', { trust: 'certified' }),
      make('b', { trust: 'beta' }),
      make('c', { trust: 'draft' }),
    ];
    const filters = emptyFilters();
    filters.trusts.add('beta');
    filters.trusts.add('draft');
    const r = useFilteredMetrics(metrics, filters, '', ALL_CUBES);
    expect(r.visible.map((v) => v.metric.id).sort()).toEqual(['b', 'c']);
  });

  it('substring matches label, synonyms, and description', () => {
    const metrics = [
      make('arpdau', {
        label: 'ARPDAU',
        synonyms: ['arpu_daily', 'avg_rev_per_dau'],
      }),
      make('dau'),
    ];
    const r1 = useFilteredMetrics(metrics, emptyFilters(), 'arpu_daily', ALL_CUBES);
    expect(r1.visible.map((v) => v.metric.id)).toEqual(['arpdau']);
    const r2 = useFilteredMetrics(metrics, emptyFilters(), 'description', ALL_CUBES);
    expect(r2.visible).toHaveLength(2);
  });

  it('marks metrics requiring missing cubes as unavailable', () => {
    const metrics = [
      make('dau', {
        game_compatibility: { required_cubes: ['mf_users'] },
      }),
      make('revenue', {
        game_compatibility: { required_cubes: ['recharge'] },
      }),
    ];
    const filters = emptyFilters();
    filters.hideUnavailable = false;
    const r = useFilteredMetrics(metrics, filters, '', PTG_CUBES);
    expect(r.availableCount).toBe(1);
    expect(r.visible.find((v) => v.metric.id === 'dau')?.available).toBe(false);
    expect(r.visible.find((v) => v.metric.id === 'dau')?.missingCubes).toEqual(['mf_users']);
  });

  it('hides unavailable when toggle is on (default)', () => {
    const metrics = [
      make('dau', { game_compatibility: { required_cubes: ['mf_users'] } }),
      make('revenue', { game_compatibility: { required_cubes: ['recharge'] } }),
    ];
    const r = useFilteredMetrics(metrics, emptyFilters(), '', PTG_CUBES);
    expect(r.visible.map((v) => v.metric.id)).toEqual(['revenue']);
    expect(r.hiddenByGame).toBe(1);
  });

  it('hides deprecated by default and shows them when toggle is on', () => {
    const metrics = [
      make('old', { trust: 'deprecated' }),
      make('current'),
    ];
    const r1 = useFilteredMetrics(metrics, emptyFilters(), '', ALL_CUBES);
    expect(r1.visible.map((v) => v.metric.id)).toEqual(['current']);

    const filters = emptyFilters();
    filters.showDeprecated = true;
    const r2 = useFilteredMetrics(metrics, filters, '', ALL_CUBES);
    expect(r2.visible.map((v) => v.metric.id).sort()).toEqual(['current', 'old']);
  });

  it('treats metrics without game_compatibility as universally available', () => {
    const metrics = [make('m1')];
    const r = useFilteredMetrics(metrics, emptyFilters(), '', new Set());
    expect(r.availableCount).toBe(1);
    expect(r.visible).toHaveLength(1);
  });
});
