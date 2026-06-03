import { describe, it, expect, vi, beforeEach } from 'vitest';

// loadGamesConfig is read inside introspectionCtx for the default-game fallback.
vi.mock('../src/services/games-config-loader.js', () => ({
  loadGamesConfig: vi.fn(() => ({ defaultGameId: 'ballistar', games: [] })),
}));

import { introspectionCtx } from '../src/routes/identity-map.js';
import type { FastifyRequest } from 'fastify';

const GAME_LESS = { cubeApiUrl: 'http://cube', token: 'game-less-token' };
const GAME_SCOPED = { cubeApiUrl: 'http://cube', token: 'ballistar-token' };

function makeReq(opts: {
  gameHeader?: string;
  gameModel: 'game_id' | 'prefix';
}): FastifyRequest {
  return {
    headers: opts.gameHeader === undefined ? {} : { 'x-cube-game': opts.gameHeader },
    workspace: { gameModel: opts.gameModel },
    cubeCtx: GAME_LESS,
    buildCubeCtxForGame: (g: string) =>
      g === 'ballistar' ? GAME_SCOPED : { cubeApiUrl: 'http://cube', token: `${g}-token` },
  } as unknown as FastifyRequest;
}

describe('introspectionCtx', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the request ctx when a game is pinned (header present)', () => {
    const ctx = introspectionCtx(makeReq({ gameHeader: 'cfm', gameModel: 'game_id' }));
    expect(ctx).toBe(GAME_LESS); // unchanged — the middleware already scoped it
  });

  it('falls back to the default game on a game_id workspace with no pinned tenant', () => {
    // The empty-map bug: a game-less token fails checkAuth on the strict
    // multi-tenant cube, so /meta returns nothing. Fallback resolves it.
    const ctx = introspectionCtx(makeReq({ gameModel: 'game_id' }));
    expect(ctx).toBe(GAME_SCOPED);
  });

  it('treats a blank game header as no pin and falls back', () => {
    const ctx = introspectionCtx(makeReq({ gameHeader: '   ', gameModel: 'game_id' }));
    expect(ctx).toBe(GAME_SCOPED);
  });

  it('does NOT force a game on a prefix workspace (open cube, game-less /meta is fine)', () => {
    const ctx = introspectionCtx(makeReq({ gameModel: 'prefix' }));
    expect(ctx).toBe(GAME_LESS);
  });
});
