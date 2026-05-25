/**
 * Unit tests for kv-cache-store.
 *
 * Covers:
 *   - put + get roundtrip preserves all metadata
 *   - get returns null on miss
 *   - get treats expired rows as miss (without deletion)
 *   - hit_count + last_hit_at update on get hit
 *   - kind isolation: same key under different kinds does not collide
 *   - evict removes a specific row
 *   - evictByKind removes only rows of that kind
 *   - sweepExpired drops expired rows, preserves rows with no expiry
 *   - put on existing (kind, key) replaces value and resets hit_count
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import {
  kvGet,
  kvPut,
  kvEvict,
  kvEvictByKind,
  kvSweepExpired,
  kvCountByKind,
} from '../../src/cache/kv-cache-store.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

describe('kv-cache-store', () => {
  let db: Database.Database;
  beforeEach(() => { db = makeDb(); });

  // -------------------------------------------------------------------------
  // Roundtrip
  // -------------------------------------------------------------------------

  it('put + get roundtrip preserves all metadata', () => {
    const t = 1_700_000_000_000;
    kvPut(db, {
      kind: 'load', key: 'k1', valueJson: '{"rows":[]}',
      ownerId: 'owner-a', gameId: 'game-1', metaHash: 'meta-x',
      model: 'claude-test', inputTokens: 100, outputTokens: 50,
      costUsd: 0.001, expiresAt: t + 60_000, now: t,
    });

    const row = kvGet(db, 'load', 'k1', t + 1000);
    expect(row).not.toBeNull();
    expect(row!.kind).toBe('load');
    expect(row!.key).toBe('k1');
    expect(row!.valueJson).toBe('{"rows":[]}');
    expect(row!.ownerId).toBe('owner-a');
    expect(row!.gameId).toBe('game-1');
    expect(row!.metaHash).toBe('meta-x');
    expect(row!.model).toBe('claude-test');
    expect(row!.inputTokens).toBe(100);
    expect(row!.outputTokens).toBe(50);
    expect(row!.costUsd).toBe(0.001);
    expect(row!.createdAt).toBe(t);
    expect(row!.expiresAt).toBe(t + 60_000);
  });

  it('get returns null when key is not present', () => {
    expect(kvGet(db, 'load', 'missing')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Expiry
  // -------------------------------------------------------------------------

  it('get treats expired rows as miss without deleting them', () => {
    const t0 = 1_700_000_000_000;
    kvPut(db, { kind: 'load', key: 'k', valueJson: '{}', expiresAt: t0 + 1000, now: t0 });

    // Past expiry → miss
    expect(kvGet(db, 'load', 'k', t0 + 2000)).toBeNull();
    // Row still in table (sweepExpired drops it, not get)
    expect(kvCountByKind(db, 'load')).toBe(1);
  });

  it('rows with no expiry never expire', () => {
    kvPut(db, { kind: 'load', key: 'k', valueJson: '{}' });
    expect(kvGet(db, 'load', 'k', Date.now() + 365 * 24 * 3600_000)).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Hit-count bookkeeping
  // -------------------------------------------------------------------------

  it('hit_count increments and last_hit_at updates on each get hit', () => {
    kvPut(db, { kind: 'load', key: 'k', valueJson: '{}', now: 1000 });
    const first = kvGet(db, 'load', 'k', 2000);
    expect(first!.hitCount).toBe(1);
    expect(first!.lastHitAt).toBe(2000);

    const second = kvGet(db, 'load', 'k', 3000);
    expect(second!.hitCount).toBe(2);
    expect(second!.lastHitAt).toBe(3000);
  });

  // -------------------------------------------------------------------------
  // Kind isolation
  // -------------------------------------------------------------------------

  it('same key under different kinds does not collide', () => {
    kvPut(db, { kind: 'load', key: 'shared', valueJson: '"load-val"' });
    kvPut(db, { kind: 'turn_detail', key: 'shared', valueJson: '"turn-val"' });

    expect(kvGet(db, 'load', 'shared')!.valueJson).toBe('"load-val"');
    expect(kvGet(db, 'turn_detail', 'shared')!.valueJson).toBe('"turn-val"');
  });

  // -------------------------------------------------------------------------
  // Eviction
  // -------------------------------------------------------------------------

  it('evict removes a specific (kind, key)', () => {
    kvPut(db, { kind: 'load', key: 'k1', valueJson: '{}' });
    kvPut(db, { kind: 'load', key: 'k2', valueJson: '{}' });

    expect(kvEvict(db, 'load', 'k1')).toBe(true);
    expect(kvGet(db, 'load', 'k1')).toBeNull();
    expect(kvGet(db, 'load', 'k2')).not.toBeNull();
  });

  it('evict on missing row returns false', () => {
    expect(kvEvict(db, 'load', 'absent')).toBe(false);
  });

  it('evictByKind removes only rows of that kind', () => {
    kvPut(db, { kind: 'load', key: 'k1', valueJson: '{}' });
    kvPut(db, { kind: 'load', key: 'k2', valueJson: '{}' });
    kvPut(db, { kind: 'turn_detail', key: 'k1', valueJson: '{}' });

    const dropped = kvEvictByKind(db, 'load');
    expect(dropped).toBe(2);
    expect(kvCountByKind(db, 'load')).toBe(0);
    expect(kvCountByKind(db, 'turn_detail')).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Sweep
  // -------------------------------------------------------------------------

  it('sweepExpired drops only rows whose expires_at has passed', () => {
    const t0 = 1_000_000;
    kvPut(db, { kind: 'load', key: 'past', valueJson: '{}', expiresAt: t0 + 100, now: t0 });
    kvPut(db, { kind: 'load', key: 'future', valueJson: '{}', expiresAt: t0 + 10_000, now: t0 });
    kvPut(db, { kind: 'load', key: 'never', valueJson: '{}', now: t0 });

    const dropped = kvSweepExpired(db, t0 + 200);
    expect(dropped).toBe(1);
    expect(kvGet(db, 'load', 'past', t0 + 200)).toBeNull();
    expect(kvGet(db, 'load', 'future', t0 + 200)).not.toBeNull();
    expect(kvGet(db, 'load', 'never', t0 + 200)).not.toBeNull();
  });

  // -------------------------------------------------------------------------
  // Replace semantics
  // -------------------------------------------------------------------------

  it('put on existing (kind, key) replaces value and resets hit_count', () => {
    kvPut(db, { kind: 'load', key: 'k', valueJson: '"v1"', now: 1000 });
    kvGet(db, 'load', 'k', 2000); // hit_count → 1
    kvGet(db, 'load', 'k', 3000); // hit_count → 2

    kvPut(db, { kind: 'load', key: 'k', valueJson: '"v2"', now: 4000 });
    const row = kvGet(db, 'load', 'k', 5000);
    expect(row!.valueJson).toBe('"v2"');
    expect(row!.hitCount).toBe(1); // 0 after replace, 1 after this get
    expect(row!.createdAt).toBe(4000);
  });
});
