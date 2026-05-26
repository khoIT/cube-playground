import { describe, it, expect } from 'vitest';
import { recogniseCubeRefs, firstCubeRef } from '../../src/nl-to-query/recognise-cube-ref.js';

describe('recogniseCubeRefs', () => {
  const known = new Set(['recharge.revenue_vnd', 'players.country', 'players.user_id']);

  it('finds a valid ref alone', () => {
    const hits = recogniseCubeRefs('recharge.revenue_vnd', known);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      cubeRef: 'recharge.revenue_vnd',
      cube: 'recharge',
      member: 'revenue_vnd',
      span: [0, 'recharge.revenue_vnd'.length],
    });
  });

  it('finds a ref embedded in a sentence', () => {
    const hits = recogniseCubeRefs('show me recharge.revenue_vnd by country', known);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.cubeRef).toBe('recharge.revenue_vnd');
  });

  it('drops refs not in known meta', () => {
    const hits = recogniseCubeRefs('show me recharge.revenue', known);
    expect(hits).toHaveLength(0);
  });

  it('returns all hits in order when multiple refs appear', () => {
    const hits = recogniseCubeRefs('recharge.revenue_vnd and players.country', known);
    expect(hits.map((h) => h.cubeRef)).toEqual([
      'recharge.revenue_vnd',
      'players.country',
    ]);
  });

  it('skips non-ref text (no dot, mixed case, leading digit)', () => {
    expect(recogniseCubeRefs('recharge revenue', known)).toHaveLength(0);
    expect(recogniseCubeRefs('Recharge.Revenue_Vnd', known)).toHaveLength(0);
    expect(recogniseCubeRefs('1cube.member', known)).toHaveLength(0);
  });

  it('skips refs that look right but are not in known meta (typos)', () => {
    expect(recogniseCubeRefs('recharge.revenu_vnd', known)).toHaveLength(0);
  });

  it('accepts shape-only when known meta omitted', () => {
    const hits = recogniseCubeRefs('any.cube_ref_here', undefined);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.cubeRef).toBe('any.cube_ref_here');
  });
});

describe('firstCubeRef', () => {
  const known = new Set(['recharge.revenue_vnd']);

  it('returns confidence 1.0 when validated against known meta', () => {
    const out = firstCubeRef('recharge.revenue_vnd', known);
    expect(out?.confidence).toBe(1.0);
    expect(out?.hit.cubeRef).toBe('recharge.revenue_vnd');
  });

  it('returns confidence 0.7 when meta is not provided', () => {
    const out = firstCubeRef('some.thing', undefined);
    expect(out?.confidence).toBe(0.7);
  });

  it('returns null when no ref present', () => {
    expect(firstCubeRef('show me daily revenue', known)).toBeNull();
  });
});
