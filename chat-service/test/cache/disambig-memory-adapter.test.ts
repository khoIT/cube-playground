/**
 * Unit tests for disambig-memory-adapter.
 *
 * Covers:
 *   - getResolutions on empty session returns empty object
 *   - mergeResolution + getResolutions roundtrip preserves slots (SlotMemory shape)
 *   - subsequent merges accumulate across slots
 *   - filters object deep-merges (partial wins on conflict)
 *   - timeRange roundtrip with phrase + dateRange + granularity
 *   - cacheServiceEnabled=false → all ops no-op
 *   - corrupt JSON returns empty
 *   - different sessions are isolated
 *   - legacy bare-string rows (pre-SlotMemory) are tolerated and normalised
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

  it('roundtrip preserves slot values with SlotMemory wrapper', () => {
    mergeResolution(db, 'sess-1', 'owner-a', {
      metric: { value: 'recharge.revenue_vnd', phrase: 'revenue' },
      dimension: { value: 'recharge.payment_channel', phrase: 'by channel' },
    });
    const r = getResolutions(db, 'sess-1');
    expect(r.metric?.value).toBe('recharge.revenue_vnd');
    expect(r.metric?.phrase).toBe('revenue');
    expect(r.dimension?.value).toBe('recharge.payment_channel');
    expect(r.dimension?.phrase).toBe('by channel');
    expect(r.updatedAt).toBeTypeOf('number');
  });

  it('merges accumulate across calls', () => {
    mergeResolution(db, 'sess-1', 'owner-a', { metric: { value: 'm1' } });
    mergeResolution(db, 'sess-1', 'owner-a', { dimension: { value: 'd1' } });
    const r = getResolutions(db, 'sess-1');
    expect(r.metric?.value).toBe('m1');
    expect(r.dimension?.value).toBe('d1');
  });

  it('partial slot replacements win on conflict', () => {
    mergeResolution(db, 'sess-1', 'owner-a', { metric: { value: 'arpdau' } });
    mergeResolution(db, 'sess-1', 'owner-a', { metric: { value: 'arpu' } });
    expect(getResolutions(db, 'sess-1').metric?.value).toBe('arpu');
  });

  it('filters object deep-merges and partial wins on conflict', () => {
    mergeResolution(db, 'sess-1', 'owner-a', {
      filters: {
        'players.country': { value: 'VN' },
        'recharge.channel': { value: 'iap' },
      },
    });
    mergeResolution(db, 'sess-1', 'owner-a', {
      filters: { 'recharge.channel': { value: 'web' } },
    });
    const r = getResolutions(db, 'sess-1');
    expect(r.filters?.['players.country']?.value).toBe('VN');
    expect(r.filters?.['recharge.channel']?.value).toBe('web');
  });

  it('timeRange roundtrip preserves phrase + dateRange + granularity', () => {
    mergeResolution(db, 'sess-1', 'owner-a', {
      timeRange: {
        value: { dateRange: 'this week', granularity: 'day' },
        phrase: 'this week',
      },
    });
    const r = getResolutions(db, 'sess-1');
    expect(r.timeRange?.value.dateRange).toBe('this week');
    expect(r.timeRange?.value.granularity).toBe('day');
    expect(r.timeRange?.phrase).toBe('this week');
  });

  it('different sessions are isolated', () => {
    mergeResolution(db, 'sess-A', 'owner-a', { metric: { value: 'm-A' } });
    mergeResolution(db, 'sess-B', 'owner-a', { metric: { value: 'm-B' } });
    expect(getResolutions(db, 'sess-A').metric?.value).toBe('m-A');
    expect(getResolutions(db, 'sess-B').metric?.value).toBe('m-B');
  });

  it('cacheServiceEnabled=false → get returns empty + merge is a no-op', () => {
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = false;
    mergeResolution(db, 'sess-1', 'owner-a', { metric: { value: 'm1' } });
    expect(getResolutions(db, 'sess-1')).toEqual({});
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

  it('legacy bare-string rows normalise to SlotMemory<string>', () => {
    // Simulate a row written before the SlotMemory shape change.
    kvPut(db, {
      kind: 'disambig_resolution',
      key: 'session:legacy-1',
      valueJson: JSON.stringify({
        metric: 'recharge.revenue_vnd',
        dimension: 'players.country',
        filters: { 'players.platform': 'ios' },
        updatedAt: 123,
      }),
    });
    const r = getResolutions(db, 'legacy-1');
    expect(r.metric?.value).toBe('recharge.revenue_vnd');
    expect(r.metric?.phrase).toBeUndefined();
    expect(r.dimension?.value).toBe('players.country');
    expect(r.filters?.['players.platform']?.value).toBe('ios');
    expect(r.updatedAt).toBe(123);
  });
});
