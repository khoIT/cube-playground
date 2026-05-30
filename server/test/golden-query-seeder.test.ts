/**
 * Unit tests for the golden-query seeder. Seeds dashboard_tiles with real
 * CubeQuery JSON and asserts the frequency + co-occurrence index. Chat DB is
 * absent (CHAT_DB_PATH unset) so chat mining is exercised as best-effort skip.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'golden-seeder-'));
process.env.DB_PATH = join(tmp, 'golden.db');
delete process.env.CHAT_DB_PATH;

import { getDb, closeDb } from '../src/db/sqlite.js';
import { getGoldenIndex, memberSeenCount, __resetGoldenCache } from '../src/services/golden-query-seeder.js';

function seedTile(query: unknown, ts = '2026-05-30T00:00:00Z'): void {
  const db = getDb();
  const info = db
    .prepare(`INSERT INTO dashboards (owner, game, slug, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run('tester', 'ballistar', `d-${ts}-${Math.round(Math.random() * 1e9)}`, 'd', ts, ts);
  db.prepare(
    `INSERT INTO dashboard_tiles (dashboard_id, title, query_json, viz_type, position_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(info.lastInsertRowid, 'tile', JSON.stringify(query), 'bar', '{}', ts, ts);
}

beforeEach(() => {
  getDb().exec('DELETE FROM dashboard_tiles; DELETE FROM dashboards;');
  __resetGoldenCache();
});

afterAll(() => {
  closeDb();
  rmSync(tmp, { recursive: true, force: true });
});

describe('getGoldenIndex', () => {
  it('counts member frequency across tiles (bare member names)', () => {
    seedTile({ measures: ['active_daily.dau'], dimensions: ['active_daily.country_code'] });
    seedTile({ measures: ['active_daily.dau'], dimensions: ['active_daily.os_platform'] });
    const idx = getGoldenIndex(true);
    expect(idx.totalQueries).toBe(2);
    expect(idx.memberFrequency['dau']).toBe(2);
    expect(idx.memberFrequency['country_code']).toBe(1);
  });

  it('builds a measure→dimension co-occurrence index', () => {
    seedTile({ measures: ['active_daily.dau'], dimensions: ['active_daily.country_code'] });
    seedTile({ measures: ['active_daily.dau'], dimensions: ['active_daily.country_code'] });
    const idx = getGoldenIndex(true);
    expect(idx.coOccurrence['dau']['country_code']).toBe(2);
  });

  it('includes time-dimension members in frequency', () => {
    seedTile({ measures: ['recharge.revenue'], timeDimensions: [{ dimension: 'recharge.log_date', granularity: 'day' }] });
    const idx = getGoldenIndex(true);
    expect(idx.memberFrequency['log_date']).toBe(1);
  });

  it('memberSeenCount resolves bare + qualified names', () => {
    seedTile({ measures: ['active_daily.dau'], dimensions: [] });
    const idx = getGoldenIndex(true);
    expect(memberSeenCount('dau', idx)).toBe(1);
    expect(memberSeenCount('active_daily.dau', idx)).toBe(1);
    expect(memberSeenCount('nonexistent', idx)).toBe(0);
  });

  it('survives malformed query_json without throwing', () => {
    const db = getDb();
    const info = db.prepare(`INSERT INTO dashboards (owner, game, slug, title, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
      .run('t', 'ballistar', 'd-malformed', 'd', '2026-05-30T00:00:00Z', '2026-05-30T00:00:00Z');
    db.prepare(`INSERT INTO dashboard_tiles (dashboard_id, title, query_json, viz_type, position_json, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`)
      .run(info.lastInsertRowid, 't', 'NOT JSON', 'bar', '{}', '2026-05-30T00:00:00Z', '2026-05-30T00:00:00Z');
    seedTile({ measures: ['x.m'], dimensions: [] });
    const idx = getGoldenIndex(true);
    expect(idx.totalQueries).toBe(1); // malformed skipped, valid counted
  });
});
