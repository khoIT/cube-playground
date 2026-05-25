/**
 * Unit tests for disambig-memory-adapter.
 *
 * Covers:
 *   - getResolutions on empty session returns empty object
 *   - mergeResolution + getResolutions roundtrip preserves slots
 *   - subsequent merges accumulate across slots
 *   - filters object deep-merges (partial wins on conflict)
 *   - cacheServiceEnabled=false → all ops no-op
 *   - corrupt JSON returns empty
 *   - different sessions are isolated
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import {
  getResolutions,
  mergeResolution,
} from '../../src/cache/disambig-memory-adapter.js';
import { kvPut } from '../../src/cache/kv-cache-store.js';
import { config } from '../../src/config.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

describe('disambig-memory-adapter', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = true;
  });

  it('returns empty bag for a session with no resolutions', () => {
    expect(getResolutions(db, 'sess-1')).toEqual({});
  });

  it('roundtrip preserves slot values', () => {
    mergeResolution(db, 'sess-1', 'owner-a', {
      metric: 'recharge.revenue_vnd',
      dimension: 'recharge.payment_channel',
    });
    const r = getResolutions(db, 'sess-1');
    expect(r.metric).toBe('recharge.revenue_vnd');
    expect(r.dimension).toBe('recharge.payment_channel');
    expect(r.updatedAt).toBeTypeOf('number');
  });

  it('merges accumulate across calls', () => {
    mergeResolution(db, 'sess-1', 'owner-a', { metric: 'm1' });
    mergeResolution(db, 'sess-1', 'owner-a', { dimension: 'd1' });
    const r = getResolutions(db, 'sess-1');
    expect(r.metric).toBe('m1');
    expect(r.dimension).toBe('d1');
  });

  it('partial slot replacements win on conflict', () => {
    mergeResolution(db, 'sess-1', 'owner-a', { metric: 'arpdau' });
    mergeResolution(db, 'sess-1', 'owner-a', { metric: 'arpu' });
    expect(getResolutions(db, 'sess-1').metric).toBe('arpu');
  });

  it('filters object deep-merges and partial wins on conflict', () => {
    mergeResolution(db, 'sess-1', 'owner-a', {
      filters: { 'players.country': 'VN', 'recharge.channel': 'iap' },
    });
    mergeResolution(db, 'sess-1', 'owner-a', {
      filters: { 'recharge.channel': 'web' },
    });
    const r = getResolutions(db, 'sess-1');
    expect(r.filters?.['players.country']).toBe('VN');
    expect(r.filters?.['recharge.channel']).toBe('web');
  });

  it('different sessions are isolated', () => {
    mergeResolution(db, 'sess-A', 'owner-a', { metric: 'm-A' });
    mergeResolution(db, 'sess-B', 'owner-a', { metric: 'm-B' });
    expect(getResolutions(db, 'sess-A').metric).toBe('m-A');
    expect(getResolutions(db, 'sess-B').metric).toBe('m-B');
  });

  it('cacheServiceEnabled=false → get returns empty + merge is a no-op', () => {
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = false;
    mergeResolution(db, 'sess-1', 'owner-a', { metric: 'm1' });
    expect(getResolutions(db, 'sess-1')).toEqual({});
    // Re-enable to confirm nothing landed
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = true;
    expect(getResolutions(db, 'sess-1')).toEqual({});
  });

  it('corrupt value_json returns empty bag', () => {
    kvPut(db, {
      kind: 'disambig_resolution',
      key: 'session:sess-1',
      valueJson: '{not-json',
    });
    expect(getResolutions(db, 'sess-1')).toEqual({});
  });
});
