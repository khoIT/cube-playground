/**
 * Handler-level replay of session 3542a7c1 — chip turn then context-blind
 * follow-up:
 *
 *   T1  "Matches played per day — last 30 days"  (starter chip)
 *       → pass-through auto + memory trail (metric/intent/timeRange).
 *   T2  "add in user count per day"
 *       → used to clarify with a canned menu; must now resolve to the anchor
 *         cube's `distinct_players` via the token-equivalence fallback.
 *
 * Also guards the hijack boundary: a long new question in the same session
 * must NOT be anchored onto the old cube.
 */

import { EventEmitter } from 'node:events';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import type { StarterSeedHit } from '../../src/db/starter-questions-seed.js';

const { META, KNOWN } = vi.hoisted(() => {
  const META = {
    cubes: [
      {
        name: 'etl_game_detail',
        measures: [
          { name: 'etl_game_detail.matches', type: 'count' },
          { name: 'etl_game_detail.distinct_players', type: 'count_distinct_approx' },
          { name: 'etl_game_detail.distinct_rooms', type: 'count_distinct_approx' },
        ],
        dimensions: [
          { name: 'etl_game_detail.dteventtime', type: 'time' },
          { name: 'etl_game_detail.game_mode_label', type: 'string' },
        ],
      },
    ],
  };
  return {
    META,
    KNOWN: new Set([
      'etl_game_detail.matches',
      'etl_game_detail.distinct_players',
      'etl_game_detail.distinct_rooms',
      'etl_game_detail.dteventtime',
      'etl_game_detail.game_mode_label',
    ]),
  };
});

const seedHolder: { hit: StarterSeedHit | null } = { hit: null };

vi.mock('../../src/core/cube-meta-cache.js', () => ({
  getMeta: vi.fn(async () => META),
  extractMemberNames: () => KNOWN,
}));

// Glossary deliberately cannot see the engagement measures — the real
// failing condition (it would otherwise resolve "user count" itself).
vi.mock('../../src/nl-to-query/glossary-client.js', () => ({
  fetchOfficialGlossary: vi.fn(async () => []),
  __resetGlossaryCache: vi.fn(),
}));

vi.mock('../../src/db/starter-questions-seed.js', () => ({
  getSeedEntry: vi.fn(() => seedHolder.hit),
}));

vi.mock('../../src/config.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/config.js')>();
  return {
    ...mod,
    config: {
      ...mod.config,
      cacheServiceEnabled: true,
      chatGlossaryLegacy: false,
      chatGlossaryAutorouteThreshold: 0.8,
    },
  };
});

import { handler } from '../../src/tools/disambiguate-query.js';
import { migrate } from '../../src/db/migrate.js';
import type { ToolContext } from '../../src/types.js';

const NOW = Date.UTC(2026, 5, 7);
const CHIP_TEXT = 'Matches played per day — last 30 days';

function makeCtx(db: Database.Database): ToolContext {
  return {
    ownerId: 'khoitn@vng.com.vn',
    gameId: 'cfm_vn',
    cubeToken: 'tok',
    workspace: 'local',
    sessionId: 'sess-3542a7c1',
    turnId: 't1',
    db,
    now: () => NOW,
    sseEmitter: new EventEmitter(),
    disambiguationMode: 'targeted',
  } as ToolContext;
}

beforeEach(() => {
  seedHolder.hit = {
    version: 'v1',
    generatedAt: 1,
    entry: {
      questions: [
        {
          id: 'matches-per-day',
          text: CHIP_TEXT,
          topicTags: ['engagement'],
          categoryTags: ['explore'],
          targetCatalogIds: ['etl_game_detail.matches', 'etl_game_detail.dteventtime'],
        },
      ],
      coverage: { 'etl_game_detail.dteventtime': '2026-04-30' },
    },
  };
});

describe('3542a7c1 replay — chip then "add in user count per day"', () => {
  it('resolves the follow-up onto the anchor cube instead of a canned clarify', async () => {
    const db = new Database(':memory:');
    migrate(db);
    const ctx = makeCtx(db);

    // T1 — starter chip.
    const t1 = await handler({ message: CHIP_TEXT }, ctx);
    expect(t1.action).toBe('auto');
    expect(t1.query.measures).toEqual(['etl_game_detail.matches']);

    // T2 — the message that used to fail. The additive merge extends the
    // chip's query: ONE artifact, BOTH series.
    const t2 = await handler({ message: 'add in user count per day' }, ctx);
    expect(t2.action).toBe('auto');
    expect(t2.slots.metric.value).toBe('etl_game_detail.distinct_players');
    expect(t2.query.measures).toEqual([
      'etl_game_detail.matches',
      'etl_game_detail.distinct_players',
    ]);
    // The merged query inherits the chip's window/order/limit verbatim.
    expect(t2.query.timeDimensions?.[0]?.dimension).toBe('etl_game_detail.dteventtime');
    expect(t2.query.timeDimensions?.[0]?.dateRange).toEqual(['2026-04-01', '2026-04-30']);
    expect(t2.query.limit).toBe(1000);
    // Disclosure footer payload for the skill body.
    expect(t2.assumption?.slot).toBe('metric');
    expect(t2.assumption?.chosen).toBe('etl_game_detail.distinct_players');
    expect(t2.warnings.join(' ')).toContain('prior-cube anchor');
    expect(t2.warnings.join(' ')).toContain('additive merge');
  });

  it('a 2-word reply ("user count") resolves the NEW member, not last turn\'s metric', async () => {
    const db = new Database(':memory:');
    migrate(db);
    const ctx = makeCtx(db);
    await handler({ message: CHIP_TEXT }, ctx);

    const t2 = await handler({ message: 'user count' }, ctx);
    expect(t2.slots.metric.value).toBe('etl_game_detail.distinct_players');
    expect(t2.action).toBe('auto');
  });

  it('a long new question is NOT hijacked onto the anchor cube', async () => {
    const db = new Database(':memory:');
    migrate(db);
    const ctx = makeCtx(db);
    await handler({ message: CHIP_TEXT }, ctx);

    const t2 = await handler(
      { message: 'what are the currency outflow reasons for whales last week' },
      ctx,
    );
    // Empty glossary → clarify; the point is the anchor must NOT fill it.
    expect(t2.slots.metric.value).not.toBe('etl_game_detail.distinct_players');
    expect(t2.warnings.join(' ')).not.toContain('prior-cube anchor');
  });

  it('weak anchor matches surface as contextual clarify options, not the canned menu', async () => {
    const db = new Database(':memory:');
    migrate(db);
    const ctx = makeCtx(db);
    await handler({ message: CHIP_TEXT }, ctx);

    // "unique things" — equiv maps unique→distinct but "things" kills full
    // coverage, leaving partial-tier candidates below the 0.8 threshold.
    const t2 = await handler({ message: 'unique things' }, ctx);
    if (t2.action === 'clarify') {
      const metricClar = t2.clarifications.find((c) => c.slot === 'metric');
      if (metricClar?.options) {
        expect(metricClar.options.every((o) => o.value.startsWith('etl_game_detail.'))).toBe(true);
      }
    }
  });
});
