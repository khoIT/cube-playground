/**
 * Unit tests for load-cache-adapter.
 *
 * Covers:
 *   - put + get roundtrip preserves rows
 *   - key stability: equivalent queries with different key insertion order hash equally
 *   - metaHash invalidation: same query under different metaHash → cache miss
 *   - gameId scoping: same query under different gameId → cache miss
 *   - TTL expiry behavior
 *   - corrupt value_json returns null instead of throwing
 *   - cache disabled (config.cacheServiceEnabled=false) → all ops no-op
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import { kvPut } from '../../src/cache/kv-cache-store.js';
import {
  getCachedLoad,
  putCachedLoad,
  loadCacheKey,
} from '../../src/cache/load-cache-adapter.js';
import { config } from '../../src/config.js';
import type { CubeQuery } from '../../src/types.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

const Q1: CubeQuery = {
  measures: ['recharge.revenue_vnd'],
  dimensions: ['recharge.payment_channel'],
  timeDimensions: [{ dimension: 'recharge.day', dateRange: ['2026-05-01', '2026-05-25'] }],
  limit: 10,
};

const ROWS = [
  { 'recharge.payment_channel': 'iap', 'recharge.revenue_vnd': 1_200_000 },
  { 'recharge.payment_channel': 'web', 'recharge.revenue_vnd': 350_000 },
];

describe('load-cache-adapter', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
    // Force the cache on for these tests in case some other suite flipped it.
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = true;
  });

  // -------------------------------------------------------------------------
  // Roundtrip
  // -------------------------------------------------------------------------

  it('put + get roundtrip preserves rows', () => {
    putCachedLoad(db, { query: Q1, gameId: 'ballistar', metaHash: 'h1', rows: ROWS });
    const got = getCachedLoad(db, { query: Q1, gameId: 'ballistar', metaHash: 'h1' });
    expect(got).toEqual(ROWS);
  });

  it('get returns null on miss', () => {
    expect(getCachedLoad(db, { query: Q1, gameId: 'ballistar', metaHash: 'h1' })).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Key stability
  // -------------------------------------------------------------------------

  it('queries with different key order hash to the same key', () => {
    const qA: CubeQuery = {
      measures: ['m1'],
      dimensions: ['d1'],
      limit: 10,
    };
    const qB: CubeQuery = {
      limit: 10,
      dimensions: ['d1'],
      measures: ['m1'],
    };
    expect(loadCacheKey(qA, 'g1', 'h1')).toBe(loadCacheKey(qB, 'g1', 'h1'));
  });

  it('queries with different content hash to different keys', () => {
    const qA: CubeQuery = { measures: ['m1'] };
    const qB: CubeQuery = { measures: ['m2'] };
    expect(loadCacheKey(qA, 'g1', 'h1')).not.toBe(loadCacheKey(qB, 'g1', 'h1'));
  });

  // -------------------------------------------------------------------------
  // Invalidation dimensions
  // -------------------------------------------------------------------------

  it('different metaHash → cache miss (schema-version invalidation)', () => {
    putCachedLoad(db, { query: Q1, gameId: 'g1', metaHash: 'h-old', rows: ROWS });
    const miss = getCachedLoad(db, { query: Q1, gameId: 'g1', metaHash: 'h-new' });
    expect(miss).toBeNull();
    // Old hash still hits
    expect(getCachedLoad(db, { query: Q1, gameId: 'g1', metaHash: 'h-old' })).toEqual(ROWS);
  });

  it('different gameId → cache miss (game scoping)', () => {
    putCachedLoad(db, { query: Q1, gameId: 'game-a', metaHash: 'h1', rows: ROWS });
    expect(getCachedLoad(db, { query: Q1, gameId: 'game-b', metaHash: 'h1' })).toBeNull();
  });

  // -------------------------------------------------------------------------
  // TTL
  // -------------------------------------------------------------------------

  it('expired entries return null', async () => {
    // Use a very short TTL and a fake clock to avoid real waiting.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    putCachedLoad(db, {
      query: Q1, gameId: 'g1', metaHash: 'h1', rows: ROWS, ttlMs: 1,
    });
    vi.setSystemTime(new Date(10_000));
    const got = getCachedLoad(db, { query: Q1, gameId: 'g1', metaHash: 'h1' });
    expect(got).toBeNull();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Corrupt payload
  // -------------------------------------------------------------------------

  it('corrupt value_json returns null instead of throwing', () => {
    // Inject a broken row directly via kvPut to simulate corruption.
    const key = loadCacheKey(Q1, 'g1', 'h1');
    kvPut(db, {
      kind: 'load', key, valueJson: '{not-json',
      gameId: 'g1', metaHash: 'h1',
    });
    expect(getCachedLoad(db, { query: Q1, gameId: 'g1', metaHash: 'h1' })).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Gating
  // -------------------------------------------------------------------------

  it('returns null and skips writes when cacheServiceEnabled=false', () => {
    putCachedLoad(db, { query: Q1, gameId: 'g1', metaHash: 'h1', rows: ROWS });
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = false;
    // Read disabled
    expect(getCachedLoad(db, { query: Q1, gameId: 'g1', metaHash: 'h1' })).toBeNull();
    // Write disabled — verify by re-enabling and confirming new put didn't land
    const Q2: CubeQuery = { measures: ['m2'] };
    putCachedLoad(db, { query: Q2, gameId: 'g1', metaHash: 'h1', rows: [{ x: 1 }] });
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = true;
    expect(getCachedLoad(db, { query: Q2, gameId: 'g1', metaHash: 'h1' })).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Null metaHash
  // -------------------------------------------------------------------------

  it('null metaHash is a valid key component (legacy / pre-meta-hash callers)', () => {
    putCachedLoad(db, { query: Q1, gameId: 'g1', metaHash: null, rows: ROWS });
    expect(getCachedLoad(db, { query: Q1, gameId: 'g1', metaHash: null })).toEqual(ROWS);
  });
});
