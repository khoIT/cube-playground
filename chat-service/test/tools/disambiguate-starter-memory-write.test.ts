/**
 * Starter pass-through memory trail — session 3542a7c1 regression shape.
 *
 * A starter-chip turn used to return early WITHOUT writing disambig session
 * memory, so the follow-up turn ("add in user count per day") resolved
 * context-blind and surfaced a canned glossary clarification unrelated to
 * the on-screen chart. `starterHitToResult` + the handler's write make a
 * chip turn leave the same trail a glossary-resolved turn leaves.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrate.js';
import {
  starterHitToResult,
  type StarterPassthroughHit,
} from '../../src/tools/disambiguate-starter-passthrough.js';
import {
  fillResultFromMemory,
  writeMemoryFromResult,
} from '../../src/tools/disambiguate-memory-merge.js';
import { getResolutions } from '../../src/cache/disambig-memory-adapter.js';
import { config } from '../../src/config.js';
import type { DisambiguationResult } from '../../src/nl-to-query/index.js';

const NOW = Date.UTC(2026, 5, 7);
const SID = 'sess-3542a7c1';
const OWNER = 'khoitn@vng.com.vn';
const GAME = 'cfm_vn';

const CHIP_TEXT = 'Matches played per day — last 30 days';

/** The exact hit shape the failing session's chip produced. */
function matchesPerDayHit(): StarterPassthroughHit {
  return {
    questionId: 'matches-per-day',
    query: {
      measures: ['etl_game_detail.matches'],
      order: { 'etl_game_detail.dteventtime': 'asc' },
      limit: 1000,
      timeDimensions: [
        {
          dimension: 'etl_game_detail.dteventtime',
          dateRange: ['2026-04-01', '2026-04-30'],
          granularity: 'day',
        },
      ],
    },
    measures: ['etl_game_detail.matches'],
    dimensions: [],
  };
}

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function params(db: Database.Database) {
  return { db, sessionId: SID, ownerId: OWNER, gameId: GAME, now: NOW };
}

beforeEach(() => {
  (config as { cacheServiceEnabled: boolean }).cacheServiceEnabled = true;
});

describe('starterHitToResult', () => {
  it('pins metric/intent/timeRange slots at confidence 1 from the hit', () => {
    const result = starterHitToResult(matchesPerDayHit(), CHIP_TEXT);
    expect(result.action).toBe('auto');
    expect(result.slots.metric).toEqual({
      value: 'etl_game_detail.matches',
      confidence: 1,
      alias: CHIP_TEXT,
    });
    // granularity axis → the chip charts a series → trend intent.
    expect(result.slots.intent).toEqual({ value: 'trend', confidence: 1 });
    expect(result.slots.timeRange).toEqual({
      value: ['2026-04-01', '2026-04-30'],
      confidence: 1,
      granularity: 'day',
    });
    expect(result.slots.dimension).toBeUndefined();
  });

  it('classifies a ranking chip (no granularity) as aggregate and keeps its dimension', () => {
    const hit = matchesPerDayHit();
    hit.query = {
      measures: ['etl_game_detail.matches'],
      dimensions: ['etl_game_detail.game_mode_label'],
      order: { 'etl_game_detail.matches': 'desc' },
      limit: 50,
      timeDimensions: [
        { dimension: 'etl_game_detail.log_date', dateRange: 'last 30 days' },
      ],
    };
    hit.dimensions = ['etl_game_detail.game_mode_label'];
    const result = starterHitToResult(hit, 'Which modes drive the most matches?');
    expect(result.slots.intent.value).toBe('aggregate');
    expect(result.slots.dimension?.value).toBe('etl_game_detail.game_mode_label');
    expect(result.slots.timeRange?.value).toBe('last 30 days');
  });
});

describe('starter hit memory trail (the 3542a7c1 fix)', () => {
  it('write → session memory carries the pinned slots', () => {
    const db = makeDb();
    writeMemoryFromResult(starterHitToResult(matchesPerDayHit(), CHIP_TEXT), params(db));

    const mem = getResolutions(db, SID);
    expect(mem.metric?.value).toBe('etl_game_detail.matches');
    expect(mem.intent?.value).toBe('trend');
    expect(mem.timeRange?.value.dateRange).toEqual(['2026-04-01', '2026-04-30']);
  });

  it('a short follow-up turn inherits the chip metric from memory', () => {
    const db = makeDb();
    writeMemoryFromResult(starterHitToResult(matchesPerDayHit(), CHIP_TEXT), params(db));

    // Follow-up with nothing resolved (short slot-reply shape — no
    // substantial unresolved text, so topic fill is allowed).
    const followUp: DisambiguationResult = {
      query: {},
      slots: { metric: { confidence: 0 }, intent: { value: 'aggregate', confidence: 0.6 } },
      unresolved: [],
      clarifications: [],
      overallConfidence: 0,
      language: 'en',
      action: 'clarify',
      warnings: [],
    };
    fillResultFromMemory(followUp, params(db));

    expect(followUp.slots.metric.value).toBe('etl_game_detail.matches');
    expect(followUp.slots.intent.value).toBe('trend');
  });
});
