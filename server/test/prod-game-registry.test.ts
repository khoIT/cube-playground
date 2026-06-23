/**
 * prod-game-registry: per-workspace game enumeration.
 *
 * A prefix workspace lists the games its cube serves via the open `/cubes`
 * registry (mocked here — no network); a game_id workspace lists the in-repo
 * games config. Fetch failures fail-soft to a stale list or empty.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fetchProdCubeIds,
  listWorkspaceGameIds,
  __resetProdGameRegistryCache,
} from '../src/services/prod-game-registry.js';
import { loadGamesConfig } from '../src/services/games-config-loader.js';

const prefixWs = {
  id: 'prod',
  cubeApiUrl: 'https://cube.example.test',
  gameModel: 'prefix' as const,
};
const gameIdWs = {
  id: 'local',
  cubeApiUrl: 'http://localhost:4000',
  gameModel: 'game_id' as const,
};

function mockCubes(ids: string[], status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ cube_ids: ids }),
    })),
  );
}

beforeEach(() => {
  __resetProdGameRegistryCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchProdCubeIds', () => {
  it('returns the cube_ids a prefix workspace serves', async () => {
    mockCubes(['ptg', 'cfm_vn', 'jus_vn', 'nikki']);
    const ids = await fetchProdCubeIds(prefixWs);
    expect(ids).toEqual(['ptg', 'cfm_vn', 'jus_vn', 'nikki']);
  });

  it('caches — a second call within TTL does not re-fetch', async () => {
    mockCubes(['ptg', 'cfm_vn']);
    await fetchProdCubeIds(prefixWs);
    await fetchProdCubeIds(prefixWs);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it('returns [] for a game_id workspace (never fetches)', async () => {
    mockCubes(['should', 'not', 'be', 'used']);
    const ids = await fetchProdCubeIds(gameIdWs);
    expect(ids).toEqual([]);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });

  it('fails soft to [] on a non-200', async () => {
    mockCubes([], 503);
    expect(await fetchProdCubeIds(prefixWs)).toEqual([]);
  });

  it('fails soft to [] when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await fetchProdCubeIds(prefixWs)).toEqual([]);
  });

  it('filters non-string / empty ids defensively', async () => {
    mockCubes(['ptg', '', 'cfm_vn'] as string[]);
    expect(await fetchProdCubeIds(prefixWs)).toEqual(['ptg', 'cfm_vn']);
  });
});

describe('listWorkspaceGameIds', () => {
  it('prefix workspace → the /cubes list', async () => {
    mockCubes(['ptg', 'cfm_vn']);
    expect(await listWorkspaceGameIds(prefixWs)).toEqual(['ptg', 'cfm_vn']);
  });

  it('game_id workspace → the in-repo games config (no fetch)', async () => {
    mockCubes(['ignored']);
    const expected = loadGamesConfig().games.map((g) => g.id);
    expect(await listWorkspaceGameIds(gameIdWs)).toEqual(expected);
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});
