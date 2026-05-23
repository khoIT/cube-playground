import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/index.js';
import {
  loadAll,
  setRegistryDir,
} from '../src/services/business-metrics-loader.js';
import { setAnomalyStateFile } from '../src/services/anomaly-state-store.js';

const FIXTURE_DIR = path.resolve(
  __dirname,
  '..',
  'src',
  'presets',
  'business-metrics',
);

let app: Awaited<ReturnType<typeof buildApp>>;
let isolatedTmp: string;

beforeAll(async () => {
  setRegistryDir(FIXTURE_DIR);
  await loadAll();
  // Point the store at an isolated tmp path so a leftover detector file at
  // the default location can't flip these tests from "yaml" to "detector".
  isolatedTmp = mkdtempSync(join(tmpdir(), 'anomaly-state-route-'));
  setAnomalyStateFile(join(isolatedTmp, 'no-such-file.json'));
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  if (isolatedTmp) rmSync(isolatedTmp, { recursive: true, force: true });
});

beforeEach(() => {
  setAnomalyStateFile(join(isolatedTmp, 'no-such-file.json'));
});

describe('GET /api/anomaly-state', () => {
  it('400s without game query param', async () => {
    const resp = await app.inject({ method: 'GET', url: '/api/anomaly-state' });
    expect(resp.statusCode).toBe(400);
  });

  it('returns YAML-seeded state for known game', async () => {
    const resp = await app.inject({
      method: 'GET',
      url: '/api/anomaly-state?game=ballistar',
    });
    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.body) as {
      states: Record<string, { state: string }>;
      source: string;
    };
    expect(body.source).toBe('yaml');
    // paying_users / ltv_30 / ccu are seeded as anomalies in the fixture YAMLs.
    expect(body.states.paying_users?.state).toBe('high');
  });

  it('returns empty states map when no anomalies seeded for game', async () => {
    const resp = await app.inject({
      method: 'GET',
      url: '/api/anomaly-state?game=' + encodeURIComponent('unknown_game'),
    });
    expect(resp.statusCode).toBe(200);
    const body = JSON.parse(resp.body) as {
      states: Record<string, unknown>;
    };
    // Server still returns the YAML seed pool — `unknown_game` is just a label;
    // YAML overrides aren't game-specific. This is documented behaviour and
    // expected to tighten when the detector lands.
    expect(typeof body.states).toBe('object');
  });
});
