/**
 * Unit tests for user-prefs-adapter — CRUD over `user_disambig_prefs`.
 * Covers roundtrip, per-owner + per-game isolation, touch behaviour,
 * delete-one, delete-all, and JSON-parse resilience.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import {
  getUserPrefs,
  upsertUserPref,
  touchUserPref,
  deleteUserPref,
  deleteAllUserPrefs,
} from '../../src/cache/user-prefs-adapter.js';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

describe('user-prefs-adapter', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
  });

  it('returns empty array when no prefs exist', () => {
    expect(getUserPrefs(db, 'owner-a', 'game-x')).toEqual([]);
  });

  it('roundtrip preserves value + phrase', () => {
    upsertUserPref(db, {
      ownerId: 'owner-a', gameId: 'game-x', slot: 'metric',
      value: 'arpdau', phrase: 'ARPDAU', now: 1000,
    });
    const rows = getUserPrefs(db, 'owner-a', 'game-x');
    expect(rows).toHaveLength(1);
    expect(rows[0].slot).toBe('metric');
    expect(rows[0].value).toBe('arpdau');
    expect(rows[0].phrase).toBe('ARPDAU');
    expect(rows[0].lastUsedAt).toBe(1000);
    expect(rows[0].hitCount).toBe(0);
  });

  it('upsert on existing row replaces value and increments hit_count', () => {
    upsertUserPref(db, {
      ownerId: 'o', gameId: 'g', slot: 'metric', value: 'a', now: 100,
    });
    upsertUserPref(db, {
      ownerId: 'o', gameId: 'g', slot: 'metric', value: 'b', now: 200,
    });
    const rows = getUserPrefs(db, 'o', 'g');
    expect(rows[0].value).toBe('b');
    expect(rows[0].lastUsedAt).toBe(200);
    expect(rows[0].hitCount).toBe(1);
  });

  it('isolates per owner', () => {
    upsertUserPref(db, { ownerId: 'o1', gameId: 'g', slot: 'metric', value: 'arpu' });
    upsertUserPref(db, { ownerId: 'o2', gameId: 'g', slot: 'metric', value: 'arpdau' });
    expect(getUserPrefs(db, 'o1', 'g')[0].value).toBe('arpu');
    expect(getUserPrefs(db, 'o2', 'g')[0].value).toBe('arpdau');
  });

  it('isolates per game', () => {
    upsertUserPref(db, { ownerId: 'o', gameId: 'g1', slot: 'metric', value: 'arpu' });
    upsertUserPref(db, { ownerId: 'o', gameId: 'g2', slot: 'metric', value: 'arpdau' });
    expect(getUserPrefs(db, 'o', 'g1')[0].value).toBe('arpu');
    expect(getUserPrefs(db, 'o', 'g2')[0].value).toBe('arpdau');
  });

  it('returns rows ordered by last_used_at DESC', () => {
    upsertUserPref(db, { ownerId: 'o', gameId: 'g', slot: 'metric', value: 'm', now: 100 });
    upsertUserPref(db, { ownerId: 'o', gameId: 'g', slot: 'dimension', value: 'd', now: 200 });
    const rows = getUserPrefs(db, 'o', 'g');
    expect(rows.map((r) => r.slot)).toEqual(['dimension', 'metric']);
  });

  it('touchUserPref bumps last_used_at and hit_count', () => {
    upsertUserPref(db, { ownerId: 'o', gameId: 'g', slot: 'metric', value: 'm', now: 100 });
    touchUserPref(db, 'o', 'g', 'metric', 500);
    const row = getUserPrefs(db, 'o', 'g')[0];
    expect(row.lastUsedAt).toBe(500);
    expect(row.hitCount).toBe(1);
  });

  it('deleteUserPref removes a single slot', () => {
    upsertUserPref(db, { ownerId: 'o', gameId: 'g', slot: 'metric', value: 'm' });
    upsertUserPref(db, { ownerId: 'o', gameId: 'g', slot: 'dimension', value: 'd' });
    expect(deleteUserPref(db, 'o', 'g', 'metric')).toBe(true);
    const rows = getUserPrefs(db, 'o', 'g');
    expect(rows).toHaveLength(1);
    expect(rows[0].slot).toBe('dimension');
  });

  it('deleteUserPref returns false when nothing matches', () => {
    expect(deleteUserPref(db, 'o', 'g', 'metric')).toBe(false);
  });

  it('deleteAllUserPrefs clears every row for owner+game', () => {
    upsertUserPref(db, { ownerId: 'o', gameId: 'g', slot: 'metric', value: 'm' });
    upsertUserPref(db, { ownerId: 'o', gameId: 'g', slot: 'dimension', value: 'd' });
    upsertUserPref(db, { ownerId: 'o', gameId: 'other', slot: 'metric', value: 'x' });
    expect(deleteAllUserPrefs(db, 'o', 'g')).toBe(2);
    expect(getUserPrefs(db, 'o', 'g')).toEqual([]);
    expect(getUserPrefs(db, 'o', 'other')).toHaveLength(1);
  });

  it('supports filter:<member> slot keys', () => {
    upsertUserPref(db, {
      ownerId: 'o', gameId: 'g',
      slot: 'filter:players.channel', value: 'web', phrase: 'on web',
    });
    const row = getUserPrefs(db, 'o', 'g')[0];
    expect(row.slot).toBe('filter:players.channel');
    expect(row.value).toBe('web');
  });

  it('stores structured timeRange value JSON-serialised', () => {
    upsertUserPref(db, {
      ownerId: 'o', gameId: 'g', slot: 'timeRange',
      value: { dateRange: 'this month', granularity: 'day' },
      phrase: 'this month',
    });
    const row = getUserPrefs(db, 'o', 'g')[0];
    expect(row.value).toEqual({ dateRange: 'this month', granularity: 'day' });
    expect(row.phrase).toBe('this month');
  });
});
