/**
 * Token-overlap-based alt-measure suggester. Verifies that:
 *   - the suggester rejects snapshot-cube measures
 *   - it returns time-aware measures sorted by overlap score
 *   - it returns empty on no overlap
 *   - shortTitle factors into the token pool
 */

import { describe, it, expect } from 'vitest';
import { suggestTimeAwareAlternatives } from '../../src/nl-to-query/time-aware-measure-suggester.js';

const META = {
  cubes: [
    {
      name: 'recharge',
      measures: [
        { name: 'recharge.revenue_vnd', shortTitle: 'Revenue (VND)' },
        { name: 'recharge.transactions', shortTitle: 'Transactions' },
      ],
      dimensions: [
        { name: 'recharge.created_at', type: 'time' },
        { name: 'recharge.channel', type: 'string' },
      ],
    },
    {
      name: 'mf_users',
      measures: [
        { name: 'mf_users.arpu_vnd', shortTitle: 'ARPU (lifetime)' },
        { name: 'mf_users.count', shortTitle: 'Users' },
      ],
      dimensions: [{ name: 'mf_users.id', type: 'string' }],
    },
    {
      name: 'players',
      measures: [{ name: 'players.daily_arpu', shortTitle: 'Daily ARPU' }],
      dimensions: [{ name: 'players.event_at', type: 'time' }],
    },
  ],
};

describe('suggestTimeAwareAlternatives', () => {
  it('returns an empty list when no time-aware measure shares tokens', () => {
    const r = suggestTimeAwareAlternatives(META, 'mf_users.count', 'Users');
    expect(r).toEqual([]);
  });

  it('skips measures on snapshot cubes', () => {
    // mf_users has no time dim. arpu suggestions must not include any
    // mf_users.* refs even though name overlap is highest there.
    const r = suggestTimeAwareAlternatives(META, 'mf_users.arpu_vnd', 'ARPU (lifetime)');
    expect(r.every((s) => !s.ref.startsWith('mf_users.'))).toBe(true);
  });

  it('finds the daily_arpu alternative for arpu_vnd', () => {
    const r = suggestTimeAwareAlternatives(META, 'mf_users.arpu_vnd', 'ARPU (lifetime)');
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].ref).toBe('players.daily_arpu');
    expect(r[0].label).toBe('Daily ARPU');
  });

  it('returns recharge.revenue_vnd for a rejected revenue measure on a snapshot', () => {
    const r = suggestTimeAwareAlternatives(
      { ...META, cubes: [...META.cubes, { name: 'lifetime_users', measures: [{ name: 'lifetime_users.total_revenue_vnd' }], dimensions: [] }] },
      'lifetime_users.total_revenue_vnd',
      'Total Revenue (VND)',
    );
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].ref).toBe('recharge.revenue_vnd');
  });

  it('respects the topN cap', () => {
    const r = suggestTimeAwareAlternatives(META, 'mf_users.arpu_vnd', 'ARPU', 1);
    expect(r.length).toBeLessThanOrEqual(1);
  });
});
