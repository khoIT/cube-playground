/**
 * Tests for dashboard-starter-pack-seeder.
 * Verifies: applies_when gating, idempotency, and tile insertion.
 */

import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'starter-pack-seeder-test-'));
process.env.DB_PATH = join(tmp, 'test.db');

import { getDb } from '../src/db/sqlite.js';
import {
  seedStarterPack,
} from '../src/services/dashboard-starter-pack-seeder.js';
import {
  setStarterPackDir,
  __resetStarterPackCache,
} from '../src/services/dashboard-starter-pack-loader.js';

const packDir = join(tmp, 'pack');

function writePack(): void {
  mkdirSync(packDir, { recursive: true });
  writeFileSync(
    join(packDir, 'daily-health.yml'),
    `slug: daily-health
title: Daily health
applies_when:
  required_cubes: [active_daily]
tiles:
  - title: DAU
    viz_type: kpi
    position: { x: 0, y: 0, w: 3, h: 2 }
    query:
      measures: [active_daily.dau]
`,
  );
  writeFileSync(
    join(packDir, 'retention.yml'),
    `slug: retention
title: Retention
applies_when:
  required_cubes: [retention]
tiles:
  - title: D1
    viz_type: line
    position: { x: 0, y: 0, w: 12, h: 3 }
    query:
      measures: [retention.retained_d1]
`,
  );
}

beforeAll(() => {
  getDb();
  writePack();
  setStarterPackDir(packDir);
});

afterAll(() => {
  try { getDb().close(); } catch { /* ignore */ }
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  const db = getDb();
  db.exec('DELETE FROM dashboard_tiles');
  db.exec('DELETE FROM dashboards');
  __resetStarterPackCache();
});

describe('seedStarterPack', () => {
  it('installs starters whose required cubes are available', () => {
    const res = seedStarterPack({
      owner: 'alice',
      workspace: 'local',
      game: 'ptg',
      availableCubes: new Set(['active_daily', 'retention']),
    });
    expect(res.inserted).toEqual(expect.arrayContaining(['daily-health', 'retention']));
    const count = (getDb().prepare('SELECT COUNT(*) as n FROM dashboards').get() as { n: number }).n;
    expect(count).toBe(2);
  });

  it('skips starters whose required cubes are absent', () => {
    const res = seedStarterPack({
      owner: 'alice',
      workspace: 'local',
      game: 'muaw',
      availableCubes: new Set(['active_daily']),
    });
    expect(res.inserted).toEqual(['daily-health']);
    expect(res.skipped.find((s) => s.slug === 'retention')?.reason).toBe('required_cubes_missing');
  });

  it('is idempotent — re-running inserts nothing', () => {
    seedStarterPack({
      owner: 'alice',
      workspace: 'local',
      game: 'ptg',
      availableCubes: new Set(['active_daily', 'retention']),
    });
    const second = seedStarterPack({
      owner: 'alice',
      workspace: 'local',
      game: 'ptg',
      availableCubes: new Set(['active_daily', 'retention']),
    });
    expect(second.inserted).toEqual([]);
    expect(second.skipped.every((s) => s.reason === 'already_exists')).toBe(true);
  });

  it('inserts tiles for each starter dashboard', () => {
    seedStarterPack({
      owner: 'alice',
      workspace: 'local',
      game: 'ptg',
      availableCubes: new Set(['active_daily']),
    });
    const tiles = getDb().prepare(
      `SELECT t.title FROM dashboard_tiles t JOIN dashboards d ON d.id = t.dashboard_id WHERE d.slug = 'daily-health'`,
    ).all() as Array<{ title: string }>;
    expect(tiles).toHaveLength(1);
    expect(tiles[0].title).toBe('DAU');
  });
});
