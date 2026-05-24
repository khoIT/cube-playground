import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { searchMembers, useCartographerIndex } from '../use-cartographer-index';
import type { CatalogCube } from '../../use-catalog-meta';

const fakeCubes: CatalogCube[] = [
  {
    name: 'players',
    title: 'Players',
    measures: [
      { name: 'dau', title: 'Daily Active Users', description: 'Distinct uid per day' },
      { name: 'mau', title: 'Monthly Active Users' },
    ],
    dimensions: [
      { name: 'country', title: 'Country' },
    ],
  },
  {
    name: 'orders',
    measures: [
      { name: 'gross_revenue', title: 'Gross Revenue', aggType: 'sum' },
    ],
    dimensions: [
      { name: 'platform' },
    ],
    segments: [
      { name: 'whales', title: 'Whales', description: 'Top 1% spenders' },
    ],
  },
];

describe('useCartographerIndex', () => {
  it('flattens measures/dimensions/segments into a single member list keyed by fqn', () => {
    const { result } = renderHook(() => useCartographerIndex(fakeCubes));
    const fqns = result.current.members.map((m) => m.fqn);
    expect(fqns).toContain('players.dau');
    expect(fqns).toContain('orders.gross_revenue');
    expect(fqns).toContain('orders.whales');
    expect(result.current.byFqn.get('orders.whales')?.kind).toBe('segment');
  });
});

describe('searchMembers', () => {
  const { result } = renderHook(() => useCartographerIndex(fakeCubes));
  const index = result.current;

  it('returns all members when query is empty', () => {
    expect(searchMembers(index, '').length).toBe(index.members.length);
  });

  it('matches title, fqn, and description', () => {
    expect(searchMembers(index, 'DAU').some((m) => m.fqn === 'players.dau')).toBe(true);
    expect(searchMembers(index, 'gross').some((m) => m.fqn === 'orders.gross_revenue')).toBe(true);
    expect(searchMembers(index, 'spender').some((m) => m.fqn === 'orders.whales')).toBe(true);
  });

  it('respects the result limit', () => {
    expect(searchMembers(index, '', 2).length).toBe(2);
  });
});
