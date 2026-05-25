/**
 * Tests for dashboard-store: CRUD round-trips and ≤8 tile cap enforcement.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Must set DB_PATH before any import that calls getDb()
const tmp = mkdtempSync(join(tmpdir(), 'dashboard-store-test-'));
process.env.DB_PATH = join(tmp, 'test.db');

import { getDb } from '../src/db/sqlite.js';
import {
  createDashboard,
  getDashboard,
  listDashboards,
  updateDashboard,
  deleteDashboard,
  addTile,
  updateTile,
  deleteTile,
  setLayout,
  TileCapError,
  TILE_CAP,
} from '../src/services/dashboard-store.js';

let db: ReturnType<typeof getDb>;

beforeAll(() => {
  db = getDb();
});

afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  // Clean slate between tests
  db.exec('DELETE FROM dashboard_tiles');
  db.exec('DELETE FROM dashboards');
});

describe('createDashboard / listDashboards / getDashboard', () => {
  it('creates a dashboard and retrieves it', () => {
    const d = createDashboard({ owner: 'alice', game: 'ptg', slug: 'my-dash', title: 'My Dash' });
    expect(d.id).toBeTypeOf('number');
    expect(d.slug).toBe('my-dash');
    expect(d.title).toBe('My Dash');

    const list = listDashboards('alice', 'ptg');
    expect(list).toHaveLength(1);
    expect(list[0].slug).toBe('my-dash');
  });

  it('getDashboard returns dashboard with tiles array', () => {
    createDashboard({ owner: 'alice', game: 'ptg', slug: 'with-tiles', title: 'With Tiles' });
    const result = getDashboard('alice', 'ptg', 'with-tiles');
    expect(result).not.toBeNull();
    expect(result!.tiles).toEqual([]);
  });

  it('returns null for unknown dashboard', () => {
    expect(getDashboard('alice', 'ptg', 'nope')).toBeNull();
  });

  it('scopes by owner', () => {
    createDashboard({ owner: 'alice', game: 'ptg', slug: 'a-dash', title: 'A' });
    createDashboard({ owner: 'bob', game: 'ptg', slug: 'b-dash', title: 'B' });
    expect(listDashboards('alice', 'ptg')).toHaveLength(1);
    expect(listDashboards('bob', 'ptg')).toHaveLength(1);
  });

  it('scopes by game', () => {
    createDashboard({ owner: 'alice', game: 'ptg', slug: 'ptg-dash', title: 'PTG' });
    createDashboard({ owner: 'alice', game: 'other', slug: 'other-dash', title: 'Other' });
    expect(listDashboards('alice', 'ptg')).toHaveLength(1);
    expect(listDashboards('alice', 'other')).toHaveLength(1);
  });
});

describe('updateDashboard', () => {
  it('updates title', () => {
    createDashboard({ owner: 'alice', game: 'ptg', slug: 'upd', title: 'Old' });
    const updated = updateDashboard('alice', 'ptg', 'upd', { title: 'New' });
    expect(updated?.title).toBe('New');
  });

  it('returns null for missing dashboard', () => {
    expect(updateDashboard('alice', 'ptg', 'ghost', { title: 'X' })).toBeNull();
  });
});

describe('deleteDashboard', () => {
  it('deletes a dashboard and cascades tiles', () => {
    const d = createDashboard({ owner: 'alice', game: 'ptg', slug: 'del-me', title: 'Del' });
    addTile(d.id, {
      title: 'T1',
      query_json: '{}',
      viz_type: 'table',
      position_json: '{"x":0,"y":0,"w":4,"h":3}',
    });
    const deleted = deleteDashboard('alice', 'ptg', 'del-me');
    expect(deleted).toBe(true);
    expect(getDashboard('alice', 'ptg', 'del-me')).toBeNull();
    // Tiles should be gone via FK cascade
    const count = (db.prepare('SELECT COUNT(*) as n FROM dashboard_tiles WHERE dashboard_id = ?').get(d.id) as { n: number }).n;
    expect(count).toBe(0);
  });

  it('returns false for non-existent', () => {
    expect(deleteDashboard('alice', 'ptg', 'ghost')).toBe(false);
  });
});

describe('addTile / ≤8 cap', () => {
  it('adds a tile and returns it', () => {
    const d = createDashboard({ owner: 'alice', game: 'ptg', slug: 'tile-test', title: 'T' });
    const tile = addTile(d.id, {
      title: 'KPI',
      query_json: '{"measures":["Orders.count"]}',
      viz_type: 'kpi',
      position_json: '{"x":0,"y":0,"w":4,"h":3}',
    });
    expect(tile.id).toBeTypeOf('number');
    expect(tile.viz_type).toBe('kpi');

    const detail = getDashboard('alice', 'ptg', 'tile-test')!;
    expect(detail.tiles).toHaveLength(1);
  });

  it(`throws TileCapError when adding tile ${TILE_CAP + 1}`, () => {
    const d = createDashboard({ owner: 'alice', game: 'ptg', slug: 'cap-test', title: 'Cap' });
    for (let i = 0; i < TILE_CAP; i++) {
      addTile(d.id, {
        title: `T${i}`,
        query_json: '{}',
        viz_type: 'table',
        position_json: '{"x":0,"y":0,"w":3,"h":3}',
      });
    }
    expect(() =>
      addTile(d.id, {
        title: 'Overflow',
        query_json: '{}',
        viz_type: 'table',
        position_json: '{"x":0,"y":0,"w":3,"h":3}',
      })
    ).toThrowError(TileCapError);
  });
});

describe('updateTile / deleteTile', () => {
  it('updates tile fields', () => {
    const d = createDashboard({ owner: 'alice', game: 'ptg', slug: 'upd-tile', title: 'UT' });
    const t = addTile(d.id, { title: 'Old', query_json: '{}', viz_type: 'table', position_json: '{"x":0,"y":0,"w":4,"h":3}' });
    const updated = updateTile(t.id, { title: 'New', viz_type: 'kpi' });
    expect(updated?.title).toBe('New');
    expect(updated?.viz_type).toBe('kpi');
  });

  it('returns null for missing tile', () => {
    expect(updateTile(999999, { title: 'X' })).toBeNull();
  });

  it('deletes a tile', () => {
    const d = createDashboard({ owner: 'alice', game: 'ptg', slug: 'del-tile', title: 'DT' });
    const t = addTile(d.id, { title: 'T', query_json: '{}', viz_type: 'table', position_json: '{"x":0,"y":0,"w":4,"h":3}' });
    expect(deleteTile(t.id)).toBe(true);
    expect(getDashboard('alice', 'ptg', 'del-tile')!.tiles).toHaveLength(0);
  });
});

describe('setLayout', () => {
  it('batch-updates tile positions in a transaction', () => {
    const d = createDashboard({ owner: 'alice', game: 'ptg', slug: 'layout', title: 'L' });
    const t1 = addTile(d.id, { title: 'T1', query_json: '{}', viz_type: 'table', position_json: '{"x":0,"y":0,"w":4,"h":3}' });
    const t2 = addTile(d.id, { title: 'T2', query_json: '{}', viz_type: 'kpi', position_json: '{"x":4,"y":0,"w":4,"h":3}' });

    setLayout(d.id, [
      { tileId: t1.id, position: { x: 0, y: 5, w: 6, h: 4 } },
      { tileId: t2.id, position: { x: 6, y: 5, w: 6, h: 4 } },
    ]);

    const detail = getDashboard('alice', 'ptg', 'layout')!;
    const tile1 = detail.tiles.find((t) => t.id === t1.id)!;
    const pos1 = JSON.parse(tile1.position_json);
    expect(pos1.y).toBe(5);
    expect(pos1.w).toBe(6);
  });
});
