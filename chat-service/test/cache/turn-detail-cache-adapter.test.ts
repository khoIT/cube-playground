/**
 * Unit tests for turn-detail-cache-adapter.
 *
 * Covers:
 *   - put + get roundtrip preserves all three lists
 *   - get returns null on miss
 *   - evict removes a specific entry
 *   - corrupt JSON returns null
 *   - cacheServiceEnabled=false → all ops no-op
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import { kvPut } from '../../src/cache/kv-cache-store.js';
import {
  getCachedTurnDetail,
  putCachedTurnDetail,
  evictCachedTurnDetail,
  type TurnDetailPayload,
} from '../../src/cache/turn-detail-cache-adapter.js';
import { config } from '../../src/config.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

const PAYLOAD: TurnDetailPayload = {
  llmCalls: [{ id: 'l1', model: 'claude-test', input_tokens: 100, output_tokens: 50 }],
  toolInvocations: [{ id: 'ti1', name: 'preview_cube_query', ok: true, ms: 120 }],
  permissionDecisions: [{ id: 'p1', tool: 'preview_cube_query', decision: 'allow' }],
};

describe('turn-detail-cache-adapter', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = true;
  });

  it('put + get roundtrip preserves all three lists', () => {
    putCachedTurnDetail(db, 'turn-1', PAYLOAD);
    const got = getCachedTurnDetail(db, 'turn-1');
    expect(got).toEqual(PAYLOAD);
  });

  it('get returns null on miss', () => {
    expect(getCachedTurnDetail(db, 'missing-turn')).toBeNull();
  });

  it('different turnIds do not collide', () => {
    putCachedTurnDetail(db, 'turn-a', {
      ...PAYLOAD,
      llmCalls: [{ id: 'lA' }],
    });
    putCachedTurnDetail(db, 'turn-b', {
      ...PAYLOAD,
      llmCalls: [{ id: 'lB' }],
    });
    expect(getCachedTurnDetail(db, 'turn-a')!.llmCalls).toEqual([{ id: 'lA' }]);
    expect(getCachedTurnDetail(db, 'turn-b')!.llmCalls).toEqual([{ id: 'lB' }]);
  });

  it('evictCachedTurnDetail removes the entry', () => {
    putCachedTurnDetail(db, 'turn-1', PAYLOAD);
    expect(evictCachedTurnDetail(db, 'turn-1')).toBe(true);
    expect(getCachedTurnDetail(db, 'turn-1')).toBeNull();
  });

  it('evict on missing entry returns false', () => {
    expect(evictCachedTurnDetail(db, 'absent')).toBe(false);
  });

  it('corrupt value_json returns null instead of throwing', () => {
    kvPut(db, { kind: 'turn_detail', key: 'turn-1', valueJson: '{not-json' });
    expect(getCachedTurnDetail(db, 'turn-1')).toBeNull();
  });

  it('cacheServiceEnabled=false → get returns null and put is a no-op', () => {
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = false;
    putCachedTurnDetail(db, 'turn-1', PAYLOAD);
    // Re-enable to confirm put didn't land
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = true;
    expect(getCachedTurnDetail(db, 'turn-1')).toBeNull();
  });

  it('hit on second read after first write (sanity)', () => {
    expect(getCachedTurnDetail(db, 'turn-1')).toBeNull();
    putCachedTurnDetail(db, 'turn-1', PAYLOAD);
    expect(getCachedTurnDetail(db, 'turn-1')).not.toBeNull();
    expect(getCachedTurnDetail(db, 'turn-1')).not.toBeNull();
  });
});
