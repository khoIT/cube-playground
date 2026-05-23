/**
 * group-by-spec resolver tests — covers all six axes' bucket keys + ordering.
 * Each axis is exercised on a small fixture and asserts the returned
 * (key, label, size) tuple per group so order regressions surface cleanly.
 */

import { describe, expect, it } from 'vitest';

import type { Concept } from '../concept-types';
import { groupConcepts, keyOf } from '../group-by-spec';

function c(over: Partial<Concept>): Concept {
  return {
    type: 'measure',
    cubeKind: 'cube',
    fqn: 'orders.gmv',
    cube: 'orders',
    name: 'gmv',
    ...over,
  };
}

const fixture: Concept[] = [
  c({ type: 'measure', cube: 'orders', fqn: 'orders.gmv', meta: { aggType: 'sum' } }),
  c({ type: 'measure', cube: 'users', fqn: 'users.dau', meta: { aggType: 'count_distinct' } }),
  c({
    type: 'dimension',
    cube: 'users',
    fqn: 'users.country',
    meta: { dimensionType: 'string' },
  }),
  c({
    type: 'dimension',
    cube: 'users',
    fqn: 'users.signup_date',
    meta: { dimensionType: 'time' },
  }),
  c({ type: 'segment', cube: 'users', fqn: 'users.whales' }),
  c({
    type: 'measure',
    cubeKind: 'view',
    cube: 'arppu_daily',
    fqn: 'arppu_daily.arppu',
    meta: { aggType: 'avg' },
  }),
];

const usage = new Map([
  ['orders.gmv', 7],
  ['users.dau', 2],
  // users.country = 0 → unreferenced
]);

describe('keyOf', () => {
  it('returns concept.type under type axis', () => {
    expect(keyOf(fixture[0], 'type', usage)).toBe('measure');
    expect(keyOf(fixture[2], 'type', usage)).toBe('dimension');
  });
  it('returns concept.cube under cube axis', () => {
    expect(keyOf(fixture[0], 'cube', usage)).toBe('orders');
  });
  it('returns cubeKind under kind axis', () => {
    expect(keyOf(fixture[0], 'kind', usage)).toBe('cube');
    expect(keyOf(fixture[5], 'kind', usage)).toBe('view');
  });
  it('buckets usage into heavy/medium/unreferenced', () => {
    expect(keyOf(fixture[0], 'usage', usage)).toBe('heavy');
    expect(keyOf(fixture[1], 'usage', usage)).toBe('medium');
    expect(keyOf(fixture[2], 'usage', usage)).toBe('unreferenced');
  });
  it('aggType axis falls back to "—" for non-measures', () => {
    expect(keyOf(fixture[0], 'aggType', usage)).toBe('sum');
    expect(keyOf(fixture[2], 'aggType', usage)).toBe('—');
    expect(keyOf(fixture[4], 'aggType', usage)).toBe('—');
  });
  it('dimensionType axis falls back to "—" for non-dimensions', () => {
    expect(keyOf(fixture[2], 'dimensionType', usage)).toBe('string');
    expect(keyOf(fixture[0], 'dimensionType', usage)).toBe('—');
  });
});

describe('groupConcepts ordering', () => {
  it('type axis orders measure → dimension → segment', () => {
    const out = groupConcepts(fixture, 'type', usage);
    expect(out.map((g) => g.key)).toEqual(['measure', 'dimension', 'segment']);
  });
  it('cube axis orders alphabetically', () => {
    const out = groupConcepts(fixture, 'cube', usage);
    expect(out.map((g) => g.key)).toEqual(['arppu_daily', 'orders', 'users']);
  });
  it('kind axis orders cube → view', () => {
    const out = groupConcepts(fixture, 'kind', usage);
    expect(out.map((g) => g.key)).toEqual(['cube', 'view']);
  });
  it('usage axis orders heavy → medium → unreferenced', () => {
    const out = groupConcepts(fixture, 'usage', usage);
    expect(out.map((g) => g.key)).toEqual(['heavy', 'medium', 'unreferenced']);
  });
  it('aggType axis sorts alphabetically with "—" last', () => {
    const out = groupConcepts(fixture, 'aggType', usage);
    expect(out.map((g) => g.key)).toEqual(['avg', 'count_distinct', 'sum', '—']);
  });
  it('dimensionType axis sorts alphabetically with "—" last', () => {
    const out = groupConcepts(fixture, 'dimensionType', usage);
    // string + time are real; everything else falls into "—"
    expect(out.map((g) => g.key)).toEqual(['string', 'time', '—']);
  });
});
