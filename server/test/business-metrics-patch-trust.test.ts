/**
 * PATCH /api/business-metrics/:id/trust integration tests.
 * Covers: happy path, missing-game guard, REFS_UNRESOLVED, history append shape,
 * idempotent re-PATCH, and ignored attempts to overwrite trust_history directly.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import yaml from 'js-yaml';

import businessMetricsRoutes from '../src/routes/business-metrics.js';
import workspaceHeader from '../src/middleware/workspace-header.js';
import {
  clearCache,
  loadAll,
  setRegistryDir,
} from '../src/services/business-metrics-loader.js';
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

const CLEAN_YAML = [
  'id: dau',
  'label: DAU',
  'description: Daily active users',
  'tier: 1',
  'domain: engagement',
  'owner: data@vng',
  'trust: draft',
  'formula:',
  '  type: measure',
  '  ref: mf_users.dau',
  'meta:',
  '  game_id: ballistar',
  '',
].join('\n');

const BROKEN_YAML = [
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
  'meta:',
  '  game_id: ballistar',
  '',
].join('\n');

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bm-patch-'));
  setRegistryDir(dir);
  clearCache();
  writeFileSync(join(dir, 'dau.yml'), CLEAN_YAML);
  writeFileSync(join(dir, 'npu.yml'), BROKEN_YAML);
  await loadAll();

  __resetWorkspacesConfigCache();
  app = Fastify();
  await app.register(workspaceHeader);
  await app.register(businessMetricsRoutes);

  tokenMock.mockReturnValue('Bearer test');
  workspaceTokenMock.mockReturnValue({ token: 'Bearer test', source: 'minted' });
  const metaResponse = {
    cubes: [
      {
        name: 'mf_users',
        measures: [{ name: 'mf_users.dau' }],
        dimensions: [],
      },
    ],
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

describe('PATCH /api/business-metrics/:id/trust', () => {
  it('returns 404 for unknown id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/business-metrics/missing/trust',
      payload: { trust: 'draft' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });

  it('returns 400 VALIDATION for an unknown trust tier', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/business-metrics/dau/trust',
      payload: { trust: 'bogus' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION' } });
  });

  it('promotes a clean metric to certified, appending a history entry', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/business-metrics/dau/trust',
      payload: { trust: 'certified', actor: 'vyvhy@vng.com.vn', note: 'reviewed' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      trust: string;
      meta?: { trust_history?: Array<{ trust: string; actor?: string; note?: string; at: string }> };
    };
    expect(body.trust).toBe('certified');
    expect(body.meta?.trust_history).toHaveLength(1);
    expect(body.meta?.trust_history?.[0]).toMatchObject({
      trust: 'certified',
      actor: 'vyvhy@vng.com.vn',
      note: 'reviewed',
    });
    expect(typeof body.meta?.trust_history?.[0].at).toBe('string');

    // Persisted on disk.
    const onDisk = yaml.load(readFileSync(join(dir, 'dau.yml'), 'utf8')) as {
      trust: string;
      meta?: { trust_history?: unknown[] };
    };
    expect(onDisk.trust).toBe('certified');
    expect(onDisk.meta?.trust_history).toHaveLength(1);
  });

  it('rejects promotion to certified when refs are unresolved', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/business-metrics/npu/trust',
      payload: { trust: 'certified' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: { code: string; missingRefs?: string[] } };
    expect(body.error.code).toBe('REFS_UNRESOLVED');
    expect(body.error.missingRefs).toContain('mf_users.new_users');
  });

  it('skips ref validation for non-certified targets — broken metric can still be marked deprecated', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/business-metrics/npu/trust',
      payload: { trust: 'deprecated' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { trust: string };
    expect(body.trust).toBe('deprecated');
  });

  it('returns GAME_UNKNOWN when promoting to certified with no game on metric or query', async () => {
    // Strip game_id from disk first.
    writeFileSync(join(dir, 'dau.yml'), CLEAN_YAML.replace(/meta:\n  game_id: ballistar\n/, ''));
    clearCache();
    await loadAll();

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/business-metrics/dau/trust',
      payload: { trust: 'certified' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'GAME_UNKNOWN' } });
  });

  it('is idempotent — re-PATCH with the same trust appends another history entry', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/api/business-metrics/dau/trust',
      payload: { trust: 'certified', note: 'first review' },
    });
    const second = await app.inject({
      method: 'PATCH',
      url: '/api/business-metrics/dau/trust',
      payload: { trust: 'certified', note: 'second review' },
    });
    expect(second.statusCode).toBe(200);
    const body = second.json() as { meta?: { trust_history?: Array<{ note?: string }> } };
    expect(body.meta?.trust_history).toHaveLength(2);
    expect(body.meta?.trust_history?.map((e) => e.note)).toEqual(['first review', 'second review']);
  });

  it('ignores attempts to write trust_history directly in the body', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/business-metrics/dau/trust',
      payload: {
        trust: 'draft',
        // Server-side schema only knows trust/actor/note — any extra fields are dropped.
        trust_history: [{ trust: 'certified', at: '2000-01-01T00:00:00.000Z' }],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { meta?: { trust_history?: Array<{ trust: string }> } };
    // Only the new entry from this PATCH should land — the forged history should be ignored.
    expect(body.meta?.trust_history).toHaveLength(1);
    expect(body.meta?.trust_history?.[0].trust).toBe('draft');
  });
});
