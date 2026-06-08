/**
 * Drift guard for the server-local member-360 registry + query-builder copies.
 * The FE registry is canonical (`src/pages/Segments/member360/…`); the server
 * cannot import it at build time (tsconfig rootDir), so these tests deep-compare
 * the copies at test time — any divergence fails CI instead of silently serving
 * stale panel shapes from the precompute cache.
 *
 * Limitation: the FE's PANELS_BY_GAME keys aren't exported, so a brand-new game
 * added FE-side is asserted via the known-games list below — extend it when a
 * game gains a user_360 registry entry.
 */

import { describe, it, expect } from 'vitest';

// FE canonical registry/builder — type-only FE deps are erased by the vitest
// transform, so importing across the package boundary is safe in tests.
import {
  panelsForGame,
  type Member360Panel as FePanel,
} from '../../src/pages/Segments/member360/member360-panels';
import { buildPanelQuery as feBuildPanelQuery } from '../../src/pages/Segments/member360/build-panel-query';

import {
  corePanelsForGame,
  type Member360Panel as ServerPanel,
} from '../src/services/member360-panel-registry.js';
import { buildPanelQuery as serverBuildPanelQuery } from '../src/services/member360-panel-query.js';

const KNOWN_360_GAMES = ['cfm', 'cfm_vn', 'ballistar', 'ballistar_vn', 'jus', 'jus_vn'];

describe('member360 server registry parity', () => {
  it.each(KNOWN_360_GAMES)('%s: server core panels equal the FE core subset', (game) => {
    const feCore = panelsForGame(game).filter((p) => p.section === 'core');
    expect(feCore.length).toBeGreaterThan(0);
    // toEqual treats explicitly-undefined keys (col() helper) as missing — the
    // comparison is structural, exactly what JSON round-tripping would give.
    expect(corePanelsForGame(game)).toEqual(feCore);
  });

  it('returns [] for games without a 360 registry entry (FE agrees)', () => {
    for (const game of ['muaw', 'gunpow', null, undefined, '']) {
      expect(corePanelsForGame(game)).toEqual([]);
      expect(panelsForGame(game).filter((p) => p.section === 'core')).toEqual([]);
    }
  });
});

describe('member360 server query-builder parity', () => {
  const allFePanels = KNOWN_360_GAMES.flatMap((g) => panelsForGame(g));

  it('builds identical queries to the FE for every registry panel', () => {
    // Fixed range so behavior panels don't take the `new Date()` default path.
    const range: [string, string] = ['2026-05-01', '2026-05-30'];
    for (const panel of allFePanels) {
      // FE panel objects structurally satisfy the server's Member360Panel.
      const server = serverBuildPanelQuery(panel as unknown as ServerPanel, ['u_1'], range);
      const fe = feBuildPanelQuery(panel as FePanel, ['u_1'], range);
      expect(server, `panel ${panel.view}/${panel.id}`).toEqual(fe);
    }
  });

  it('returns null on empty identity values (both builders)', () => {
    const panel = panelsForGame('ballistar')[0];
    expect(serverBuildPanelQuery(panel as unknown as ServerPanel, [])).toBeNull();
    expect(feBuildPanelQuery(panel, [])).toBeNull();
  });

  it('keys the identity filter by panel.identityKey, not a blanket dim', () => {
    const login = panelsForGame('cfm').find((p) => p.id === 'login')!;
    const q = serverBuildPanelQuery(login as unknown as ServerPanel, ['u_9'], ['2026-05-01', '2026-05-30']);
    expect(q?.filters[0]).toEqual({
      member: 'user_login_panel.clientsdkuserid',
      operator: 'equals',
      values: ['u_9'],
    });
  });
});
