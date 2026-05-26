/**
 * Phase 02a sub-deliverable D — slot-level continuity for intent/concept/
 * entity across the clarify→reply boundary. Replays the session b93d68e4
 * shape:
 *
 *   T0  user: "top spenders this week"
 *       → intent=leaderboard (conf 0.92), concept=spender (conf 0.85),
 *         entity=players (conf 0.85), timeRange=this week, metric=…
 *       → action=auto in v2 OR clarify in pre-v2 — the slot writes happen
 *         either way because confidence ≥ 0.7 floor.
 *
 *   T2  user: "Revenue"
 *       → engine: intent=aggregate (default 0.6), metric=recharge.revenue_vnd
 *       → fill-from-memory: intent upgraded to leaderboard, concept+entity
 *         restored, timeRange inherited.
 *       → retry-from-memory: leaderboard query built with the memorized
 *         concept.
 *       → action=auto (was 8 turns in prod, now 2).
 *
 * Both tiers (session kv_cache + cross-session user_disambig_prefs) are
 * exercised so the cross-session source marker is verified too.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import {
  fillResultFromMemory,
  writeMemoryFromResult,
} from '../../src/tools/disambiguate-memory-merge.js';
import {
  getResolutions,
  type DisambigResolutions,
} from '../../src/cache/disambig-memory-adapter.js';
import { getUserPrefs } from '../../src/cache/user-prefs-adapter.js';
import { config } from '../../src/config.js';
import type { DisambiguationResult } from '../../src/nl-to-query/index.js';

const NOW = Date.UTC(2026, 4, 27);
const SID = 'sess-b93';
const OWNER = 'owner-a';
const GAME = 'ptg';

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

beforeEach(() => {
  (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = true;
});

// ---------------------------------------------------------------------------
// Session tier
// ---------------------------------------------------------------------------

describe('intent/concept/entity write-on-clarify (session tier)', () => {
  it('confident intent + concept + entity persist even when overall action=clarify', () => {
    const db = makeDb();
    const t0 = emptyResult();
    t0.action = 'clarify';
    t0.clarifications = [
      { slot: 'metric', question_en: 'rank what?', question_vi: '?' },
    ];
    t0.slots.intent = { value: 'leaderboard', confidence: 0.92, alias: 'top' };
    t0.slots.concept = { value: 'spender', confidence: 0.85, alias: 'spenders' };
    t0.slots.entity = {
      value: { cube: 'players', pk: 'players.user_id' },
      confidence: 0.85,
      alias: 'spenders',
    };
    t0.slots.timeRange = {
      value: ['2026-05-21', '2026-05-27'],
      confidence: 0.95,
      alias: 'this week',
      granularity: 'day',
    };

    writeMemoryFromResult(t0, { db, sessionId: SID, ownerId: OWNER, gameId: GAME, now: NOW });

    const mem: DisambigResolutions = getResolutions(db, SID);
    expect(mem.intent?.value).toBe('leaderboard');
    expect(mem.concept?.value).toBe('spender');
    expect(mem.entity?.value).toEqual({ cube: 'players', pk: 'players.user_id' });
    expect(mem.timeRange?.phrase).toBe('this week');
  });

  it('engine-default aggregate (conf 0.6) does NOT overwrite memorized leaderboard intent', () => {
    const db = makeDb();
    // Seed memory as if turn 0 already wrote intent=leaderboard.
    const t0 = emptyResult();
    t0.slots.intent = { value: 'leaderboard', confidence: 0.92, alias: 'top' };
    t0.slots.concept = { value: 'spender', confidence: 0.85, alias: 'spenders' };
    writeMemoryFromResult(t0, { db, sessionId: SID, ownerId: OWNER, gameId: GAME, now: NOW });

    // Turn 2 — engine emits default aggregate at 0.6.
    const t2 = emptyResult();
    t2.slots.metric = { value: 'recharge.revenue_vnd', confidence: 1.0, alias: 'Revenue' };
    expect(t2.slots.intent.value).toBe('aggregate');
    expect(t2.slots.intent.confidence).toBe(0.6);

    fillResultFromMemory(t2, { db, sessionId: SID, ownerId: OWNER, gameId: GAME, now: NOW });

    expect(t2.slots.intent.value).toBe('leaderboard');
    expect(t2.slots.intent.confidence).toBe(0.95);
    expect(t2.slots.concept?.value).toBe('spender');
  });

  it('a high-confidence per-turn intent is NOT overridden by memory', () => {
    const db = makeDb();
    // Seed memory with leaderboard intent.
    const t0 = emptyResult();
    t0.slots.intent = { value: 'leaderboard', confidence: 0.92, alias: 'top' };
    writeMemoryFromResult(t0, { db, sessionId: SID, ownerId: OWNER, gameId: GAME, now: NOW });

    // New turn with a strong "trend" intent — must win over memory.
    const t = emptyResult();
    t.slots.intent = { value: 'trend', confidence: 0.92, alias: 'trend' };
    fillResultFromMemory(t, { db, sessionId: SID, ownerId: OWNER, gameId: GAME, now: NOW });

    expect(t.slots.intent.value).toBe('trend');
  });
});

// ---------------------------------------------------------------------------
// Cross-session tier
// ---------------------------------------------------------------------------

describe('intent/concept/entity write-on-clarify (cross-session tier)', () => {
  it('writes intent/concept/entity to user_disambig_prefs and reads them back with cross_session marker', () => {
    const db = makeDb();
    const t0 = emptyResult();
    t0.action = 'clarify';
    t0.slots.intent = { value: 'leaderboard', confidence: 0.92, alias: 'top' };
    t0.slots.concept = { value: 'spender', confidence: 0.85, alias: 'spenders' };
    t0.slots.entity = {
      value: { cube: 'players', pk: 'players.user_id' },
      confidence: 0.85,
      alias: 'spenders',
    };
    writeMemoryFromResult(t0, { db, sessionId: SID, ownerId: OWNER, gameId: GAME, now: NOW });

    // Verify user_disambig_prefs rows.
    const prefs = getUserPrefs(db, OWNER, GAME);
    const slots = new Set(prefs.map((p) => p.slot));
    expect(slots.has('intent')).toBe(true);
    expect(slots.has('concept')).toBe(true);
    expect(slots.has('entity')).toBe(true);

    // Fresh session for same (owner, game) — fillResultFromMemory's L3
    // fallback should restore from prefs and add the cross_session marker.
    const t2Fresh = emptyResult();
    fillResultFromMemory(t2Fresh, {
      db,
      sessionId: 'different-session',
      ownerId: OWNER,
      gameId: GAME,
      now: NOW,
    });

    // Confidence is downgraded to 0.7 on cross-session reads.
    expect(t2Fresh.slots.intent.value).toBe('leaderboard');
    expect(t2Fresh.slots.intent.confidence).toBe(0.7);
    expect(t2Fresh.slots.concept?.value).toBe('spender');
    expect(t2Fresh.slots.entity?.value).toEqual({ cube: 'players', pk: 'players.user_id' });

    // The always-disclose marker appears in warnings for the skill body.
    const conceptMarker = t2Fresh.warnings.find((w) =>
      w === '[cross_session_pref] concept:spender',
    );
    expect(conceptMarker).toBeDefined();
  });
});
