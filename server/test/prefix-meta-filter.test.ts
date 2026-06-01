/**
 * prefix-meta-filter: game-scoping of Cube /meta on prefix workspaces.
 * Verifies cross-game cubes are dropped on prefix workspaces, game_id
 * workspaces are untouched, and malformed/empty bodies pass through safely.
 */

import { describe, expect, it } from 'vitest';
import { gamePrefixFor, filterMetaToGamePrefix } from '../src/services/prefix-meta-filter.js';

const prefixWs = {
  gameModel: 'prefix' as const,
  gamePrefixMap: { ballistar: 'ballistar', cfm_vn: 'cfm', jus_vn: 'jus' },
};
const gameIdWs = { gameModel: 'game_id' as const, gamePrefixMap: undefined };

const meta = {
  cubes: [
    { name: 'ballistar_recharge' },
    { name: 'ballistar_user_recharge_daily' },
    { name: 'cfm_recharge' },
    { name: 'jus_recharge' },
  ],
};

describe('gamePrefixFor', () => {
  it('resolves the prefix for a mapped game on a prefix workspace', () => {
    expect(gamePrefixFor(prefixWs, 'ballistar')).toBe('ballistar');
    expect(gamePrefixFor(prefixWs, 'cfm_vn')).toBe('cfm');
  });

  it('returns null on game_id workspaces (no filtering)', () => {
    expect(gamePrefixFor(gameIdWs, 'ballistar')).toBeNull();
  });

  it('returns null for a missing game or unmapped game', () => {
    expect(gamePrefixFor(prefixWs, null)).toBeNull();
    expect(gamePrefixFor(prefixWs, 'unknown_game')).toBeNull();
  });
});

describe('filterMetaToGamePrefix', () => {
  it('keeps only cubes matching the prefix on a prefix workspace', () => {
    const out = filterMetaToGamePrefix(meta, 'ballistar') as typeof meta;
    expect(out.cubes.map((c) => c.name)).toEqual([
      'ballistar_recharge',
      'ballistar_user_recharge_daily',
    ]);
  });

  it('does not match a game whose name is a prefix of another (exact `_` boundary)', () => {
    // 'cfm' must not also match a hypothetical 'cfmx_*' cube.
    const m = { cubes: [{ name: 'cfm_recharge' }, { name: 'cfmx_recharge' }] };
    const out = filterMetaToGamePrefix(m, 'cfm') as typeof m;
    expect(out.cubes.map((c) => c.name)).toEqual(['cfm_recharge']);
  });

  it('returns the body unchanged when prefix is null (no-op for game_id)', () => {
    expect(filterMetaToGamePrefix(meta, null)).toBe(meta);
  });

  it('passes through malformed / non-meta bodies safely', () => {
    expect(filterMetaToGamePrefix(null, 'ballistar')).toBeNull();
    expect(filterMetaToGamePrefix({ error: 'boom' }, 'ballistar')).toEqual({ error: 'boom' });
    const noCubes = { something: 1 };
    expect(filterMetaToGamePrefix(noCubes, 'ballistar')).toBe(noCubes);
  });

  it('tolerates cubes with a missing/non-string name', () => {
    const m = { cubes: [{ name: 'ballistar_x' }, {}, { name: 123 }] };
    const out = filterMetaToGamePrefix(m, 'ballistar') as { cubes: unknown[] };
    expect(out.cubes).toEqual([{ name: 'ballistar_x' }]);
  });
});
