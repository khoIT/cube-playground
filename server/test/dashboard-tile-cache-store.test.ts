/**
 * Tests for dashboard-tile-cache-store: hash-skip upserts, stale listing
 * scoped to recently-viewed dashboards, status transitions, FK cascade.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'dashboard-tile-cache-store-test-'));
process.env.DB_PATH = join(tmp, 'test.db');

import { getDb } from '../src/db/sqlite.js';
import {
  upsertTileCache,
  readTileCache,
  setTileStatus,
  expireTile,
  invalidateTile,
  listStaleTilesInRecentDashboards,
} from '../src/services/dashboard-tile-cache-store.js';

let db: ReturnType<typeof getDb>;

beforeAll(() => { db = getDb(); });
afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(tmp, { recursive: true, force: true });
});

function seedDashboardAndTile(opts: { lastViewedAt?: string | null; ttl?: number } = {}): { dashboardId: number; tileId: number } {
  const now = new Date().toISOString();
  const r1 = db
    .prepare(
      `INSERT INTO dashboards (owner, game, slug, title, created_at, updated_at, last_viewed_at, tile_ttl_seconds)
       VALUES ('alice', 'ptg', 'd1', 'D1', ?, ?, ?, ?)`,
    )
    .run(now, now, opts.lastViewedAt ?? now, opts.ttl ?? 300);
  const dashboardId = Number(r1.lastInsertRowid);
  const r2 = db
    .prepare(
      `INSERT INTO dashboard_tiles (dashboard_id, title, query_json, viz_type, position_json, created_at, updated_at)
       VALUES (?, 'T', '{"measures":["x"]}', 'kpi', '{"x":0,"y":0,"w":3,"h":2}', ?, ?)`,
    )
    .run(dashboardId, now, now);
  return { dashboardId, tileId: Number(r2.lastInsertRowid) };
}

beforeEach(() => {
  db.exec('DELETE FROM dashboard_tile_cache');
  db.exec('DELETE FROM dashboard_tiles');
  db.exec('DELETE FROM dashboards');
});

describe('upsertTileCache', () => {
  it('writes a new row on first upsert', () => {
    const { tileId } = seedDashboardAndTile();
    const res = upsertTileCache({ tileId, rows: [{ a: 1 }], cubeMetaVersion: 'm1', ttlSeconds: 300 });
    expect(res.wrote).toBe(true);
    const cached = readTileCache(tileId);
    expect(cached).not.toBeNull();
    expect((cached!.rows[0] as { a: number }).a).toBe(1);
    expect(cached!.status).toBe('fresh');
  });

  it('skip-writes when rows + meta unchanged (preserves fetched_at)', () => {
    const { tileId } = seedDashboardAndTile();
    upsertTileCache({ tileId, rows: [{ a: 1 }], cubeMetaVersion: 'm1', ttlSeconds: 300 });
    const before = readTileCache(tileId)!.fetched_at;
    const res = upsertTileCache({ tileId, rows: [{ a: 1 }], cubeMetaVersion: 'm1', ttlSeconds: 300 });
    expect(res.wrote).toBe(false);
    expect(readTileCache(tileId)!.fetched_at).toBe(before);
  });

  it('writes again when rows change', () => {
    const { tileId } = seedDashboardAndTile();
    upsertTileCache({ tileId, rows: [{ a: 1 }], cubeMetaVersion: 'm1', ttlSeconds: 300 });
    const res = upsertTileCache({ tileId, rows: [{ a: 2 }], cubeMetaVersion: 'm1', ttlSeconds: 300 });
    expect(res.wrote).toBe(true);
    expect((readTileCache(tileId)!.rows[0] as { a: number }).a).toBe(2);
  });
});

describe('listStaleTilesInRecentDashboards', () => {
  it('returns tile in recently-viewed dashboard when cache is missing', () => {
    const { tileId } = seedDashboardAndTile({ lastViewedAt: new Date().toISOString() });
    const stale = listStaleTilesInRecentDashboards(7, 30);
    expect(stale.find((s) => s.tile_id === tileId)).toBeTruthy();
  });

  it('returns tile when cache expired', () => {
    const { tileId } = seedDashboardAndTile({ lastViewedAt: new Date().toISOString() });
    upsertTileCache({ tileId, rows: [], cubeMetaVersion: 'm1', ttlSeconds: 300 });
    expireTile(tileId);
    expect(listStaleTilesInRecentDashboards(7, 30)
      .find((s) => s.tile_id === tileId)).toBeTruthy();
  });

  it('excludes tile in dashboard last viewed outside horizon', () => {
    const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { tileId } = seedDashboardAndTile({ lastViewedAt: old });
    expect(listStaleTilesInRecentDashboards(7, 30)
      .find((s) => s.tile_id === tileId)).toBeUndefined();
  });

  it('excludes tile actively refreshing', () => {
    const { tileId } = seedDashboardAndTile({ lastViewedAt: new Date().toISOString() });
    upsertTileCache({ tileId, rows: [], cubeMetaVersion: 'm1', ttlSeconds: 300 });
    expireTile(tileId);
    setTileStatus(tileId, 'refreshing');
    expect(listStaleTilesInRecentDashboards(7, 30)
      .find((s) => s.tile_id === tileId)).toBeUndefined();
  });

  it('includes tile with broken status (so cron retries)', () => {
    const { tileId } = seedDashboardAndTile({ lastViewedAt: new Date().toISOString() });
    upsertTileCache({ tileId, rows: [], cubeMetaVersion: 'm1', ttlSeconds: 300 });
    setTileStatus(tileId, 'broken', 'cube down');
    const stale = listStaleTilesInRecentDashboards(7, 30);
    expect(stale.find((s) => s.tile_id === tileId)).toBeTruthy();
  });
});

describe('FK cascade', () => {
  it('drops the cache row when the tile is deleted', () => {
    const { tileId } = seedDashboardAndTile();
    upsertTileCache({ tileId, rows: [{ a: 1 }], cubeMetaVersion: 'm1', ttlSeconds: 300 });
    db.prepare('DELETE FROM dashboard_tiles WHERE id = ?').run(tileId);
    expect(readTileCache(tileId)).toBeNull();
  });
});

describe('invalidateTile', () => {
  it('removes the cache row outright', () => {
    const { tileId } = seedDashboardAndTile();
    upsertTileCache({ tileId, rows: [{ a: 1 }], cubeMetaVersion: 'm1', ttlSeconds: 300 });
    invalidateTile(tileId);
    expect(readTileCache(tileId)).toBeNull();
  });
});
