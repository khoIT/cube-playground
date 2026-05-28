/**
 * /api/playground/cube-token integration tests via Fastify.inject.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import cubeTokenRoutes from '../src/routes/cube-token.js';
import workspaceHeader from '../src/middleware/workspace-header.js';
import { __resetGamesConfigCache } from '../src/services/games-config-loader.js';
import { __resetWorkspacesConfigCache } from '../src/services/workspaces-config-loader.js';

const KEYS = ['CUBE_TOKEN', 'CUBE_TOKEN_PTG', 'CUBEJS_API_SECRET'];
const saved: Record<string, string | undefined> = {};

let cwd: string;
let prevCwd: string;
let app: FastifyInstance;

beforeEach(async () => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];

  prevCwd = process.cwd();
  cwd = mkdtempSync(join(tmpdir(), 'cube-token-'));
  writeFileSync(
    join(cwd, 'gds.config.json'),
    JSON.stringify({
      defaultGameId: 'ptg',
      games: [
        { id: 'ptg', name: 'Play Together' },
        { id: 'ballistar', name: 'Ballistar' },
      ],
    }),
  );
  // Default workspace = 'local' with authMode='minted' to preserve legacy semantics
  // for tests originally written against the global-env token resolution.
  writeFileSync(
    join(cwd, 'workspaces.config.json'),
    JSON.stringify({
      default: 'local',
      workspaces: [
        {
          id: 'local',
          label: 'Local',
          cubeApiUrl: 'http://localhost:4000',
          authMode: 'minted',
          gameModel: 'game_id',
        },
      ],
    }),
  );
  process.chdir(cwd);
  __resetGamesConfigCache();
  __resetWorkspacesConfigCache();

  app = Fastify();
  await app.register(workspaceHeader);
  await app.register(cubeTokenRoutes);
});

afterEach(async () => {
  await app.close();
  process.chdir(prevCwd);
  rmSync(cwd, { recursive: true, force: true });
  __resetGamesConfigCache();
  __resetWorkspacesConfigCache();
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('GET /api/playground/cube-token', () => {
  it('400 when game query is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/playground/cube-token' });
    expect(res.statusCode).toBe(400);
  });

  it('404 when game is not in registry', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/playground/cube-token?game=unknown',
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns env token when CUBE_TOKEN_<GAME> is set', async () => {
    process.env.CUBE_TOKEN_PTG = 'env-ptg';
    const res = await app.inject({
      method: 'GET',
      url: '/api/playground/cube-token?game=ptg',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ token: 'env-ptg', source: 'env' });
  });

  it('mints a JWT when CUBEJS_API_SECRET is set', async () => {
    process.env.CUBEJS_API_SECRET = 'shared-secret';
    const res = await app.inject({
      method: 'GET',
      url: '/api/playground/cube-token?game=ballistar',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; source: string };
    expect(body.source).toBe('minted');
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('source = none when no token strategy is configured', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/playground/cube-token?game=ptg',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ token: null, source: 'none' });
  });
});
