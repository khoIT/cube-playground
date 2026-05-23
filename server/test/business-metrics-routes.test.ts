/**
 * GET + POST /api/business-metrics integration tests using Fastify.inject.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

let dir: string;
let app: FastifyInstance;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'bm-routes-'));
  setRegistryDir(dir);
  clearCache();
  writeFileSync(
    join(dir, 'dau.yml'),
    'id: dau\nlabel: DAU\ndescription: Daily active users\ntier: 1\ndomain: engagement\nowner: data@vng\ntrust: certified\nformula:\n  type: measure\n  ref: mf_users.dau\n',
  );
  await loadAll();

  app = Fastify();
  await app.register(businessMetricsRoutes);
});

afterEach(async () => {
  await app.close();
  clearCache();
  if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

describe('GET /api/business-metrics', () => {
  it('returns the registry as { metrics: [] }', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/business-metrics' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { metrics: Array<{ id: string }> };
    expect(body.metrics).toHaveLength(1);
    expect(body.metrics[0].id).toBe('dau');
  });
});

describe('GET /api/business-metrics/:id', () => {
  it('returns the metric when found', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/business-metrics/dau' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'dau', label: 'DAU' });
  });

  it('returns 404 when not found', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/business-metrics/does-not-exist',
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});

describe('POST /api/business-metrics', () => {
  it('rejects invalid payloads with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/business-metrics',
      payload: { id: 'bad', label: 'Bad' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION' } });
  });

  it('writes a valid metric, returns 201, and persists to disk', async () => {
    const payload = {
      id: 'wau',
      label: 'WAU',
      description: 'Weekly active users',
      tier: 2,
      domain: 'engagement',
      owner: 'data@vng',
      trust: 'beta',
      formula: { type: 'measure', ref: 'mf_users.wau' },
    };
    const res = await app.inject({
      method: 'POST',
      url: '/api/business-metrics',
      payload,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: 'wau', label: 'WAU' });
    expect(existsSync(join(dir, 'wau.yml'))).toBe(true);

    // After POST, GET reflects the new metric.
    const list = await app.inject({ method: 'GET', url: '/api/business-metrics' });
    const body = list.json() as { metrics: Array<{ id: string }> };
    expect(body.metrics.map((m) => m.id).sort()).toEqual(['dau', 'wau']);
  });

  it('rejects an invalid id pattern with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/business-metrics',
      payload: {
        id: 'Bad-Id',
        label: 'X',
        description: 'X',
        tier: 1,
        domain: 'revenue',
        owner: 'team@vng',
        trust: 'beta',
        formula: { type: 'measure', ref: 'r.x' },
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
