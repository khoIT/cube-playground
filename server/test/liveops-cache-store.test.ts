/**
 * Tests for liveops-cache-store: upsert hash-skip, status transitions,
 * stale-listing, and funnel retention sweep.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const tmp = mkdtempSync(join(tmpdir(), 'liveops-cache-store-test-'));
process.env.DB_PATH = join(tmp, 'test.db');

import { getDb } from '../src/db/sqlite.js';
import {
  upsertCache,
  readCache,
  setStatus,
  listStale,
  ensurePlaceholder,
  expireKey,
  pruneFunnelOlderThan,
  logRefresh,
} from '../src/services/liveops-cache-store.js';

let db: ReturnType<typeof getDb>;

beforeAll(() => { db = getDb(); });
afterAll(() => {
  try { db.close(); } catch { /* ignore */ }
  rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  db.exec('DELETE FROM liveops_result_cache');
  db.exec('DELETE FROM liveops_refresh_log');
});

describe('upsertCache', () => {
  it('writes a new row on first upsert', () => {
    const res = upsertCache({
      resource: 'kpi_strip',
      cacheKey: 'cfm',
      game: 'cfm',
      payload: { tiles: [{ id: 'dau', latest: 100 }] },
      cubeMetaVersion: 'meta-v1',
      ttlSeconds: 300,
    });
    expect(res.wrote).toBe(true);

    const cached = readCache<{ tiles: Array<{ id: string; latest: number }> }>('kpi_strip', 'cfm');
    expect(cached).not.toBeNull();
    expect(cached!.payload.tiles[0].latest).toBe(100);
    expect(cached!.status).toBe('fresh');
    expect(cached!.cubeMetaVersion).toBe('meta-v1');
  });

  it('skip-writes when payload + meta version unchanged', () => {
    upsertCache({
      resource: 'kpi_strip', cacheKey: 'cfm', game: 'cfm',
      payload: { tiles: [{ id: 'dau', latest: 100 }] },
      cubeMetaVersion: 'meta-v1', ttlSeconds: 300,
    });
    const before = readCache('kpi_strip', 'cfm')!.fetchedAt;
    // Tiny sleep so wall-clock would tick if we wrote.
    const res = upsertCache({
      resource: 'kpi_strip', cacheKey: 'cfm', game: 'cfm',
      payload: { tiles: [{ id: 'dau', latest: 100 }] },
      cubeMetaVersion: 'meta-v1', ttlSeconds: 300,
    });
    expect(res.wrote).toBe(false);
    const after = readCache('kpi_strip', 'cfm')!.fetchedAt;
    // fetched_at must NOT advance — snapshot-quiet contract.
    expect(after).toBe(before);
  });

  it('writes when payload changes', () => {
    upsertCache({
      resource: 'kpi_strip', cacheKey: 'cfm', game: 'cfm',
      payload: { tiles: [{ id: 'dau', latest: 100 }] },
      cubeMetaVersion: 'meta-v1', ttlSeconds: 300,
    });
    const res = upsertCache({
      resource: 'kpi_strip', cacheKey: 'cfm', game: 'cfm',
      payload: { tiles: [{ id: 'dau', latest: 200 }] },
      cubeMetaVersion: 'meta-v1', ttlSeconds: 300,
    });
    expect(res.wrote).toBe(true);
    const cached = readCache<{ tiles: Array<{ id: string; latest: number }> }>('kpi_strip', 'cfm');
    expect(cached!.payload.tiles[0].latest).toBe(200);
  });

  it('writes when meta version changes', () => {
    upsertCache({
      resource: 'kpi_strip', cacheKey: 'cfm', game: 'cfm',
      payload: { tiles: [] }, cubeMetaVersion: 'meta-v1', ttlSeconds: 300,
    });
    const res = upsertCache({
      resource: 'kpi_strip', cacheKey: 'cfm', game: 'cfm',
      payload: { tiles: [] }, cubeMetaVersion: 'meta-v2', ttlSeconds: 300,
    });
    expect(res.wrote).toBe(true);
    expect(readCache('kpi_strip', 'cfm')!.cubeMetaVersion).toBe('meta-v2');
  });
});

