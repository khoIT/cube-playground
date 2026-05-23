import { describe, expect, it } from 'vitest';
import type { Query } from '@cubejs-client/core';

import { applyGameFilter } from './apply-game-filter';

const cubesWithGame = new Set(['Orders', 'Players']);
const hasGameDim = (c: string) => cubesWithGame.has(c);

describe('applyGameFilter', () => {
  it('returns null/undefined input unchanged', () => {
    expect(applyGameFilter(null, 'ptg', hasGameDim)).toBeNull();
    expect(applyGameFilter(undefined, 'ptg', hasGameDim)).toBeNull();
  });

  it('returns query unchanged when gameId is empty', () => {
    const q: Query = { measures: ['Orders.count'] };
    expect(applyGameFilter(q, '', hasGameDim)).toBe(q);
  });

  it('appends an equals filter for each referenced cube that exposes gameId', () => {
    const q: Query = {
      measures: ['Orders.count'],
      dimensions: ['Players.country'],
    };
    const out = applyGameFilter(q, 'ptg', hasGameDim)!;
    expect(out.filters).toEqual([
      { member: 'Orders.gameId', operator: 'equals', values: ['ptg'] },
      { member: 'Players.gameId', operator: 'equals', values: ['ptg'] },
    ]);
  });

  it('skips cubes whose game dim is unknown', () => {
    const q: Query = { measures: ['Orders.count', 'NoGame.count'] };
    const out = applyGameFilter(q, 'ptg', hasGameDim)!;
    expect(out.filters).toEqual([
      { member: 'Orders.gameId', operator: 'equals', values: ['ptg'] },
    ]);
  });

  it('is idempotent when filter already present', () => {
    const q: Query = {
      measures: ['Orders.count'],
      filters: [{ member: 'Orders.gameId', operator: 'equals', values: ['ptg'] }],
    };
    const out = applyGameFilter(q, 'ptg', hasGameDim)!;
    expect(out).toBe(q);
  });

  it('preserves existing filters when appending', () => {
    const q: Query = {
      measures: ['Orders.count'],
      filters: [{ member: 'Orders.status', operator: 'equals', values: ['paid'] }],
    };
    const out = applyGameFilter(q, 'ptg', hasGameDim)!;
    expect(out.filters).toEqual([
      { member: 'Orders.status', operator: 'equals', values: ['paid'] },
      { member: 'Orders.gameId', operator: 'equals', values: ['ptg'] },
    ]);
  });

  it('considers timeDimensions and segments when discovering cubes', () => {
    const q: Query = {
      measures: ['Orders.count'],
      timeDimensions: [{ dimension: 'Players.createdAt', granularity: 'day' }],
      segments: ['Players.active'],
    };
    const out = applyGameFilter(q, 'ptg', hasGameDim)!;
    const members = (out.filters ?? []).map((f: any) => f.member).sort();
    expect(members).toEqual(['Orders.gameId', 'Players.gameId']);
  });
});
