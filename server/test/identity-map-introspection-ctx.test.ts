import { describe, it, expect, vi, beforeEach } from 'vitest';

// loadGamesConfig is read inside introspectionCtx for the default-game fallback.
vi.mock('../src/services/games-config-loader.js', () => ({
  loadGamesConfig: vi.fn(() => ({ defaultGameId: 'ballistar', games: [] })),
}));

import { introspectionCtx } from '../src/routes/identity-map.js';
import type { FastifyRequest } from 'fastify';

const SERVICE = { cubeApiUrl: 'http://cube', token: 'service-principal-token' };

describe('introspectionCtx', () => {
  beforeEach(() => vi.clearAllMocks());

  it('always uses the service-principal builder (never the per-user one)', () => {
    const introspectGames: (string | null)[] = [];
    let userScoped = 0;
    const req = {
      headers: { 'x-cube-game': 'cfm' },
      workspace: { gameModel: 'game_id' },
      cubeCtx: { cubeApiUrl: 'http://cube', token: 'user-email-token' },
      buildCubeCtxForGame: () => { userScoped += 1; return SERVICE; },
      buildIntrospectionCtxForGame: (g: string | null) => { introspectGames.push(g); return SERVICE; },
    } as unknown as FastifyRequest;

    const ctx = introspectionCtx(req);
    expect(ctx).toBe(SERVICE);
    expect(userScoped).toBe(0); // critical: the per-user/email path is never taken
    expect(introspectGames).toEqual(['cfm']); // pinned tenant forwarded
  });

  it('falls back to the default game on a game_id workspace with no pinned tenant', () => {
    const introspectGames: (string | null)[] = [];
    const req = {
      headers: {},
      workspace: { gameModel: 'game_id' },
      cubeCtx: { token: 'x', cubeApiUrl: 'http://cube' },
      buildCubeCtxForGame: () => SERVICE,
      buildIntrospectionCtxForGame: (g: string | null) => { introspectGames.push(g); return SERVICE; },
    } as unknown as FastifyRequest;
    introspectionCtx(req);
    expect(introspectGames).toEqual(['ballistar']);
  });

  it('passes a null game on a prefix workspace (open cube, game-less /meta is fine)', () => {
    const introspectGames: (string | null)[] = [];
    const req = {
      headers: {},
      workspace: { gameModel: 'prefix' },
      cubeCtx: { token: 'x', cubeApiUrl: 'http://cube' },
      buildCubeCtxForGame: () => SERVICE,
      buildIntrospectionCtxForGame: (g: string | null) => { introspectGames.push(g); return SERVICE; },
    } as unknown as FastifyRequest;
    introspectionCtx(req);
    expect(introspectGames).toEqual([null]);
  });

  it('treats a blank game header as no pin', () => {
    const introspectGames: (string | null)[] = [];
    const req = {
      headers: { 'x-cube-game': '   ' },
      workspace: { gameModel: 'game_id' },
      cubeCtx: { token: 'x', cubeApiUrl: 'http://cube' },
      buildCubeCtxForGame: () => SERVICE,
      buildIntrospectionCtxForGame: (g: string | null) => { introspectGames.push(g); return SERVICE; },
    } as unknown as FastifyRequest;
    introspectionCtx(req);
    expect(introspectGames).toEqual(['ballistar']);
  });
});