describe('listStale', () => {
  it('returns rows whose expires_at is in the past', () => {
    upsertCache({
      resource: 'kpi_strip', cacheKey: 'cfm', game: 'cfm',
      payload: { tiles: [] }, cubeMetaVersion: 'm', ttlSeconds: 300,
    });
    upsertCache({
      resource: 'kpi_strip', cacheKey: 'ptg', game: 'ptg',
      payload: { tiles: [] }, cubeMetaVersion: 'm', ttlSeconds: 300,
    });
    expireKey('kpi_strip', 'cfm');
    const stale = listStale();
    expect(stale.map((s) => s.cacheKey)).toContain('cfm');
    expect(stale.map((s) => s.cacheKey)).not.toContain('ptg');
  });

  it('excludes rows actively refreshing', () => {
    upsertCache({
      resource: 'kpi_strip', cacheKey: 'cfm', game: 'cfm',
      payload: { tiles: [] }, cubeMetaVersion: 'm', ttlSeconds: 300,
    });
    expireKey('kpi_strip', 'cfm');
    setStatus('kpi_strip', 'cfm', 'refreshing');
    expect(listStale().length).toBe(0);
  });
});

describe('ensurePlaceholder', () => {
  it('inserts a refreshing-status row when absent', () => {
    ensurePlaceholder('cohort_grid', 'cfm:14', 'cfm', 'meta-v1');
    const cached = readCache('cohort_grid', 'cfm:14');
    expect(cached).not.toBeNull();
    expect(cached!.status).toBe('refreshing');
  });

  it('is a no-op when a row already exists', () => {
    upsertCache({
      resource: 'cohort_grid', cacheKey: 'cfm:14', game: 'cfm',
      payload: { rows: [{ installDate: '2026-05-01' }] }, cubeMetaVersion: 'm', ttlSeconds: 300,
    });
    ensurePlaceholder('cohort_grid', 'cfm:14', 'cfm', 'meta-v9');
    // Payload still the original — placeholder didn't overwrite.
    const cached = readCache<{ rows: Array<{ installDate: string }> }>('cohort_grid', 'cfm:14');
    expect(cached!.payload.rows[0].installDate).toBe('2026-05-01');
  });
});

describe('pruneFunnelOlderThan', () => {
  it('drops funnel rows older than the cutoff', () => {
    upsertCache({
      resource: 'funnel_result', cacheKey: 'cfm:old', game: 'cfm',
      payload: {}, cubeMetaVersion: 'm', ttlSeconds: 300,
    });
    // Backdate the row's fetched_at by 30 days.
    const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
    db.prepare(
      `UPDATE liveops_result_cache SET fetched_at = ? WHERE cache_key = 'cfm:old'`,
    ).run(old);

    upsertCache({
      resource: 'funnel_result', cacheKey: 'cfm:fresh', game: 'cfm',
      payload: {}, cubeMetaVersion: 'm', ttlSeconds: 300,
    });

    const removed = pruneFunnelOlderThan(14);
    expect(removed).toBe(1);
    expect(readCache('funnel_result', 'cfm:old')).toBeNull();
    expect(readCache('funnel_result', 'cfm:fresh')).not.toBeNull();
  });
});

describe('logRefresh', () => {
  it('appends to liveops_refresh_log', () => {
    logRefresh({ resource: 'kpi_strip', cacheKey: 'cfm', game: 'cfm', durationMs: 123, status: 'ok' });
    const rows = db.prepare('SELECT * FROM liveops_refresh_log').all() as Array<{ duration_ms: number; status: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].duration_ms).toBe(123);
    expect(rows[0].status).toBe('ok');
  });
});
