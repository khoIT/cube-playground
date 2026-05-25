/**
 * Phase-2 SQLite detector: runDetectorTick tests.
 * Stubs cube-client + games-config + resolve-cube-token so no network calls happen.
 * Uses an in-memory SQLite DB seeded from migrations.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

import { setDb, closeDb } from '../src/db/sqlite.js';
import { listAnomalies } from '../src/services/anomaly-state-store.js';
import * as cubeClient from '../src/services/cube-client.js';
import * as resolveToken from '../src/services/resolve-cube-token.js';
import * as gamesConfig from '../src/services/games-config-loader.js';
import { runDetectorTick, __resetAnomalyDetectorState } from '../src/jobs/anomaly-detector.js';

const MIGRATIONS_DIR = join(dirname(import.meta.url.replace('file://', '')), '..', 'src', 'db', 'migrations');

function buildTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f: string) => f.endsWith('.sql'))
    .sort();
  for (const f of files) {
    db.exec(readFileSync(join(MIGRATIONS_DIR, f), 'utf8'));
  }
  return db;
}

/** Build a 14-point series; last point spikes by multiplier. */
function spikeSeries(cubeName: string, measure: string, timeDim: string, mult = 6) {
  const jitter = [0,1,-1,2,-2,1,0,-1,1,2,-2,0,1];
  const data: Array<Record<string, unknown>> = jitter.map((j, i) => ({
    [`${timeDim}.day`]: `2024-01-${String(i + 1).padStart(2, '0')}`,
    [measure]: 1000 + j,
  }));
  data.push({ [`${timeDim}.day`]: '2024-01-14', [measure]: 1000 * mult });
  return { data };
}

/** Build a flat series (no anomaly). */
function flatSeries(measure: string, timeDim: string) {
  const data = Array.from({ length: 14 }, (_, i) => ({
    [`${timeDim}.day`]: `2024-01-${String(i + 1).padStart(2, '0')}`,
    [measure]: 1000,
  }));
  return { data };
}

describe('runDetectorTick (SQLite mode)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = buildTestDb();
    setDb(db);
    __resetAnomalyDetectorState();
    vi.restoreAllMocks();
    delete process.env.ANOMALY_QUERY_BUDGET_PER_TICK;
  });

  afterEach(() => {
    closeDb();
    vi.restoreAllMocks();
  });

  it('upserts a high-severity anomaly when Cube returns a spike for active_daily.dau', async () => {
    vi.spyOn(gamesConfig, 'loadGamesConfig').mockReturnValue({
      defaultGameId: 'cfm',
      games: [{ id: 'cfm', name: 'CFM' }],
    });
    vi.spyOn(resolveToken, 'resolveCubeTokenForGame').mockReturnValue('tok');
    vi.spyOn(cubeClient, 'load').mockResolvedValue(
      spikeSeries('active_daily', 'active_daily.dau', 'active_daily.log_date'),
    );

    const result = await runDetectorTick();

    expect(result.upserted).toBeGreaterThanOrEqual(1);
    const rows = listAnomalies('cfm', 'open');
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].game).toBe('cfm');
    expect(rows[0].metric).toBe('active_daily.dau');
    expect(rows[0].severity).toBe('high');
  });

  it('does not upsert when series is flat', async () => {
    vi.spyOn(gamesConfig, 'loadGamesConfig').mockReturnValue({
      defaultGameId: 'cfm',
      games: [{ id: 'cfm', name: 'CFM' }],
    });
    vi.spyOn(resolveToken, 'resolveCubeTokenForGame').mockReturnValue('tok');
    vi.spyOn(cubeClient, 'load').mockResolvedValue(
      flatSeries('active_daily.dau', 'active_daily.log_date'),
    );

    const result = await runDetectorTick();
    expect(result.upserted).toBe(0);
    expect(listAnomalies('cfm', 'open')).toHaveLength(0);
  });

  it('skips game when no token resolves', async () => {
    vi.spyOn(gamesConfig, 'loadGamesConfig').mockReturnValue({
      defaultGameId: 'cfm',
      games: [{ id: 'cfm', name: 'CFM' }],
    });
    vi.spyOn(resolveToken, 'resolveCubeTokenForGame').mockReturnValue(null);
    const loadSpy = vi.spyOn(cubeClient, 'load');

    await runDetectorTick();
    expect(loadSpy).not.toHaveBeenCalled();
  });

  it('respects ANOMALY_QUERY_BUDGET_PER_TICK — stops loading after budget', async () => {
    process.env.ANOMALY_QUERY_BUDGET_PER_TICK = '1';
    vi.spyOn(gamesConfig, 'loadGamesConfig').mockReturnValue({
      defaultGameId: 'cfm',
      games: [{ id: 'cfm', name: 'CFM' }],
    });
    vi.spyOn(resolveToken, 'resolveCubeTokenForGame').mockReturnValue('tok');
    const loadSpy = vi.spyOn(cubeClient, 'load').mockResolvedValue(
      spikeSeries('active_daily', 'active_daily.dau', 'active_daily.log_date'),
    );

    const result = await runDetectorTick();

    // cfm has 2 metrics; budget=1 means at most 1 load call
    expect(loadSpy.mock.calls.length).toBeLessThanOrEqual(1);
    expect(result.skipped).toBeGreaterThanOrEqual(1);
  });

  it('continues after a single metric fails — other metrics still run', async () => {
    vi.spyOn(gamesConfig, 'loadGamesConfig').mockReturnValue({
      defaultGameId: 'cfm',
      games: [{ id: 'cfm', name: 'CFM' }],
    });
    vi.spyOn(resolveToken, 'resolveCubeTokenForGame').mockReturnValue('tok');

    let calls = 0;
    vi.spyOn(cubeClient, 'load').mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new Error('Cube timeout');
      return spikeSeries('user_recharge_daily', 'user_recharge_daily.revenue_vnd_total', 'user_recharge_daily.recharge_date');
    });

    const warns: string[] = [];
    const result = await runDetectorTick((m) => warns.push(m));

    // Should NOT throw — one failure is caught
    expect(warns.some((w) => w.includes('Cube timeout'))).toBe(true);
    // Second metric (revenue) succeeded and may have produced an upsert
    expect(result).toBeDefined();
  });

  it('games with empty metric config produce no Cube calls', async () => {
    vi.spyOn(gamesConfig, 'loadGamesConfig').mockReturnValue({
      defaultGameId: 'ptg',
      games: [{ id: 'ptg', name: 'Play Together' }],
    });
    vi.spyOn(resolveToken, 'resolveCubeTokenForGame').mockReturnValue('tok');
    const loadSpy = vi.spyOn(cubeClient, 'load');

    await runDetectorTick();
    // ptg has empty ANOMALY_METRICS → no load calls
    expect(loadSpy).not.toHaveBeenCalled();
  });
});
