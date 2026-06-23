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

// Real prod cube names are `<gameId>__<concept>` (double underscore).
const meta = {
  cubes: [
    { name: 'ballistar__recharge' },
    { name: 'ballistar__user_recharge_daily' },
    { name: 'cfm_vn__recharge' },
    { name: 'jus_vn__recharge' },
  ],
};

describe('gamePrefixFor', () => {
  it('uses a gamePrefixMap override when present (id ≠ prefix)', () => {
    expect(gamePrefixFor(prefixWs, 'ballistar')).toBe('ballistar');
    expect(gamePrefixFor(prefixWs, 'cfm_vn')).toBe('cfm');
  });

  it('returns null on game_id workspaces (no filtering)', () => {
    expect(gamePrefixFor(gameIdWs, 'ballistar')).toBeNull();
  });

  it('returns null for a missing game', () => {
    expect(gamePrefixFor(prefixWs, null)).toBeNull();
  });

  it('defaults an unmapped game to its id (prod names cubes <gameId>__*)', () => {
    // No map entry → the game id IS the prefix. This is what lets every game
    // the cube serves resolve without an explicit gamePrefixMap entry.
    expect(gamePrefixFor(prefixWs, 'ptg')).toBe('ptg');
    expect(gamePrefixFor({ gameModel: 'prefix' as const, gamePrefixMap: undefined }, 'nikki')).toBe(
      'nikki',
    );
  });
});

describe('filterMetaToGamePrefix', () => {
  it('keeps only cubes matching the prefix on a prefix workspace', () => {
    const out = filterMetaToGamePrefix(meta, 'ballistar') as typeof meta;
    expect(out.cubes.map((c) => c.name)).toEqual([
      'ballistar__recharge',
      'ballistar__user_recharge_daily',
    ]);
  });

  it('does NOT leak a sibling tenant whose id extends this one (the `__` boundary)', () => {
    // Real registry has `ballistar`, `ballistar_twid`, `ballistar_vn` as distinct
    // tenants. Scoping to `ballistar` must NOT pull in `ballistar_twid__*` /
    // `ballistar_vn__*` — a single-`_` needle would (cross-tenant leak).
    const m = {
      cubes: [
        { name: 'ballistar__active_daily' },
        { name: 'ballistar_twid__active_daily' },
        { name: 'ballistar_vn__active_daily' },
      ],
    };
    const out = filterMetaToGamePrefix(m, 'ballistar') as typeof m;
    expect(out.cubes.map((c) => c.name)).toEqual(['ballistar__active_daily']);
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
    const m = { cubes: [{ name: 'ballistar__x' }, {}, { name: 123 }] };
    const out = filterMetaToGamePrefix(m, 'ballistar') as { cubes: unknown[] };
    expect(out.cubes).toEqual([{ name: 'ballistar__x' }]);
  });
});
