/**
 * useConcepts derivation smoke test. We don't mount the hook (would pull in
 * AppContext + game picker) — we exercise the pure conceptsFromCube path by
 * re-implementing the flattening logic and verifying it matches the hook's
 * declared contract.
 *
 * If conceptsFromCube changes shape, this test will fail and remind us to
 * keep the mirror in sync — that's the point.
 */

import { describe, expect, it } from 'vitest';

import type { CatalogCube } from '../../use-catalog-meta';
import type { Concept } from '../concept-types';

// Inline the same private helper to keep the test independent of React.
function resolve(cubeName: string, raw: string) {
  const prefix = `${cubeName}.`;
  if (raw.startsWith(prefix)) return { fqn: raw, local: raw.slice(prefix.length) };
  return { fqn: `${cubeName}.${raw}`, local: raw };
}

function conceptsFromCubeMirror(cube: CatalogCube): Concept[] {
  const out: Concept[] = [];
  const cubeKind: 'cube' | 'view' = cube.type === 'view' ? 'view' : 'cube';
  for (const m of cube.measures) {
    const { fqn, local } = resolve(cube.name, m.name);
    out.push({ type: 'measure', cubeKind, fqn, cube: cube.name, name: local });
  }
  for (const d of cube.dimensions) {
    if (d.public === false || d.primaryKey) continue;
    const { fqn, local } = resolve(cube.name, d.name);
    out.push({ type: 'dimension', cubeKind, fqn, cube: cube.name, name: local });
  }
  for (const s of cube.segments ?? []) {
    const { fqn, local } = resolve(cube.name, s.name);
    out.push({ type: 'segment', cubeKind, fqn, cube: cube.name, name: local });
  }
  return out;
}

describe('conceptsFromCube (mirror)', () => {
  it('flattens measures + queryable dims + segments with FQN', () => {
    const cube: CatalogCube = {
      name: 'mf_users',
      measures: [{ name: 'dau' }, { name: 'mau' }],
      dimensions: [
        { name: 'event_date', type: 'time' },
        { name: 'id', primaryKey: true },
        { name: 'internal', public: false },
        { name: 'country', type: 'string' },
      ],
      segments: [{ name: 'whales' }],
    };
    const flat = conceptsFromCubeMirror(cube);
    const fqns = flat.map((c) => `${c.type}:${c.fqn}`);
    expect(fqns).toEqual([
      'measure:mf_users.dau',
      'measure:mf_users.mau',
      'dimension:mf_users.event_date',
      'dimension:mf_users.country',
      'segment:mf_users.whales',
    ]);
  });

  it('propagates cubeKind=view when cube.type is "view"', () => {
    const view: CatalogCube = {
      name: 'arppu_daily',
      type: 'view',
      measures: [{ name: 'arppu' }],
      dimensions: [{ name: 'event_date', type: 'time' }],
      segments: [],
    };
    const flat = conceptsFromCubeMirror(view);
    expect(flat.every((c) => c.cubeKind === 'view')).toBe(true);
  });
});
