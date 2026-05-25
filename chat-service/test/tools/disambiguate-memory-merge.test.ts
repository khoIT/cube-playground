/**
 * Integration test for disambiguate-memory-merge — the session-memory bridge
 * inside the disambig tool. Drives synthetic DisambiguationResult objects
 * (one per turn) so we don't depend on the slot-extractor's full machinery.
 *
 * The headline scenario reproduces session 1399825c… that motivated this
 * work: ambiguous metric + explicit timeRange in T0, single-value reply
 * "ARPU" in T1, then a follow-up turn with only a dimension change in T2.
 * Memory should make T2 auto-route with both metric and timeRange filled.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import { mergeMemoryIntoResult } from '../../src/tools/disambiguate-memory-merge.js';
import { getResolutions } from '../../src/cache/disambig-memory-adapter.js';
import { config } from '../../src/config.js';
import type { DisambiguationResult } from '../../src/nl-to-query/index.js';

const WED = Date.UTC(2026, 4, 27);
const SID = 'sess-replay';
const OWNER = 'owner-a';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function emptyResult(): DisambiguationResult {
  return {
    query: {},
    slots: { metric: { confidence: 0 } },
    unresolved: [],
    clarifications: [],
    overallConfidence: 0,
    language: 'en',
    action: 'clarify',
    warnings: [],
  };
}

describe('disambiguate-memory-merge', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = true;
  });

  it('T0 ambiguous metric + explicit timeRange → memory captures timeRange only', () => {
    const t0 = emptyResult();
    t0.slots.timeRange = {
      value: ['2026-05-21', '2026-05-27'],
      confidence: 0.95,
      alias: 'this week',
      granularity: 'day',
    };
    t0.clarifications = [
      { slot: 'metric', question_en: 'Which metric?', question_vi: 'Chỉ số nào?' },
    ];

    mergeMemoryIntoResult(t0, { db, sessionId: SID, ownerId: OWNER, now: WED });

    expect(t0.action).toBe('clarify');
    expect(t0.clarifications).toHaveLength(1);
    const mem = getResolutions(db, SID);
    expect(mem.timeRange?.phrase).toBe('this week');
    expect(mem.metric).toBeUndefined();
  });

  it('T1 reply "ARPU" → metric memorised; turn upgrades clarify→auto thanks to inherited timeRange', () => {
    // Prime memory with T0's timeRange.
    const t0 = emptyResult();
    t0.slots.timeRange = {
      value: ['2026-05-21', '2026-05-27'],
      confidence: 0.95,
      alias: 'this week',
      granularity: 'day',
    };
    t0.clarifications = [{ slot: 'metric', question_en: 'Which metric?', question_vi: 'Chỉ số nào?' }];
    mergeMemoryIntoResult(t0, { db, sessionId: SID, ownerId: OWNER, now: WED });

    // T1: user replied "ARPU". Extractor resolves metric. timeRange absent
    // from this turn — must come from memory.
    const t1 = emptyResult();
    t1.slots.metric = { value: 'arpu', confidence: 0.95, alias: 'ARPU' };

    mergeMemoryIntoResult(t1, { db, sessionId: SID, ownerId: OWNER, now: WED });

    expect(t1.slots.metric.value).toBe('arpu');
    expect(t1.slots.timeRange?.value).toEqual(['2026-05-21', '2026-05-27']);
    expect(t1.action).toBe('auto');

    const mem = getResolutions(db, SID);
    expect(mem.metric?.value).toBe('arpu');
    expect(mem.metric?.phrase).toBe('ARPU');
    expect(mem.timeRange?.phrase).toBe('this week');
  });

  it('T2 new dimension only → both metric and timeRange filled from memory', () => {
    // Replay T0 + T1 to populate memory.
    const t0 = emptyResult();
    t0.slots.timeRange = {
      value: ['2026-05-21', '2026-05-27'],
      confidence: 0.95,
      alias: 'this week',
      granularity: 'day',
    };
    t0.clarifications = [{ slot: 'metric', question_en: '?', question_vi: '?' }];
    mergeMemoryIntoResult(t0, { db, sessionId: SID, ownerId: OWNER, now: WED });

    const t1 = emptyResult();
    t1.slots.metric = { value: 'arpu', confidence: 0.95, alias: 'ARPU' };
    mergeMemoryIntoResult(t1, { db, sessionId: SID, ownerId: OWNER, now: WED });

    // T2: "rank by country". Only dimension changes; the engine would not set
    // metric or timeRange on this turn.
    const t2 = emptyResult();
    t2.slots.dimension = { value: 'players.country', confidence: 0.95, alias: 'by country' };

    mergeMemoryIntoResult(t2, { db, sessionId: SID, ownerId: OWNER, now: WED });

    expect(t2.slots.metric.value).toBe('arpu');
    expect(t2.slots.dimension?.value).toBe('players.country');
    expect(t2.slots.timeRange?.value).toEqual(['2026-05-21', '2026-05-27']);
    expect(t2.action).toBe('auto');
    expect(t2.clarifications).toHaveLength(0);
  });

  it('timeRange phrase re-resolves against fresh `now`', () => {
    // Prime memory at WED with phrase "today".
    const t0 = emptyResult();
    t0.slots.timeRange = {
      value: ['2026-05-27', '2026-05-27'],
      confidence: 0.95,
      alias: 'today',
      granularity: 'day',
    };
    t0.slots.metric = { value: 'arpu', confidence: 0.95, alias: 'ARPU' };
    t0.action = 'auto';
    mergeMemoryIntoResult(t0, { db, sessionId: SID, ownerId: OWNER, now: WED });

    // Next day. T1 has no timeRange. Memory must re-resolve "today" → Thu.
    const THU = Date.UTC(2026, 4, 28);
    const t1 = emptyResult();
    t1.slots.metric = { value: 'arpu', confidence: 0.95, alias: 'ARPU' };

    mergeMemoryIntoResult(t1, { db, sessionId: SID, ownerId: OWNER, now: THU });

    expect(t1.slots.timeRange?.value).toEqual(['2026-05-28', '2026-05-28']);
  });

  it('low-confidence slots are not written to memory', () => {
    const r = emptyResult();
    r.slots.metric = { value: 'maybe.metric', confidence: 0.5, alias: 'something' };

    mergeMemoryIntoResult(r, { db, sessionId: SID, ownerId: OWNER, now: WED });

    expect(getResolutions(db, SID).metric).toBeUndefined();
  });

  it('explicit slot in current turn overrides memory (does not refill)', () => {
    // Memorise metric=arpu.
    const seed = emptyResult();
    seed.slots.metric = { value: 'arpu', confidence: 0.95, alias: 'ARPU' };
    seed.action = 'auto';
    mergeMemoryIntoResult(seed, { db, sessionId: SID, ownerId: OWNER, now: WED });

    // New turn explicitly picks a different metric.
    const r = emptyResult();
    r.slots.metric = { value: 'arpdau', confidence: 0.95, alias: 'ARPDAU' };

    mergeMemoryIntoResult(r, { db, sessionId: SID, ownerId: OWNER, now: WED });

    expect(r.slots.metric.value).toBe('arpdau');
    expect(getResolutions(db, SID).metric?.value).toBe('arpdau');
  });
});
