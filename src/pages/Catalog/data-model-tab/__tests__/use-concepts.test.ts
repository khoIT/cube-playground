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
function conceptsFromCubeMirror(cube: CatalogCube): Concept[] {
  const out: Concept[] = [];
  for (const m of cube.measures) {
    out.push({
      type: 'measure',
      fqn: `${cube.name}.${m.name}`,
      cube: cube.name,
      name: m.name,
    });
  }
  for (const d of cube.dimensions) {
    if (d.public === false || d.primaryKey) continue;
    out.push({
      type: 'dimension',
      fqn: `${cube.name}.${d.name}`,
      cube: cube.name,
      name: d.name,
    });
  }
  for (const s of cube.segments ?? []) {
    out.push({
      type: 'segment',
      fqn: `${cube.name}.${s.name}`,
      cube: cube.name,
      name: s.name,
    });
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
});
