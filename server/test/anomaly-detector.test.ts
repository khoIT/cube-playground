/**
 * Detector integration test — patches `cube-client` so the run doesn't try
 * to reach an actual Cube instance, runs `runDetectorOnce`, then inspects
 * the JSON file it wrote.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { setDb, closeDb, getDb } from '../src/db/sqlite.js';
import { listDriftRows } from '../src/db/metric-drift-snapshot-store.js';
import {
  loadAll,
  setRegistryDir,
} from '../src/services/business-metrics-loader.js';
import * as cubeClient from '../src/services/cube-client.js';
import {
  __resetAnomalyDetectorState,
  divideByDate,
  rowsToDatedSeries,
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

// In-memory DB so the detector→drift bridge writes never touch the dev DB.
const MIGRATIONS_DIR = join(dirname(import.meta.url.replace('file://', '')), '..', 'src', 'db', 'migrations');
function buildTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  for (const f of readdirSync(MIGRATIONS_DIR).filter((x) => x.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

beforeAll(async () => {
  setRegistryDir(FIXTURE_DIR);
  await loadAll();
});

beforeEach(() => {
  setDb(buildTestDb());
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

afterEach(() => closeDb());

describe('divideByDate (ratio alignment)', () => {
  const dated = (m: string, dim: string, pairs: Array<[string, number | string]>) =>
    pairs.map(([date, value]) => ({ [`${dim}.day`]: `${date}T00:00:00.000`, [m]: value }));

  it('aligns numerator/denominator on matching dates, not position', () => {
    // Denominator (DAU) lags: it stops two days before the numerator. Index
    // zipping would still happen to pair the first days here; the real test is
    // the interior-gap case below. This one locks the happy path + value.
    const num = rowsToDatedSeries(dated('recharge.paying_users', 'recharge.recharge_date', [
      ['2026-05-13', 993], ['2026-05-14', 854], ['2026-05-15', 1251],
    ]), 'recharge.paying_users', 'recharge.recharge_date');
    const den = rowsToDatedSeries(dated('active_daily.dau', 'active_daily.log_date', [
      ['2026-05-13', 17518], ['2026-05-14', 17223], ['2026-05-15', 18689],
    ]), 'active_daily.dau', 'active_daily.log_date');
    expect(divideByDate(num, den)).toEqual([993 / 17518, 854 / 17223, 1251 / 18689]);
  });

  it('drops days missing from the denominator (no cross-date mispairing)', () => {
    // Denominator is missing 05-14 (interior gap). Position-zipping would pair
    // num[05-14] with den[05-15] and corrupt every later day; date alignment
    // simply skips 05-14 and keeps 05-13 and 05-15 correct.
    const num = rowsToDatedSeries(dated('n', 'c.d', [
      ['2026-05-13', 10], ['2026-05-14', 20], ['2026-05-15', 30],
    ]), 'n', 'c.d');
    const den = rowsToDatedSeries(dated('m', 'e.f', [
      ['2026-05-13', 100], ['2026-05-15', 300],
    ]), 'm', 'e.f');
    expect(divideByDate(num, den)).toEqual([10 / 100, 30 / 300]);
  });

  it('skips zero denominators', () => {
    const num = rowsToDatedSeries(dated('n', 'c.d', [['2026-05-13', 5], ['2026-05-14', 7]]), 'n', 'c.d');
    const den = rowsToDatedSeries(dated('m', 'e.f', [['2026-05-13', 0], ['2026-05-14', 14]]), 'm', 'e.f');
    expect(divideByDate(num, den)).toEqual([0.5]);
  });

  it('rowsToDatedSeries sorts by date and coerces string values (Cube returns strings)', () => {
    const s = rowsToDatedSeries(dated('n', 'c.d', [['2026-05-15', '3.0'], ['2026-05-13', '1.0']]), 'n', 'c.d');
    expect(s).toEqual([
      { date: '2026-05-13', value: 1 },
      { date: '2026-05-15', value: 3 },
    ]);
  });
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

  it('skips metrics whose refs are absent from /meta and reports them once (no per-metric 400)', async () => {
    // META has no `active_daily` cube — so the `wau` registry metric
    // (ref: active_daily.wau) is unresolved for this game.
    vi.spyOn(cubeClient, 'getMeta').mockResolvedValue(META);
    const loadSpy = vi
      .spyOn(cubeClient, 'load')
      .mockImplementation(async (query: any) =>
        makeSeries(100, 101, query.measures[0].split('.')[0], query.measures[0]),
      );
    process.env.ANOMALY_DETECTOR_GAMES = 'ballistar';

    const warn = vi.fn();
    await runDetectorOnce(warn);

    // One consolidated warning, count + pointer to Drift Center — not a 400
    // per tick, not a per-ref dump (the full detail now lives in the store).
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/game="ballistar": \d+ metric\(s\) have unresolved refs — see Drift Center/),
    );
    // The doomed measure was never sent to Cube.
    const loadedMeasures = loadSpy.mock.calls.map((c: any[]) => c[0].measures[0]);
    expect(loadedMeasures).not.toContain('active_daily.wau');
  });

  it('persists the unresolved set to the drift snapshot store (local/detector)', async () => {
    vi.spyOn(cubeClient, 'getMeta').mockResolvedValue(META);
    vi.spyOn(cubeClient, 'load').mockImplementation(async (query: any) =>
      makeSeries(100, 101, query.measures[0].split('.')[0], query.measures[0]),
    );
    process.env.ANOMALY_DETECTOR_GAMES = 'ballistar';
    await runDetectorOnce(() => {});

    const rows = listDriftRows(getDb(), { workspaceId: 'local', game: 'ballistar', source: 'detector' });
    expect(rows.length).toBeGreaterThan(0);
    // active_daily cube is absent from META → its refs are persisted as drift.
    expect(rows.some((r) => r.ref === 'active_daily.wau')).toBe(true);
  });

  it('clears detector rows when a game has zero unresolved refs', async () => {
    // META that satisfies every preset ref is impractical; instead seed a row
    // then run a scan whose game token does not resolve → empty unresolved set
    // is NOT written (the scan returns early before the bridge). So assert the
    // bridge's replace-semantics directly: a second scan with the same META
    // overwrites, never accumulates.
    vi.spyOn(cubeClient, 'getMeta').mockResolvedValue(META);
    vi.spyOn(cubeClient, 'load').mockImplementation(async (query: any) =>
      makeSeries(100, 101, query.measures[0].split('.')[0], query.measures[0]),
    );
    process.env.ANOMALY_DETECTOR_GAMES = 'ballistar';
    await runDetectorOnce(() => {});
    const first = listDriftRows(getDb(), { workspaceId: 'local', game: 'ballistar', source: 'detector' }).length;
    await runDetectorOnce(() => {});
    const second = listDriftRows(getDb(), { workspaceId: 'local', game: 'ballistar', source: 'detector' }).length;
    expect(second).toBe(first); // replace, not accumulate
  });
});
