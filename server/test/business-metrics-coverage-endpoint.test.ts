/**
 * GET /api/business-metrics/coverage integration tests (single-game form).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';

import businessMetricsRoutes from '../src/routes/business-metrics.js';
import workspaceHeader from '../src/middleware/workspace-header.js';
import { clearCache, loadAll, setRegistryDir } from '../src/services/business-metrics-loader.js';
import { __resetWorkspacesConfigCache } from '../src/services/workspaces-config-loader.js';

vi.mock('../src/services/cube-client.js', () => ({
  getMeta: vi.fn(),
  getMetaWithCtx: vi.fn(),
}));
vi.mock('../src/services/resolve-cube-token.js', () => ({
  resolveCubeTokenForGame: vi.fn(),
  resolveCubeTokenForWorkspace: vi.fn(),
}));

import { getMeta, getMetaWithCtx } from '../src/services/cube-client.js';
import {
  resolveCubeTokenForGame,
  resolveCubeTokenForWorkspace,
} from '../src/services/resolve-cube-token.js';

const getMetaMock = vi.mocked(getMeta);
const getMetaWithCtxMock = vi.mocked(getMetaWithCtx);
const tokenMock = vi.mocked(resolveCubeTokenForGame);
const workspaceTokenMock = vi.mocked(resolveCubeTokenForWorkspace);

let dir: string;
let app: FastifyInstance;

const DAU = ['id: dau', 'label: DAU', 'description: d', 'tier: 1', 'domain: engagement',
  'owner: data@vng', 'trust: certified', 'formula:', '  type: measure', '  ref: active_daily.dau', ''].join('\n');
const GHOST = ['id: ghost', 'label: Ghost', 'description: g', 'tier: 3', 'domain: engagement',
  'owner: data@vng', 'trust: draft', 'formula:', '  type: measure', '  ref: active_daily.nope', ''].join('\n');

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bm-cov-'));
  setRegistryDir(dir);
  clearCache();
  __resetWorkspacesConfigCache();
  writeFileSync(join(dir, 'dau.yml'), DAU);
  writeFileSync(join(dir, 'ghost.yml'), GHOST);
  await loadAll();
  app = Fastify();
  await app.register(workspaceHeader);
  await app.register(businessMetricsRoutes);
  tokenMock.mockReturnValue('Bearer test');
  workspaceTokenMock.mockReturnValue({ token: 'Bearer test', source: 'minted' });
  const metaResponse = {
    cubes: [{
      name: 'active_daily',
      measures: [{ name: 'active_daily.dau' }, { name: 'active_daily.wau' }],
      dimensions: [{ name: 'active_daily.log_date', type: 'time' }],
    }],
  };
  getMetaMock.mockResolvedValue(metaResponse);
  getMetaWithCtxMock.mockResolvedValue(metaResponse);
});

afterEach(async () => {
  await app.close();
  clearCache();
  __resetWorkspacesConfigCache();
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('GET /api/business-metrics/coverage?game=', () => {
  it('reports broken refs, uncovered measures, and a matrix', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/business-metrics/coverage?game=ballistar' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.games).toHaveLength(1);
    const g = body.games[0];
    expect(g.game).toBe('ballistar');
    expect(g.status).toBe('drift'); // ghost is broken
    expect(g.uncoveredMeasures).toEqual(['active_daily.wau']); // dau covered, wau not
    expect(g.brokenRefs.map((b: { metricId: string }) => b.metricId)).toContain('ghost');
    // matrix has a cell per metric
    const cells = Object.fromEntries(body.matrix.map((c: { metricId: string; state: string }) => [c.metricId, c.state]));
    expect(cells.dau).toBe('resolves');
    expect(cells.ghost).toBe('broken');
  });

  it('marks the game status:error when /meta fetch fails (fail-open, still 200)', async () => {
    getMetaWithCtxMock.mockRejectedValueOnce(new Error('no Cube token for game "ballistar"'));
    const res = await app.inject({ method: 'GET', url: '/api/business-metrics/coverage?game=ballistar' });
    expect(res.statusCode).toBe(200);
    expect(res.json().games[0].status).toBe('error');
  });
});
