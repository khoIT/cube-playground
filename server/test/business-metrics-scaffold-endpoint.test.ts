/**
 * POST /api/business-metrics/scaffold integration tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify, { type FastifyInstance } from 'fastify';
import yaml from 'js-yaml';

import businessMetricsRoutes from '../src/routes/business-metrics.js';
import {
  clearCache,
  loadAll,
  setRegistryDir,
  getById,
} from '../src/services/business-metrics-loader.js';

let dir: string;
let app: FastifyInstance;

const DAU = ['id: dau', 'label: DAU', 'description: d', 'tier: 1', 'domain: engagement',
  'owner: data@vng', 'trust: certified', 'formula:', '  type: measure', '  ref: active_daily.dau', ''].join('\n');

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bm-scaffold-'));
  setRegistryDir(dir);
  clearCache();
  writeFileSync(join(dir, 'dau.yml'), DAU);
  await loadAll();
  app = Fastify();
  await app.register(businessMetricsRoutes);
});

afterEach(async () => {
  await app.close();
  clearCache();
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe('POST /api/business-metrics/scaffold', () => {
  it('400s on empty body', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/business-metrics/scaffold', payload: { measures: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'MEASURES_REQUIRED' } });
  });

  it('writes a reloadable draft stub and skips already-referenced refs', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/business-metrics/scaffold',
      payload: { measures: [{ ref: 'active_daily.wau' }, { ref: 'active_daily.dau' }] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.created).toEqual(['wau']);
    expect(body.skipped).toEqual([
      { ref: 'active_daily.dau', reason: 'already referenced by an existing metric' },
    ]);

    // File written + valid + draft + loaded into cache.
    const file = join(dir, 'wau.yml');
    expect(existsSync(file)).toBe(true);
    const doc = yaml.load(readFileSync(file, 'utf8')) as { trust: string; formula: { ref: string } };
    expect(doc.trust).toBe('draft');
    expect(doc.formula.ref).toBe('active_daily.wau');
    expect(getById('wau')).toBeTruthy();
  });

  it('is idempotent — re-scaffolding the same ref skips it', async () => {
    await app.inject({ method: 'POST', url: '/api/business-metrics/scaffold', payload: { measures: [{ ref: 'active_daily.wau' }] } });
    const res = await app.inject({ method: 'POST', url: '/api/business-metrics/scaffold', payload: { measures: [{ ref: 'active_daily.wau' }] } });
    const body = res.json();
    expect(body.created).toEqual([]);
    expect(body.skipped[0]).toMatchObject({ ref: 'active_daily.wau' });
  });
});
