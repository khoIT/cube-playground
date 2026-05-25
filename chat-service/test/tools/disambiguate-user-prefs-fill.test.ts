/**
 * Layer 3 cross-session integration test. Verifies that:
 *   - user_disambig_prefs filled from a prior session surfaces in a fresh
 *     session (different sessionId, same owner+game).
 *   - timeRange phrase re-resolves against the new session's clock so the
 *     range rolls over month / week boundaries automatically.
 *   - Layer 3 writes happen alongside Layer 2 writes (single confident slot
 *     lands in both tables).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import { mergeMemoryIntoResult } from '../../src/tools/disambiguate-memory-merge.js';
import { getResolutions } from '../../src/cache/disambig-memory-adapter.js';
import { getUserPrefs } from '../../src/cache/user-prefs-adapter.js';
import { config } from '../../src/config.js';
import type { DisambiguationResult } from '../../src/nl-to-query/index.js';

const OWNER = 'owner-a';
const GAME = 'game-x';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function emptyResult(): DisambiguationResult {
  return {
    query: {},
    slots: { metric: { confidence: 0 }, intent: { value: 'aggregate', confidence: 0.6 } },
    unresolved: [],
    clarifications: [],
    overallConfidence: 0,
    language: 'en',
    action: 'clarify',
    warnings: [],
  };
}

describe('layer-3 cross-session user prefs', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = makeDb();
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = true;
  });

  it('writes confident slot to both session memory and user prefs', () => {
    const MAY_28 = Date.UTC(2026, 4, 28);
    const r = emptyResult();
    r.slots.metric = { value: 'arpu', confidence: 0.95, alias: 'ARPU' };
    r.action = 'auto';

    mergeMemoryIntoResult(r, {
      db, sessionId: 'sess-1', ownerId: OWNER, gameId: GAME, now: MAY_28,
    });

    expect(getResolutions(db, 'sess-1').metric?.value).toBe('arpu');
    const prefs = getUserPrefs(db, OWNER, GAME);
    const metric = prefs.find((p) => p.slot === 'metric');
    expect(metric?.value).toBe('arpu');
    expect(metric?.phrase).toBe('ARPU');
  });

  it('fills slots from user prefs in a new session (no session memory)', () => {
    const MAY_28 = Date.UTC(2026, 4, 28);
    // First session: confirms metric+timeRange.
    const t1 = emptyResult();
    t1.slots.metric = { value: 'arpu', confidence: 0.95, alias: 'ARPU' };
    t1.slots.timeRange = {
      value: ['2026-05-01', '2026-05-31'],
      confidence: 0.95,
      alias: 'this month',
      granularity: 'day',
    };
    t1.action = 'auto';
    mergeMemoryIntoResult(t1, {
      db, sessionId: 'sess-1', ownerId: OWNER, gameId: GAME, now: MAY_28,
    });

    // Second session, different sessionId. No session memory hit; user prefs
    // must supply both slots.
    const t2 = emptyResult();
    mergeMemoryIntoResult(t2, {
      db, sessionId: 'sess-2', ownerId: OWNER, gameId: GAME, now: MAY_28,
    });

    expect(t2.slots.metric.value).toBe('arpu');
    expect(t2.slots.timeRange?.value).toEqual(['2026-05-01', '2026-05-31']);
    expect(t2.warnings.some((w) => w.includes('saved defaults'))).toBe(true);
  });

  it('rolls timeRange phrase forward across month boundary', () => {
    const MAY_28 = Date.UTC(2026, 4, 28);
    // Seed: confirm "this month" in May.
    const seed = emptyResult();
    seed.slots.metric = { value: 'arpu', confidence: 0.95, alias: 'ARPU' };
    seed.slots.timeRange = {
      value: ['2026-05-01', '2026-05-31'],
      confidence: 0.95,
      alias: 'this month',
      granularity: 'day',
    };
    seed.action = 'auto';
    mergeMemoryIntoResult(seed, {
      db, sessionId: 'sess-may', ownerId: OWNER, gameId: GAME, now: MAY_28,
    });

    // Advance clock to June 3. New session, no session memory.
    const JUN_3 = Date.UTC(2026, 5, 3);
    const r = emptyResult();
    mergeMemoryIntoResult(r, {
      db, sessionId: 'sess-jun', ownerId: OWNER, gameId: GAME, now: JUN_3,
    });

    expect(r.slots.timeRange?.value).toBeDefined();
    const [start, end] = r.slots.timeRange!.value as [string, string];
    // "this month" on JUN_3 → full calendar June.
    expect(start).toBe('2026-06-01');
    expect(end).toBe('2026-06-30');
  });

  it('isolates user prefs per owner', () => {
    const NOW = Date.UTC(2026, 4, 28);
    const seed = emptyResult();
    seed.slots.metric = { value: 'arpu', confidence: 0.95, alias: 'ARPU' };
    seed.action = 'auto';
    mergeMemoryIntoResult(seed, {
      db, sessionId: 's1', ownerId: 'owner-A', gameId: GAME, now: NOW,
    });

    const r = emptyResult();
    mergeMemoryIntoResult(r, {
      db, sessionId: 's2', ownerId: 'owner-B', gameId: GAME, now: NOW,
    });

    expect(r.slots.metric.value).toBeUndefined();
  });

  it('isolates user prefs per game', () => {
    const NOW = Date.UTC(2026, 4, 28);
    const seed = emptyResult();
    seed.slots.metric = { value: 'arpu', confidence: 0.95, alias: 'ARPU' };
    seed.action = 'auto';
    mergeMemoryIntoResult(seed, {
      db, sessionId: 's1', ownerId: OWNER, gameId: 'game-a', now: NOW,
    });

    const r = emptyResult();
    mergeMemoryIntoResult(r, {
      db, sessionId: 's2', ownerId: OWNER, gameId: 'game-b', now: NOW,
    });

    expect(r.slots.metric.value).toBeUndefined();
  });
});
