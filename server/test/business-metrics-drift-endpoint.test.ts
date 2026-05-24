/**
 * GET /api/business-metrics/drift integration tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';

import businessMetricsRoutes from '../src/routes/business-metrics.js';
import {
  clearCache,
  loadAll,
  setRegistryDir,
} from '../src/services/business-metrics-loader.js';

vi.mock('../src/services/cube-client.js', () => ({
  getMeta: vi.fn(),
}));
vi.mock('../src/services/resolve-cube-token.js', () => ({
  resolveCubeTokenForGame: vi.fn(),
}));

import { getMeta } from '../src/services/cube-client.js';
import { resolveCubeTokenForGame } from '../src/services/resolve-cube-token.js';

const getMetaMock = vi.mocked(getMeta);
const tokenMock = vi.mocked(resolveCubeTokenForGame);

let dir: string;
let app: FastifyInstance;

const DAU_YAML = [
  'id: dau',
  'label: DAU',
  'description: Daily active users',
  'tier: 1',
  'domain: engagement',
  'owner: data@vng',
  'trust: certified',
  'formula:',
  '  type: measure',
  '  ref: mf_users.dau',
  '',
].join('\n');

const NPU_YAML = [
  'id: npu',
  'label: NPU',
  'description: New paying users',
  'tier: 2',
  'domain: payments',
  'owner: data@vng',
  'trust: draft',
  'formula:',
  '  type: measure',
  '  ref: mf_users.new_users',
  '',
].join('\n');

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bm-drift-'));
  setRegistryDir(dir);
  clearCache();
  writeFileSync(join(dir, 'dau.yml'), DAU_YAML);
  writeFileSync(join(dir, 'npu.yml'), NPU_YAML);
  await loadAll();

  app = Fastify();
  await app.register(businessMetricsRoutes);

  tokenMock.mockReturnValue('Bearer test');
  getMetaMock.mockResolvedValue({
    cubes: [
      {
        name: 'mf_users',
        measures: [{ name: 'mf_users.dau' }],
        dimensions: [],
      },
    ],
  });
});

afterEach(async () => {
  await app.close();
  clearCache();
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('GET /api/business-metrics/drift', () => {
  it('returns 400 GAME_REQUIRED when game is omitted', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/business-metrics/drift',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'GAME_REQUIRED' } });
  });

  it('returns the drift snapshot for a known game', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/business-metrics/drift?game=ballistar',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      total: number;
      resolvable: number;
      broken: Array<{ id: string; missingRefs: string[] }>;
    };
    expect(body.total).toBe(2);
    expect(body.resolvable).toBe(1);
    expect(body.broken).toHaveLength(1);
    expect(body.broken[0]).toMatchObject({
      id: 'npu',
      missingRefs: ['mf_users.new_users'],
    });
  });

  it('returns 502 DRIFT_FAILED when the token cannot be resolved', async () => {
    tokenMock.mockReturnValue(null);
    const res = await app.inject({
      method: 'GET',
      url: '/api/business-metrics/drift?game=ballistar',
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'DRIFT_FAILED' } });
  });
});
