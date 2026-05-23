/**
 * Detector integration test — patches `cube-client` so the run doesn't try
 * to reach an actual Cube instance, runs `runDetectorOnce`, then inspects
 * the JSON file it wrote.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadAll,
  setRegistryDir,
} from '../src/services/business-metrics-loader.js';
import * as cubeClient from '../src/services/cube-client.js';
import {
  __resetAnomalyDetectorState,
  runDetectorOnce,
  setAnomalyDetectorStateFile,
} from '../src/jobs/anomaly-detector.js';

const FIXTURE_DIR = path.resolve(
  __dirname,
  '..',
  'src',
  'presets',
  'business-metrics',
);

const META = {
  cubes: [
    {
      name: 'recharge',
      measures: [
        { name: 'recharge.paying_users' },
        { name: 'recharge.revenue_vnd' },
      ],
      dimensions: [{ name: 'recharge.day', type: 'time' }],
    },
    {
      name: 'mf_users',
      measures: [{ name: 'mf_users.dau' }],
      dimensions: [{ name: 'mf_users.day', type: 'time' }],
    },
  ],
};

function makeSeries(
  base: number,
  spike: number,
  cubeName: string,
  measureName: string,
) {
  // Add small jitter so baseline stddev > 0 (classifier returns null otherwise).
  const jitter = [0, 1, -1, 2, -2, 1, 0, -1, 1, 2, -2, 0, 1];
  const data: Array<Record<string, unknown>> = [];
  for (let i = 0; i < jitter.length; i++) {
    data.push({
      [`${cubeName}.day.day`]: `2026-05-${10 + i}`,
      [measureName]: base + jitter[i],
    });
  }
  data.push({ [`${cubeName}.day.day`]: '2026-05-23', [measureName]: spike });
  return { data };
}

let tmp: string;
let tokenSaved: string | undefined;
let disabledSaved: string | undefined;
let nodeEnvSaved: string | undefined;

beforeAll(async () => {
  setRegistryDir(FIXTURE_DIR);
  await loadAll();
});

beforeEach(() => {
  __resetAnomalyDetectorState();
  tmp = mkdtempSync(join(tmpdir(), 'anomaly-detector-'));
  setAnomalyDetectorStateFile(join(tmp, 'state.json'));
  tokenSaved = process.env.CUBE_TOKEN;
  process.env.CUBE_TOKEN = 'test-token';
  disabledSaved = process.env.ANOMALY_DETECTOR_DISABLED;
  delete process.env.ANOMALY_DETECTOR_DISABLED;
  nodeEnvSaved = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development'; // test-mode short-circuit must not trip
  vi.restoreAllMocks();
});

afterAll(() => {
  if (tokenSaved === undefined) delete process.env.CUBE_TOKEN;
  else process.env.CUBE_TOKEN = tokenSaved;
  if (disabledSaved === undefined) delete process.env.ANOMALY_DETECTOR_DISABLED;
  else process.env.ANOMALY_DETECTOR_DISABLED = disabledSaved;
  if (nodeEnvSaved === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnvSaved;
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe('runDetectorOnce', () => {
  it('writes a per-(game,metric) state file from mocked Cube data', async () => {
    vi.spyOn(cubeClient, 'getMeta').mockResolvedValue(META);
    vi.spyOn(cubeClient, 'load').mockImplementation(async (query: any) => {
      const measure = query.measures[0] as string;
      const cube = measure.split('.')[0];
      // paying_users spike → 'high'; revenue/dau ratio steady → 'none'.
      if (measure === 'recharge.paying_users') {
        return makeSeries(100, 200, cube, measure);
      }
      return makeSeries(100, 101, cube, measure);
    });

    process.env.ANOMALY_DETECTOR_GAMES = 'ballistar';

    const result = await runDetectorOnce(() => {});

    expect(result.entries).toBeGreaterThan(0);
    const payload = JSON.parse(readFileSync(join(tmp, 'state.json'), 'utf8'));
    expect(payload.updatedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(payload.states['ballistar:paying_users']?.state).toBe('high');
  });

  it('skips game when no token resolves', async () => {
    delete process.env.CUBE_TOKEN;
    process.env.ANOMALY_DETECTOR_GAMES = 'ptg';
    const warn = vi.fn();
    const result = await runDetectorOnce(warn);
    expect(result.entries).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no Cube token/));
  });
});
